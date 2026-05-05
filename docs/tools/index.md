# 工具链与调试

嵌入式开发工具链、调试技巧与效率工具。

---

## 目录

### [JTAG / SWD 调试](./jtag-swd)
CoreSight 架构详解、JTAG vs SWD 对比、OpenOCD/GDB 配置、SWO/RTT 高速日志、HardFault 栈回溯

### [逻辑分析仪使用](./logic-analyzer)
PulseView 配置、I2C/SPI/UART 协议解码、中断延迟测量、多通道同步分析

### [示波器技巧](./oscilloscope)
探头选择（×1 vs ×10）、晶振验证、电源纹波测量、串行总线解码

### [交叉编译工具链](./cross-compile-toolchain)
arm-none-eabi-gcc 安装、编译/链接选项精讲、完整 Makefile/CMake 模板

### [Make / CMake 构建](./make-cmake)
自动依赖跟踪、CMake 工具链配置、多 MCU 平台构建

### [串口调试助手](./serial-tools)
桌面工具对比、Linux 命令行串口、Python 串口脚本、USB 转 TTL 适配器选型

### [Git 版本控制](./git)
嵌入式 Git 工作流、.gitignore 最佳实践、子模块管理 SDK、固件版本自动标记
