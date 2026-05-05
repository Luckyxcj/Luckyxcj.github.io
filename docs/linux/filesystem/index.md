# 文件系统构建

> **文档说明**：本文档基于 Linux 文件系统设计、BusyBox/Buildroot 构建经验及嵌入式存储方案整理。

---

## 目录

1. [嵌入式文件系统概述](#1-嵌入式文件系统概述)
2. [initramfs 初始化 RAM 文件系统](#2-initramfs-初始化-ram-文件系统)
3. [SquashFS + OverlayFS 组合方案](#3-squashfs--overlayfs-组合方案)
4. [Flash 专用文件系统](#4-flash-专用文件系统)
5. [常见问题](#5-常见问题)

---

## 1. 嵌入式文件系统概述

```
嵌入式根文件系统布局:

  /
  ├── bin/          # 基本命令 (BusyBox)
  ├── sbin/         # 系统命令
  ├── lib/          # 共享库 (.so)
  ├── etc/          # 配置文件
  ├── dev/          # 设备节点 (devtmpfs)
  ├── proc/         # procfs (内核信息, 虚拟)
  ├── sys/          # sysfs (设备模型, 虚拟)
  ├── tmp/          # 临时文件 (tmpfs)
  ├── usr/
  │   ├── bin/
  │   └── lib/
  └── var/
      ├── log/
      └── run/
```

| 文件系统 | 存储介质 | 只读/读写 | 压缩 | 磨损均衡 | 适用场景 |
|---------|---------|----------|------|---------|---------|
| initramfs | RAM | 读写 | gzip | N/A (RAM) | 早期启动、应急恢复 |
| SquashFS | NOR/NAND/eMMC | 只读 | xz/lzo/zstd | 底层的 | 系统固件 |
| OverlayFS | — | 叠加层 | — | — | SquashFS + R/W 叠加 |
| ext4 | eMMC/SD | 读写 | 无 | 无 (依赖 FTL) | eMMC/SD 存储 |
| UBIFS | Raw NAND | 读写 | 可选 | 内置 | Raw NAND Flash |
| JFFS2 | NOR/NAND | 读写 | 可选 | 内置 | 小容量 NOR |
| FAT32 | SD | 读写 | 无 | 无 | 与 Windows 交换数据 |

---

## 2. initramfs 初始化 RAM 文件系统

initramfs 是嵌入在内核镜像中的 CPIO 压缩包，内核启动时解压到 RAM 作为初始根文件系统。

```
启动流程:

  Bootloader → Kernel + initramfs (内置)
                    ↓
              挂载 initramfs 为 /   (RAM 中运行)
                    ↓
              /init 启动 (BusyBox shell 或 systemd)
                    ↓
              挂载真正的 rootfs → switch_root
              (或继续在 initramfs 中运行)
```

### 构建 initramfs

```bash
# 手动构建 initramfs
mkdir -p initramfs/{bin,sbin,lib,etc,proc,sys,dev,tmp}
cd initramfs

# 1. 拷贝 BusyBox
cp /path/to/busybox/_install/* . -r

# 2. 拷贝必要的动态库 (如果 BusyBox 是动态链接的)
# arm-linux-gnueabihf-strip lib/*.so*
# 或直接用静态编译的 BusyBox

# 3. 创建 /init 脚本
cat > init << 'EOF'
#!/bin/sh

mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev

echo "initramfs ready"

# 尝试挂载真正的 rootfs
mount -t ext4 /dev/mmcblk0p2 /mnt
if [ $? -eq 0 ]; then
    exec switch_root /mnt /sbin/init
fi

# 否则在 initramfs 中执行 shell
exec /bin/sh
EOF
chmod +x init

# 4. 打包为 CPIO (不压缩, 内核编译时会压缩)
find . | cpio -o -H newc > ../initramfs.cpio

# 5. 内核配置:
# CONFIG_INITRAMFS_SOURCE="path/to/initramfs.cpio"
# 或指定目录: CONFIG_INITRAMFS_SOURCE="path/to/initramfs/"
```

---

## 3. SquashFS + OverlayFS 组合方案

这是嵌入式 Linux 最经典的文件系统架构：系统固件为只读 SquashFS，用户变更为 OverlayFS 上层。

```
SquashFS + OverlayFS 架构:

  ┌─────────────────────────┐
  │     OverlayFS (merged)    │  ← / 挂载点: 用户看到所有文件
  │   ┌──────────────────┐   │
  │   │ Upper (读写层)     │   │  ← ext4 分区 (用户配置、日志)
  │   │ /data/overlay/upper│    │
  │   ├──────────────────┤   │
  │   │ Lower (只读层)     │   │  ← SquashFS (系统固件)
  │   │ /data/system.sqsh │   │
  │   ├──────────────────┤   │
  │   │ Work (工作目录)    │   │  ← /data/overlay/work
  │   └──────────────────┘   │
  └─────────────────────────┘

  优点:
  - SquashFS 压缩 → 节省 Flash 空间 (50-70% 压缩率)
  - 系统升级 = 替换一个 .sqsh 文件
  - 恢复出厂 = 清空 upper 层
  - 系统文件绝对安全 (只读)
```

```bash
# 构建 SquashFS
mksquashfs rootfs/ rootfs.sqsh -comp xz -b 256K -noappend
# -comp xz: xz 压缩 (比 gzip 小 20-30%, 解压稍慢)
# -comp lzo: 快速解压 (适合低速 CPU)
# -comp zstd: 平衡 (zstd 速度快 + 压缩率好)
# -b 256K: 块大小 (越大压缩率越好, 但随机访问更慢)

# 挂载 OverlayFS
mkdir -p /data/overlay/upper
mkdir -p /data/overlay/work

mount -t squashfs /data/system.sqsh /mnt/ro
mount -t overlay overlay \
    -o lowerdir=/mnt/ro,upperdir=/data/overlay/upper,workdir=/data/overlay/work \
    /

# 固件更新:
# 1. 下载新的 system.sqsh
# 2. 校验 sha256
# 3. 移动到 /data/system_new.sqsh
# 4. 写入 U-Boot 环境变量: boot_b=load new sqsh
# 5. 重启
```

### OverlayFS 恢复出厂设置

```bash
#!/bin/sh
# 清空 upper 层, 恢复到出厂系统

umount /       # 卸载 OverlayFS (需要从 initramfs 执行)
rm -rf /data/overlay/upper/*
rm -rf /data/overlay/work/*
reboot
```

---

## 4. Flash 专用文件系统

### UBIFS (适用于 Raw NAND)

```bash
# UBIFS 构建 (Buildroot/Yocto 自动处理)
# 1. 创建 UBI 镜像
mkfs.ubifs -r rootfs/ -m 2048 -e 126976 -c 2048 -o rootfs.ubifs
# -m: 最小 I/O 单元 (页大小, 2KB)
# -e: 逻辑擦除块大小 (LEB = PEB - 2 × 页)
# -c: 最大 LEB 数量

# 2. 嵌入 UBI 镜像到 UBI 卷
ubinize -o rootfs.ubi -m 2048 -p 128KiB ubinize.cfg

# ubinize.cfg 内容:
# [ubifs]
# mode=ubi
# image=rootfs.ubifs
# vol_id=0
# vol_type=dynamic
# vol_name=rootfs
# vol_flags=autoresize
```

### JFFS2 (适用于小容量 NOR Flash)

```bash
mkfs.jffs2 -r rootfs/ -o rootfs.jffs2 \
    -e 64KiB -p -n \
    --pad=0x1000000  # 填充到 16MB
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 内核启动后 kernel panic (无 rootfs) | root= 参数错误或 rootfs 不可达 | 检查 bootargs; 确保 rootfs 在指定分区 |
| 2 | 系统更改丢失 (重启后恢复) | 挂载为只读或 upper 层在 tmpfs | 检查 overlay upper 在持久化分区上 |
| 3 | SquashFS 压缩后反而更大 | 选择非压缩格式或未启用压缩 | 添加 `-comp xz` 参数 |
| 4 | UBIFS 挂载失败 | UBI 分区信息不匹配 | 检查 MTD 分区表; 确认 `bch` 或 `hamming` ECC |
| 5 | 空间耗尽 `/` 变为只读 | Upper 层或 rootfs 写满 | `df -h` 确认; 扩大分区或清理日志 |
| 6 | JFFS2 挂载 5 分钟+ | 第一次挂载扫描整个分区建索引 | 用 `CONFIG_JFFS2_SUMMARY=y` 加速挂载 |

---

## 6. 参考文档

1. Linux Kernel 文档: `Documentation/filesystems/overlayfs.txt`, `squashfs.txt`
2. "OverlayFS in Practice" — Neil Brown (LWN)
3. BusyBox: https://busybox.net/downloads/BusyBox.html
4. Buildroot rootfs 构建文档: https://buildroot.org/downloads/manual/
5. "UBIFS presentation" — Adrian Hunter & Artem Bityutskiy
