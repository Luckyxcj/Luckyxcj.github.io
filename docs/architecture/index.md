# 系统架构

嵌入式系统整体架构设计，涵盖 MCU 选型、存储映射、中断系统、启动流程、电源管理等核心基础主题。

---

## 目录

### [MCU 选型指南](./mcu-selection/)
深入理解 MCU 选型的五维决策空间（性能、功耗、成本、生态、供货），掌握主流厂商对比和 STM32 全系列选型路径。

- [STM32 系列深度指南](./mcu-selection/stm32-guide) — 全系列命名规则、内核对比、迁移注意事项、CoreMark 跑分
- [多厂商 MCU 对比](./mcu-selection/vendor-comparison) — ST/NXP/TI/GD/Espressif 同级产品矩阵、国产替代策略

### [时钟系统](./clock/)
MCU 时钟树架构、PLL 配置计算、各系列(SystemClock_Config)代码实战、时钟切换与动态调频。

- [时钟配置实战](./clock/configuration) — F1/F4/G4/H7 完整配置代码、PLL 参数速查表、外设时钟使能

### [中断系统设计](./interrupt/)
NVIC 嵌套向量中断控制器深度解析、优先级分组与抢占机制、中断响应延迟测量、EXTI 配置。

- [NVIC 深度解析](./interrupt/nvic) — 向量表重定位、Tail-Chaining 优化、SysTick 配置
- [中断设计模式](./interrupt/design-patterns) — ISR 黄金法则、两级延迟处理、临界区保护、RTOS 协作

### [启动流程分析](./boot/)
从上电到 main() 的完整旅程，启动汇编文件逐行解析，.data/.bss 段搬运机制。

- [启动文件详解](./boot/startup) — Reset_Handler 汇编分析、全局变量初始化原理
- [自定义 Bootloader](./boot/bootloader) — Flash 分区、跳转逻辑、YModem 协议、OTA 安全校验

### [存储映射与内存管理](./memory-management/)
ARM Cortex-M 存储模型、链接脚本编写、堆与栈的运行时行为、MPU 内存保护。

- [链接脚本详解](./memory-management/linker-script) — MEMORY/SECTIONS 语法、自定义段、Map 文件分析
- [堆与栈管理](./memory-management/heap-stack) — 栈溢出检测、内存池替代 malloc、HardFault 栈回溯

### [电源管理与低功耗](./power-management/)
Sleep/Stop/Standby 模式选择、唤醒源配置、Tickless 原理、电池寿命估算。

- [低功耗模式详解](./power-management/low-power-modes) — 各系列功耗对比、Stop 2 实战代码、LPBAM 介绍
- [低功耗设计实战](./power-management/design-practice) — 功耗预算表、十大优化技巧、硬件电路设计

### [看门狗与系统复位](./watchdog/)
IWDG/WWDG 选择策略、多级看门狗架构、复位源识别、功能安全基础。

- [IWDG 与 WWDG 实战](./watchdog/iwdg-wwdg) — LSI 校准、调试暂停、看门狗自检
