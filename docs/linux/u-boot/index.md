# U-Boot 移植

> **文档说明**：本文档基于 Das U-Boot 官方文档及主流 SoC 平台 (STM32MP1/i.MX6/Sunxi) 移植经验整理。

---

## 目录

1. [U-Boot 基础](#1-u-boot-基础)
2. [板级初始化流程](#2-板级初始化流程)
3. [环境变量与 Bootcmd](#3-环境变量与-bootcmd)
4. [移植实战](#4-移植实战)
5. [常见问题](#5-常见问题)

---

## 1. U-Boot 基础

U-Boot (Das U-Boot) 是嵌入式 Linux 最通用的开源 Bootloader，支持 ARM、MIPS、RISC-V 等架构。

```
U-Boot 启动流程:

  ROM Boot → SPL (Secondary Program Loader)
      │
      ├── 初始化 DRAM 控制器
      ├── 初始化最小外设 (UART, PMIC)
      ├── 加载 U-Boot (从 SD/eMMC/NAND/SPI Flash)
      │
      └──→ U-Boot Proper
           ├── 初始化更多外设 (网口, USB, MMC)
           ├── 读取环境变量
           ├── 执行 bootcmd
           │
           └──→ 加载 Linux 内核
                ├── 从存储介质加载 Kernel + DTB
                ├── 设置 bootargs
                └── 跳转到内核入口

  最终:
  U-Boot SPL 2022.01 (Jan 01 2022)
  U-Boot 2022.01 (Jan 01 2022)

  Hit any key to stop autoboot: 3 2 1 0
  =>
```

---

## 2. 板级初始化流程

### 板级文件结构

```
board/<vendor>/<board>/
├── Kconfig
├── MAINTAINERS
├── Makefile
├── board.c               # 板级初始化代码 (核心)
├── board.h               # 板级头文件 (可选)
└── dram_init.c           # DRAM 初始化 (可选)
```

```c
// board/mycompany/myboard/board.c 核心函数
#include <common.h>
#include <dm.h>
#include <fdt_support.h>

DECLARE_GLOBAL_DATA_PTR;

// 1. 早期板级初始化 (SPL 中调用)
int board_early_init_f(void) {
    // 时钟配置、Pinmux、PMIC 等
    return 0;
}

// 2. DRAM 大小报告
int dram_init(void) {
    // 从设备树或硬编码获取 DRAM 大小
    gd->ram_size = get_ram_size((void *)CONFIG_SYS_SDRAM_BASE,
                                 CONFIG_SYS_SDRAM_SIZE);
    return 0;
}

// 3. 板级初始化 (U-Boot Proper 中调用)
int board_init(void) {
    // 外设使能 (GPIO, 网口 PHY 复位等)
    return 0;
}

// 4. 晚期初始化 (设备模型 probe 后)
int board_late_init(void) {
    // 设置环境变量、读取 MAC 地址、校准信息等
    return 0;
}

// 5. 设备树 fixup (在 boot 前修改 dts)
int ft_board_setup(void *blob, struct bd_info *bd) {
    // 例如: 根据硬件版修改 dts 中的 compatible
    fdt_setprop_string(blob, 0, "model", "MyBoard v1.0");
    return 0;
}
```

### U-Boot defconfig

```bash
# configs/myboard_defconfig
CONFIG_ARM=y
CONFIG_ARCH_STM32=y
CONFIG_SYS_MALLOC_LEN=0x100000

# SPL 配置
CONFIG_SPL=y
CONFIG_SPL_FS_EXT4=y         # SPL 从 ext4 加载
CONFIG_SPL_MMC=y
CONFIG_SPL_SERIAL=y

# 外设
CONFIG_MMC=y
CONFIG_DM_MMC=y
CONFIG_STM32_SDMMC2=y
CONFIG_NET=y
CONFIG_ETH_DESIGNWARE=y

# 环境变量存储
CONFIG_ENV_IS_IN_MMC=y
CONFIG_ENV_OFFSET=0x80000    # MMC 中环境变量的偏移
```

---

## 3. 环境变量与 Bootcmd

### 关键环境变量

```bash
# 查看所有环境变量
printenv

# 关键变量:

# 1. bootcmd — 自动启动时执行的命令序列
bootcmd=run load_kernel; run load_dtb; run boot_kernel

# 2. bootargs — 传给内核的命令行参数
bootargs=console=ttySTM0,115200 root=/dev/mmcblk0p3 rootwait rw

# 3. load_kernel — 加载内核镜像
load_kernel=fatload mmc 0:1 ${kernel_addr} zImage

# 4. load_dtb — 加载设备树
load_dtb=fatload mmc 0:1 ${fdt_addr} stm32mp157c-myboard.dtb

# 5. boot_kernel — 启动内核
boot_kernel=bootz ${kernel_addr} - ${fdt_addr}
```

### 双分区 A/B 启动 (安全升级)

```bash
# A/B 分区的 bootcmd
# boot_a 和 boot_b 分别从分区 A 和 B 启动

boot_a=setenv bootpart 1; fatload mmc 0:1 ${kernel_addr} zImage_a; fatload mmc 0:1 ${fdt_addr} board_a.dtb; bootz ${kernel_addr} - ${fdt_addr}

boot_b=setenv bootpart 2; fatload mmc 0:1 ${kernel_addr} zImage_b; fatload mmc 0:1 ${fdt_addr} board_b.dtb; bootz ${kernel_addr} - ${fdt_addr}

# 尝试次数控制
boot_limit=3
altbootcmd=run boot_b  # 备用启动

# bootcmd 逻辑:
# 尝试从 A 启动, 如果失败 3 次自动切到 B
```

### 恢复出厂/救援模式

```bash
# 硬件检测 (按键/GPIO 触发救援)
if gpio input 42; then
    echo "Rescue mode: USB recovery"
    run usb_recovery
else
    run normal_boot
fi
```

---

## 4. 移植实战

### 从参考板移植

```bash
# 步骤:
# 1. 找到最相似的参考板
ls board/st/stm32mp1/    # STM32MP1 系列
ls board/freescale/       # i.MX 系列

# 2. 复制参考板配置
cp configs/stm32mp157c-dk2_defconfig configs/myboard_defconfig
cp -r board/st/stm32mp157c-dk2 board/mycompany/myboard

# 3. 修改 board/mycompany/myboard/board.c
#    - 修改 UART 引脚 (debug 串口)
#    - 修改 DRAM 大小和时序
#    - 修改 PMIC (如果有不同)
#    - 修改网口 PHY 地址

# 4. 修改 defconfig
#    - CONFIG_DEFAULT_DEVICE_TREE="myboard"
#    - 启用自己的外设驱动

# 5. 创建设备树
cp arch/arm/dts/stm32mp157c-dk2.dts arch/arm/dts/myboard.dts
# 修改: UART、网口、USB、SD/eMMC 的 pinmux 和状态

# 6. 构建
make myboard_defconfig
make -j$(nproc) DEVICE_TREE=myboard
```

### 调试启动问题

```bash
# 1. 开启详细输出
# defconfig: CONFIG_LOG=y, CONFIG_LOGLEVEL=7
# 或在运行时设置: log level 7

# 2. 打印当前信息
=> bdinfo            # 板级信息 (DRAM 大小, 频率等)
=> mmc info          # MMC/eMMC 状态
=> dm tree           # 设备模型树 (查看有哪些设备 probe 成功)
=> ext4ls mmc 0:2    # 列出分区内容

# 3. 读内存验证 DRAM
=> mw 0x80000000 0xAA55 100   # 写 DDR 起始地址
=> md 0x80000000 10            # 读回验证

# 4. 手工加载内核
=> fatload mmc 0:1 0xC0000000 zImage
=> fatload mmc 0:1 0xC4000000 myboard.dtb
=> setenv bootargs console=ttySTM0,115200 root=/dev/mmcblk0p3 rw
=> bootz 0xC0000000 - 0xC4000000
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | SPL 无输出 | 串口或 DRAM 未初始化 | 检查 `CONFIG_DEBUG_UART`; 确保 DRAM 时序正确 |
| 2 | `Card did not respond to voltage select!` | SD 卡电源/时钟问题 | 确认 SDMMC pinmux; 检查供电 |
| 3 | 内核启动后 kernel panic (rootfs 不对) | bootargs 中 root= 错误 | `mmc part` 确认分区表 |
| 4 | 网口不通 (ping 不了) | PHY 地址不正确 | `mii info` 扫描 PHY 地址 |
| 5 | 环境变量不保存 | ENV 存储介质配置不对 | 确认 `CONFIG_ENV_IS_IN_xxx` 与存储介质匹配 |
| 6 | DTB 加载但内核无相应设备 | DTB 和内核版本不匹配 | 使用内核树内的 DTS; 或确认 bindings 兼容 |
| 7 | U-Boot 可以启动但有 `Warning: xxx not found` | defconfig 启用了未实现的硬件 | 关闭 defconfig 中不需要的外设 |

---

## 6. 参考文档

1. Das U-Boot 官方文档: https://u-boot.readthedocs.io/
2. U-Boot 源码树: `doc/` 目录包含大量文档
3. "Mastering U-Boot" — Bootlin Training Materials
4. STM32MP1 U-Boot 移植: https://wiki.st.com/stm32mpu/wiki/U-Boot_overview
5. i.MX U-Boot 移植指南: NXP i.MX BSP Porting Guide
