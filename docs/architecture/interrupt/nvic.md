# NVIC 嵌套向量中断控制器深度解析

> **文档说明**：本文档基于 ARM Cortex-M3/M4/M7 技术参考手册 (TRM) 中 NVIC 章节及 STM32 参考手册整理。

---

## 目录

1. [NVIC 硬件架构](#1-nvic-硬件架构)
2. [中断向量表](#2-中断向量表)
3. [优先级分组与抢占机制](#3-优先级分组与抢占机制)
4. [中断 Tail-Chaining 与 Late-Arriving](#4-中断-tail-chaining-与-late-arriving)
5. [SysTick 系统定时器](#5-systick-系统定时器)
6. [代码实战](#6-代码实战)
7. [常见陷阱](#7-常见陷阱)
8. [参考文档](#8-参考文档)

---

## 1. NVIC 硬件架构

```
                    ┌──────────────────────────────────┐
    外设中断请求 ──→│  NVIC                            │
     (IRQ0-239)     │  ┌─────────────────────────────┐ │
                    │  │ 优先级比较器 (硬件)           │ │
     NMI ──────────→│  │  - 抢占优先级 (Group)        │ │
                    │  │  - 子优先级 (Sub)            │ │
     HardFault ────→│  │  - 中断号 (向量表顺序)       │ │
                    │  └─────────────────────────────┘ │
                    │              │                   │
                    │              ↓                   │
                    │  ┌─────────────────────────────┐ │
                    │  │ 处理器内核接口               │ │
                    │  │  - 可以中断当前 ISR (嵌套)    │ │
                    │  │  - Tail-chaining 优化         │ │
                    │  │  - 自动入栈/出栈              │ │
                    │  └─────────────────────────────┘ │
                    └──────────────────────────────────┘
```

**关键特性**：
- NVIC 支持最多 240 个外部中断 (Cortex-M3/M4) 或 480+ (Cortex-M7)
- NMI (不可屏蔽中断) 和 HardFault 有固定的最高优先级 (-2 和 -1)
- 优先级数值越小，优先级越高
- 硬件自动处理嵌套中断的上下文保存 (自动入栈 xPSR, PC, LR, R12, R3-R0)

### 1.1 NVIC 寄存器组

| 寄存器 | 功能 | 位宽 |
|--------|------|------|
| NVIC_ISERx | 中断使能设置 | 32位 × 8 (设置对应位使能中断) |
| NVIC_ICERx | 中断使能清除 | 32位 × 8 (设置对应位禁用中断) |
| NVIC_ISPRx | 中断挂起设置 | 32位 × 8 (软件触发中断) |
| NVIC_ICPRx | 中断挂起清除 | 32位 × 8 (清除挂起状态) |
| NVIC_IABRx | 中断活跃状态 | 32位 × 8 (只读, 表示当前正在处理的中断) |
| NVIC_IPRx | 中断优先级 | 8位 × 60 (但只使用高 4-8 位) |
| NVIC_STIR | 软件触发中断 | 写入中断号以触发中断 |

---

## 2. 中断向量表

### 2.1 标准向量表布局 (Cortex-M4)

```
地址偏移    异常/中断
────────   ────────
0x0000     初始 SP 值 (MSP)
0x0004     Reset_Handler
0x0008     NMI_Handler
0x000C     HardFault_Handler
0x0010     MemManage_Handler
0x0014     BusFault_Handler
0x0018     UsageFault_Handler
0x0028     SVCall_Handler
0x002C     DebugMon_Handler
0x0030     PendSV_Handler
0x0034     SysTick_Handler
0x0038     保留
0x0040     WWDG_IRQHandler        ← 从这里开始是外设中断向量
0x0044     PVD_IRQHandler
...        ...
```

### 2.2 向量表重定位

```c
// 系统启动时 (SystemInit) 将向量表映射到 SRAM 或 Flash
// 默认：向量表在 Flash 起始地址 (0x0800 0000)

// 方法1: 将向量表移到 SRAM (用于 Bootloader 重映射场景)
SCB->VTOR = 0x20000000;  // 向量表现在位于 SRAM 起始位置

// 方法2: Flash 中的偏移 (IAP/Bootloader 场景)
// 假设 Bootloader 占用前 64KB，APP 从 0x08010000 开始
SCB->VTOR = 0x08010000;

// 向量表重映射的注意事项：
// 1. 必须先 copy 向量表到目标地址
// 2. 目标地址必须 128 字节对齐 (Cortex-M3/M4) 或 64 字对齐 (Cortex-M0+)
// 3. SCB->VTOR 写入后，所有中断响应都从新地址取向量
```

---

## 3. 优先级分组与抢占机制

### 3.1 优先级分组配置

Cortex-M 的中断优先级分为两部分：**抢占优先级 (Group Priority)** 和 **子优先级 (Sub Priority)**。

```
优先级分组通过 SCB->AIRCR 的 PRIGROUP 位配置：

PRIGROUP | 抢占优先级的位数 | 子优先级的位数 | 抢占优先级数 | 子优先级数
   0     |      0           |     4          |      1       |     16
   1     |      1           |     3          |      2       |     8
   2     |      2           |     2          |      4       |     4
   3     |      3           |     1          |      8       |     2
   4     |      4           |     0          |     16       |     1
   5     |      5 (M7 only)  |     3          |     32       |     8
   6     |      6 (M7 only)  |     2          |     64       |     4
   7     |      7 (M7 only)  |     1          |     128      |     2
```

**铁律速记**：
- **不同抢占优先级**的中断 → 高优先级可以抢占低优先级的 ISR (嵌套)
- **相同抢占优先级**的中断 → 不能互相抢占，按子优先级 + 向量表顺序排队
- **子优先级**只在同时挂起的同抢占优先级中断中决定谁先运行
- **硬件优先级固定**：Reset > NMI > HardFault > 其他 (这些不参与 NVIC 优先级配置)

### 3.2 优先级值计算

```c
// STM32 使用 4 位优先级实现（16 个优先级值, 0-15）
// HAL 库使用 NVIC_PRIORITYGROUP_4 (仅抢占优先级, 16 个级别)

void NVIC_Priority_Configuration(void) {
    // 设置优先级分组为 Group 4 (仅抢占优先级)
    HAL_NVIC_SetPriorityGrouping(NVIC_PRIORITYGROUP_4);

    // 配置各中断优先级 (优先级值越小越高)
    HAL_NVIC_SetPriority(USART1_IRQn,     0, 0);   // 最高优先级
    HAL_NVIC_SetPriority(TIM2_IRQn,       1, 0);   // 次高
    HAL_NVIC_SetPriority(EXTI0_IRQn,      2, 0);   // 中
    HAL_NVIC_SetPriority(USART2_IRQn,     3, 0);   // 低
    HAL_NVIC_SetPriority(DMA1_Stream0_IRQn, 4, 0); // 最低

    // 使能中断
    HAL_NVIC_EnableIRQ(USART1_IRQn);
    HAL_NVIC_EnableIRQ(TIM2_IRQn);
}
```

::: warning 默认优先级不是 0
STM32 HAL 初始化时，所有外设中断的默认优先级通常设置为 `0x0F` (最低优先级，值 15)。如果不主动调用 `HAL_NVIC_SetPriority()`，所有中断优先级相同，无法嵌套。这个设计是为了避免新手因中断嵌套导致堆栈溢出，但也意味着**高实时性 ISR 需要手动设置优先级**。
:::

---

## 4. 中断 Tail-Chaining 与 Late-Arriving

### 4.1 Tail-Chaining (尾链)

当一个 ISR 即将完成、另一个中断已经挂起时，处理器**跳过寄存器出栈+入栈**的开销，直接进入下一个 ISR。这节省了 17 个时钟周期的上下文切换开销。

```
Normal flow:   ISR1 执行 → 出栈(17 cycle) → 入栈(17 cycle) → ISR2 执行
Tail-chaining: ISR1 执行 → (省略出入栈) → ISR2 执行  [节省 34 cycle]
```

### 4.2 Late-Arriving (迟到中断)

当处理器正在为低优先级中断做入栈操作时，一个更高优先级中断到达。处理器会**先处理高优先级中断** (此时入栈已在进行中，高优先级中断不会重做入栈)。

---

## 5. SysTick 系统定时器

SysTick 是 Cortex-M 内核内置的 24 位倒计数定时器，通常用于 RTOS 滴答时钟。

```c
// SysTick 配置为 1ms 中断间隔
// 假设 HCLK = 168MHz
void SysTick_Config_1ms(void) {
    // SysTick 时钟 = HCLK (168MHz) 或 HCLK/8 (21MHz)
    // 使用 HCLK: 168,000,000 / 1000 = 168,000 ticks per 1ms
    // 使用 HCLK/8: 21,000,000 / 1000 = 21,000 ticks per 1ms

    // HAL 方法
    HAL_SYSTICK_Config(168000000 / 1000);  // 1ms
    HAL_SYSTICK_CLKSourceConfig(SYSTICK_CLKSOURCE_HCLK);

    // 寄存器方法
    // SysTick->LOAD  = 168000 - 1;   // 计数器重载值 (24-bit, 所以不能超 0xFFFFFF)
    // SysTick->VAL   = 0;             // 清除计数器
    // SysTick->CTRL  = 0x07;          // 使能 + 中断使能 + 使用 HCLK
}

// SysTick 中断处理 (1ms 间隔)
void SysTick_Handler(void) {
    HAL_IncTick();  // HAL 库的 tick 计数器自增
    // 用户代码：操作系统调度、软定时器等
}
```

---

## 6. 代码实战

### 6.1 外部中断 EXTI 配置

```c
// EXTI 中断配置 (GPIO 按键作为外部中断源)
void EXTI_Key_Init(void) {
    GPIO_InitTypeDef gpio = {0};

    __HAL_RCC_GPIOA_CLK_ENABLE();

    // 1. 配置 GPIO：PA0 作为输入，内部上拉
    gpio.Pin = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_FALLING;  // 下降沿触发中断
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(GPIOA, &gpio);

    // 2. 配置 NVIC 优先级并使能 EXTI0 中断
    HAL_NVIC_SetPriority(EXTI0_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

// 中断回调处理
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
    if (GPIO_Pin == GPIO_PIN_0) {
        // PA0 按键按下的处理逻辑
        // 注意：回调在 ISR 上下文中运行，不能做耗时操作
        // 通常使用标志位 + 主循环处理的方式 (deferred processing)
    }
}
```

### 6.2 测量中断响应延迟

```c
// 使用 DWT 周期计数器精确测量中断响应时间
volatile uint32_t isr_timestamp;
volatile uint32_t isr_latency;

void EXTI0_IRQHandler(void) {
    // 记录进入 ISR 的时间戳
    isr_timestamp = DWT->CYCCNT;
    // ... 中断处理逻辑 ...
    HAL_GPIO_EXTI_IRQHandler(GPIO_PIN_0);
}

// 主循环中计算延迟
void Measure_ISR_Latency(void) {
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk; // 使能 DWT 周期计数器

    // 触发中断 (如 GPIO 拉低)
    // ...
    // 计算: isr_latency = (isr_timestamp - trigger_timestamp) * (1/SYSCLK)
    // 典型 Cortex-M4 @168MHz: 延迟约 12-16 周期 (70-95ns)
}
```

---

## 7. 常见陷阱

| # | 陷阱 | 后果 | 正确做法 |
|---|------|------|---------|
| 1 | **ISR 内调用阻塞函数** (如 HAL_Delay, printf, 信号量等待) | 系统死锁或极长中断延迟 | ISR 内只做标志位置和极简操作，阻塞操作放到主循环 |
| 2 | **ISR 内未清除中断标志** | ISR 无限重复执行，主线程永远得不到执行 | 在 ISR 开始或结束时确认清除标志 |
| 3 | **ISR 内使用 printf 打印调试信息** | printf 可能通过 ITM RTT 或重定向到 UART，花费数十 ms | 使用 RTT (SWO) 极速日志，或只在错误处理用 printf |
| 4 | **忘记设置中断优先级，使用默认值 15** | 高实时性 ISR 被低优先级 ISR 阻塞 | 系统启动时显式设置每个 ISR 的优先级 |
| 5 | **优先级分组只在 Startup 设置一次** | 运行时修改导致已设置的中断优先级语义变化 | 在 main() 的开头只设置一次 HAL_NVIC_SetPriorityGrouping() |
| 6 | **中断中修改变量没有 volatile** | 编译器优化导致主循环读不到 ISR 修改的变量 | 中断与主循环共享的变量必须用 volatile |
| 7 | **在临界区 (关中断) 中做耗时操作** | 高优先级 ISR 延迟增大，可能丢数据 | 临界区时间控制在微秒级 |
| 8 | **多个中断使用相同的优先级但调度策略不当** | 关键 ISR 可能被同级 ISR 延迟 | 核心 ISR 给更低的优先级值(更高优先级) |

---

## 8. 参考文档

1. ARM DDI 0403E: Cortex-M4 技术参考手册 — NVIC 章节
2. ARM DDI 0489: Cortex-M7 技术参考手册 — NVIC 章节
3. RM0090: STM32F4xx 参考手册 — 中断和事件 章节
4. Joseph Yiu, "The Definitive Guide to ARM Cortex-M3/M4 Processors" — 第7-8章
5. ARM Application Note AN298: Cortex-M3 中断延迟测量
