# 嵌入式 Linux

嵌入式 Linux 系统开发，涵盖内核、驱动、文件系统与构建工具。

---

## 目录

### [内核裁剪与编译](./kernel-build/)
Kconfig 配置、交叉编译、内核模块编译

### [设备树开发](./device-tree/)
DTS 语法、常用节点属性、Overlay 叠加

### [字符设备驱动](./char-driver/)
file_operations、ioctl、中断、mmap

### [块设备驱动](./block-driver/)
blk-mq 框架、RAM disk 示例

### [文件系统构建](./filesystem/)
initramfs、SquashFS + OverlayFS 组合

### [Buildroot / Yocto](./build-systems/)
Buildroot 配置与添加包、Yocto Layer 与 Recipe

### [U-Boot 移植](./u-boot/)
板级初始化、环境变量、Bootcmd 定制
