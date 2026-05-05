# 内核裁剪与编译

> **文档说明**：本文档基于 Linux Kernel 源码、ARM 交叉编译工具链及嵌入式 Linux 定制经验整理。

---

## 目录

1. [Linux 内核构建概述](#1-linux-内核构建概述)
2. [Kconfig 配置系统](#2-kconfig-配置系统)
3. [交叉编译环境搭建](#3-交叉编译环境搭建)
4. [编译与裁剪实战](#4-编译与裁剪实战)
5. [设备树编译](#5-设备树编译)
6. [常见问题](#6-常见问题)

---

## 1. Linux 内核构建概述

```
内核构建流程:

  源码 (kernel.org / 厂商 SDK)
      │
      ├── 1. 设置交叉编译工具链 (ARCH + CROSS_COMPILE)
      │
      ├── 2. 配置内核 (Kconfig)
      │    make xxx_defconfig  → .config  (默认配置)
      │    make menuconfig     → .config  (交互式配置)
      │
      ├── 3. 编译
      │    make zImage / uImage / Image  (内核镜像)
      │    make modules        (内核模块)
      │    make dtbs           (设备树)
      │
      └── 4. 安装
           install zImage + dtb → boot 分区
           install modules     → rootfs
```

---

## 2. Kconfig 配置系统

Kconfig 定义了所有内核配置选项，`menuconfig` 是交互式配置界面。

```
内核配置层级:

  make menuconfig:

  ┌─── Linux/arm Configuration ───────────────┐
  │  General setup  ──→                       │
  │  System Type  ──→  (SoC / 架构)            │
  │  Kernel Features  ──→  (SMP, PREEMPT...)  │
  │  Boot options  ──→                         │
  │  CPU Power Management  ──→                 │
  │  Networking support  ──→                   │
  │  Device Drivers  ──→  (最大量配置)          │
  │  File systems  ──→                         │
  │  Kernel hacking  ──→  (调试选项)            │
  └────────────────────────────────────────────┘
```

### 常用配置项

```bash
# 查看当前配置
zcat /proc/config.gz          # 运行中的内核配置
make savedefconfig             # 生成精简 defconfig

# 常用配置分类:

# --- 内核特性 ---
CONFIG_SMP=y                   # 多核支持
CONFIG_PREEMPT=y               # 抢占模式 (实时性)
CONFIG_HZ=1000                 # 定时器频率 (100/250/1000)

# --- 网络 ---
CONFIG_NET=y                   # 网络支持
CONFIG_PACKET=y                # AF_PACKET (raw socket)
CONFIG_INET=y                  # TCP/IP

# --- 文件系统 ---
CONFIG_EXT4_FS=y
CONFIG_SQUASHFS=y
CONFIG_OVERLAY_FS=y

# --- 调试 ---
CONFIG_PRINTK=y
CONFIG_DEBUG_FS=y
CONFIG_EARLY_PRINTK=y

# 查看依赖关系:
make menuconfig → 按 '?' 查看帮助
                 → 按 '/' 搜索配置项
```

### 裁剪技巧

```bash
# 1. 从运行中的内核开始
ssh target "lsmod" > modules.list   # 记录用到的模块
ssh target "zcat /proc/config.gz" > running.config

# 2. 去掉不需要的驱动
make localmodconfig       # 根据当前加载的模块精简配置
make localyesconfig       # 将所有模块改为内置

# 3. 关键裁剪项
# Device Drivers → Graphics support → 去掉 GPU/DRM (无显示场景)
# Device Drivers → Sound card → 去掉声卡
# Device Drivers → USB support → 只留必需的 USB 功能
# Networking → 去掉不需要的协议 (如 Amateur Radio)
# File systems → 去掉不需要的文件系统

# 4. 验证裁剪结果
make vmlinux -j4 2>&1 | tail -1
ls -lh arch/arm/boot/zImage
```

---

## 3. 交叉编译环境搭建

```bash
# 方案 1: 使用发行版提供的工具链
sudo apt install gcc-arm-linux-gnueabihf   # ARM 32-bit hard-float
sudo apt install gcc-aarch64-linux-gnu     # ARM 64-bit

# 方案 2: 下载 Linaro / ARM 官方工具链
wget https://developer.arm.com/-/media/Files/downloads/gnu/.../arm-gnu-toolchain-xxx.tar.xz
tar xf arm-gnu-toolchain-xxx.tar.xz -C /opt
export PATH=/opt/arm-gnu-toolchain/bin:$PATH

# 方案 3: Buildroot / Yocto 自动构建工具链
# 适合锁定版本和确保一致性
```

```bash
# 编译 ARM 32-bit 内核 (如 i.MX6ULL)
export ARCH=arm
export CROSS_COMPILE=arm-linux-gnueabihf-
make imx_v6_v7_defconfig
make -j$(nproc) zImage dtbs modules

# 编译 ARM 64-bit 内核 (如 i.MX8M Plus)
export ARCH=arm64
export CROSS_COMPILE=aarch64-linux-gnu-
make defconfig
make -j$(nproc) Image dtbs modules
```

---

## 4. 编译与裁剪实战

```bash
# 完整内核构建脚本
#!/bin/bash
set -e

ARCH=arm
CROSS_COMPILE=arm-linux-gnueabihf-
KERNEL_DIR=/path/to/linux
BUILD_DIR=$KERNEL_DIR/build
NPROC=$(nproc)

export ARCH CROSS_COMPILE

cd $KERNEL_DIR

# 1. 清理
make mrproper

# 2. 加载默认配置
make myboard_defconfig

# 3. 根据应用场景裁剪
# 场景 A: 无头设备 (无显示)
scripts/config -d CONFIG_FB
scripts/config -d CONFIG_DRM
scripts/config -d CONFIG_SOUND

# 场景 B: 安全关键
scripts/config -e CONFIG_SECURITY
scripts/config -e CONFIG_SECURITY_YAMA

# 场景 C: 低延迟 (实时)
scripts/config -e CONFIG_PREEMPT

# 4. 更新 .config
make olddefconfig

# 5. 编译
make -j$NPROC zImage dtbs modules

# 6. 输出
echo "Kernel: $KERNEL_DIR/arch/arm/boot/zImage"
echo "DTB: $KERNEL_DIR/arch/arm/boot/dts/*.dtb"
echo "Modules: $KERNEL_DIR (make modules_install to rootfs)"
```

### 内核模块外部编译

```bash
# 编译外部内核模块 (单独编译一个 driver)
make -C /path/to/kernel M=$(pwd) modules
# 或者直接在 driver 目录:
# Makefile:
# obj-m := mydriver.o
# KDIR := /path/to/kernel/source
# all:
#     $(MAKE) -C $(KDIR) M=$(PWD) modules
```

---

## 5. 设备树编译

```bash
# 设备树源码编译 (.dts → .dtb)
# 编译单个 dts:
make myboard.dtb

# 编译所有 dts:
make dtbs

# 手动编译 (dtc):
dtc -I dts -O dtb -o output.dtb input.dts

# 反编译 (.dtb → .dts):
dtc -I dtb -O dts -o output.dts input.dtb

# 查看 .dtb 内容:
fdtdump myboard.dtb  # 十六进制 + 解析
dtc -I dtb -O dts myboard.dtb  # 完整反编译
```

---

## 6. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | `arm-linux-gnueabihf-gcc: command not found` | 交叉编译器未安装或 PATH 未设置 | `sudo apt install gcc-arm-linux-gnueabihf` |
| 2 | 内核镜像太大 (>8MB) | 驱动/文件系统编入太多 | `make localmodconfig` 精简 |
| 3 | `menuconfig` 界面乱码 | 终端编码问题 | `export LC_ALL=C; export NCURSES_NO_UTF8_ACS=1` |
| 4 | 编译错误: 未找到某头文件 | 缺少依赖包 | `sudo apt install flex bison libssl-dev libelf-dev bc` |
| 5 | 内核启动后无串口输出 | 未开启 earlyprintk 或 UART 驱动 | `CONFIG_EARLY_PRINTK=y`; 检查 UART 驱动 |
| 6 | 内核模块版本不匹配 (加载失败) | 模块与内核不是同一版本编译 | `uname -r` 确认版本; 拷贝到/lib/modules/正确路径 |
| 7 | `make dtbs` 无输出 | 未使能对应的平台 DTS | 确认 `CONFIG_SOC_xxx` 已启用; defconfig 是否正确 |

---

## 7. 参考文档

1. Linux Kernel 官方文档: https://docs.kernel.org/
2. "Linux Device Drivers" 3rd Ed. — Corbet, Rubini, Kroah-Hartman (Chapter 4: 编译与加载)
3. ARM Cross Compilation: https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain
4. "Mastering Embedded Linux Programming" — Chris Simmonds
5. "Bootlin Embedded Linux Training" (免费培训资料): https://bootlin.com/training/embedded-linux/
