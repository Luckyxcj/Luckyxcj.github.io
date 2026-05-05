# Buildroot / Yocto 构建系统

> **文档说明**：本文档基于 Buildroot/Yocto 官方手册及嵌入式 Linux 产品构建实践经验整理。

---

## 目录

1. [Buildroot vs Yocto](#1-buildroot-vs-yocto)
2. [Buildroot 快速构建](#2-buildroot-快速构建)
3. [Buildroot 添加自定义包](#3-buildroot-添加自定义包)
4. [Yocto Layer 与 Recipe](#4-yocto-layer-与-recipe)
5. [常见问题](#5-常见问题)

---

## 1. Buildroot vs Yocto

| 特性 | Buildroot | Yocto |
|------|----------|-------|
| 定位 | 简单、快速、全自动 | 灵活、可定制、工业级 |
| 构建时间 (首次) | 10-30 分钟 | 1-4 小时 |
| 学习曲线 | 低 | 高 |
| 包管理 | 无 (全静态) | 有 (rpm/deb/ipk) |
| 软件包数量 | ~2500 | ~8000+ (layers 组合) |
| 缓存/SDK | 无 | 有 (共享状态缓存 + SDK) |
| 适用 | 快速原型、单项目 | 多产品、团队协作 |
| 代表用户 | 个人开发者、小团队 | 工业、汽车、医疗 (Yocto/OE) |

```
选型建议:

  单板快速原型 → Buildroot (15 分钟出固件)
  多产品线维护 → Yocto (Layer 复用, 配方管理)
  需要 SDK 给应用开发 → Yocto (标准 SDK)
  资源受限 MCU → Buildroot (轻量)
```

---

## 2. Buildroot 快速构建

```bash
# Buildroot 完整构建流程
git clone https://github.com/buildroot/buildroot.git
cd buildroot

# 1. 列出支持的开发板
make list-defconfigs | grep stm32

# 2. 选择配置
make stm32mp157c_dk2_defconfig

# 3. 自定义配置
make menuconfig
#    Target options → 选择 CPU / 架构
#    Toolchain → 选择外部工具链或内部构建
#    System configuration → 主机名/欢迎语/root 密码
#    Kernel → 内核版本/defconfig/补丁
#    Target packages → 选择要安装的软件包
#    Filesystem images → ext4/SquashFS/UBIFS 镜像格式

# 4. 构建
make -j$(nproc)
# 输出在 output/images/:
#   zImage / uImage          (内核)
#   stm32mp157c-dk2.dtb      (设备树)
#   rootfs.ext4 / rootfs.tar (根文件系统)
#   sdcard.img               (完整 SD 卡镜像, 如果配置了)

# 5. 烧录到 SD 卡
dd if=output/images/sdcard.img of=/dev/sdb bs=4M status=progress
```

### Buildroot 目录结构

```
buildroot/
├── package/          # 所有软件包的 .mk 文件
├── configs/          # 开发板 defconfig
├── board/            # 开发板特定文件 (启动脚本、DTB 等)
├── output/
│   ├── build/        # 软件包构建目录
│   ├── host/         # 主机工具 (交叉编译器)
│   ├── images/       # 生成镜像
│   └── target/       # 目标根文件系统 (未打包)
└── dl/               # 下载的源码包
```

---

## 3. Buildroot 添加自定义包

### 通用包 (使用 Autotools / CMake)

```makefile
# package/myapp/myapp.mk

MYAPP_VERSION = 1.0
MYAPP_SITE = http://example.com/releases
MYAPP_SOURCE = myapp-$(MYAPP_VERSION).tar.gz
MYAPP_LICENSE = GPL-2.0

# 依赖
MYAPP_DEPENDENCIES = libfoo libbar

# CMake 构建
MYAPP_CONF_OPTS = -DENABLE_FEATURE=ON

$(eval $(cmake-package))  # 或 $(eval $(autotools-package))
```

```makefile
# package/myapp/Config.in
config BR2_PACKAGE_MYAPP
    bool "myapp"
    select BR2_PACKAGE_LIBFOO
    help
      My application description.
```

然后在 `package/Config.in` 中引用:
```bash
menu "My packages"
    source "package/myapp/Config.in"
endmenu
```

### 本地 Git 仓库包

```makefile
# package/myapp/myapp.mk
MYAPP_VERSION = 1.0
MYAPP_SITE = /path/to/local/myapp
MYAPP_SITE_METHOD = local
MYAPP_LICENSE = MIT

define MYAPP_BUILD_CMDS
    $(MAKE) CC=$(TARGET_CC) -C $(@D)
endef

define MYAPP_INSTALL_TARGET_CMDS
    $(INSTALL) -D -m 0755 $(@D)/myapp $(TARGET_DIR)/usr/bin/myapp
endef

$(eval $(generic-package))
```

---

## 4. Yocto Layer 与 Recipe

### Yocto 核心概念

```
Yocto 构建流程:

  Metadata (.bb + .bbappend + .conf)
      ↓
  BitBake (任务调度器)
      ↓
  ┌─────────────────────────────┐
  │ fetch → unpack → patch      │
  │ → configure → compile       │
  │ → install → package → done  │
  └─────────────────────────────┘
      ↓
  输出: rootfs + SDK + Package Feed
```

### Recipe 示例

```bitbake
# recipes-core/myapp/myapp_1.0.bb

SUMMARY = "My Application"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=xxx"

SRC_URI = "git://github.com/user/myapp.git;protocol=https;branch=main"
SRCREV = "abc123def456"

inherit cmake

DEPENDS = "libfoo libbar"

do_install:append() {
    install -d ${D}${bindir}
    install -m 0755 ${B}/myapp ${D}${bindir}
}

FILES:${PN} += "${bindir}/myapp"
```

### Layer 结构

```
meta-mycompany/
├── conf/
│   └── layer.conf         # LAYER 描述
├── recipes-core/
│   └── base-files/
│       └── base-files_%.bbappend  # 覆写/追加原有配方
├── recipes-kernel/
│   └── linux/
│       ├── linux-stm32_%.bbappend
│       └── files/
│           └── defconfig         # 自定义内核配置
├── recipes-bsp/
│   └── u-boot/
│       └── u-boot-stm32_%.bbappend
└── recipes-support/
    └── myapp/
        ├── myapp_1.0.bb
        └── files/
            └── myapp-init.sh
```

```bitbake
# conf/layer.conf
BBPATH .= ":${LAYERDIR}"
BBFILES += "${LAYERDIR}/recipes-*/*/*.bb ${LAYERDIR}/recipes-*/*/*.bbappend"
BBFILE_COLLECTIONS += "meta-mycompany"
BBFILE_PATTERN_meta-mycompany = "^${LAYERDIR}/"
BBFILE_PRIORITY_meta-mycompany = "6"
LAYERSERIES_COMPAT_meta-mycompany = "kirkstone"
```

### .bbappend 追加文件

```bitbake
# recipes-kernel/linux/linux-stm32_%.bbappend
# % = 任意版本号, 覆写所有版本的 linux-stm32 recipe

FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://defconfig"
SRC_URI += "file://0001-my-kernel-patch.patch"

# 内核模块
KERNEL_MODULE_AUTOLOAD += "mydriver"
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | Buildroot 首次构建太慢 | 下载源码 + 构建工具链 | 使用 BR2_PRIMARY_SITE 内部镜像; 保留 `dl/` 目录 |
| 2 | Yocto `bitbake` 找不到 recipe | Layer 未添加 | `bitbake-layers add-layer meta-xxx` |
| 3 | Buildroot 下载失败 | 网络不通或 URL 失效 | 查看 `dl/` 中缺失; 手动下载放 `dl/` |
| 4 | Yocto 构建卡住 | 任务因依赖冲突挂起 | `bitbake -v -D <recipe>` 查看详细 |
| 5 | 自定义包编译失败 | 交叉编译环境变量/路径不对 | 使用 `$(TARGET_MAKE_ENV)` 设置环境 |
| 6 | Buildroot 镜像太大 | 选了太多软件包 | `make graph-size` 查看各包占用 |
| 7 | Yocto sstate 缓存不命中 | 配方或 meta 数据变化 | `bitbake -c cleansstate <recipe>` 清理 |

---

## 6. 参考文档

1. Buildroot 用户手册: https://buildroot.org/downloads/manual/manual.html
2. Yocto Project 文档: https://docs.yoctoproject.org/
3. "Embedded Linux Development with Yocto Project" — Otavio Salvador
4. STM32MP1 Wiki (Buildroot & Yocto): https://wiki.st.com/stm32mpu/
5. Bootlin 培训材料 (Yocto): https://bootlin.com/doc/training/yocto/
