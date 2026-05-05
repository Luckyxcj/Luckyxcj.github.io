# 启动文件 (startup.s) 逐行解析

> **文档说明**：本文档基于 STM32 标准启动文件 (由 CubeMX 生成)、GCC 汇编器手册及 ARM CMSIS 规范整理。

---

## 目录

1. [启动文件的作用](#1-启动文件的作用)
2. [启动汇编逐段解析](#2-启动汇编逐段解析)
3. [复位处理流程](#3-复位处理流程)
4. [初始化全局变量 (.data 段搬运)](#4-初始化全局变量-data-段搬运)
5. [清零未初始化变量 (.bss 段)](#5-清零未初始化变量-bss-段)
6. [从 Reset_Handler 到 main()](#6-从-reset_handler-到-main)
7. [常见启动失败场景](#7-常见启动失败场景)
8. [参考文档](#8-参考文档)

---

## 1. 启动文件的作用

启动文件 (startup_stm32f407xx.s) 是 MCU 上电后第一个执行的代码。它完成四件事：

```
1. 定义中断向量表 (程序入口点)
2. 初始化堆栈指针 (MSP)
3. 跳转到 Reset_Handler (第一个执行的代码)
4. 提供所有中断处理函数的弱定义 (Default_Handler)
```

---

## 2. 启动汇编逐段解析

以下是 STM32F407 (GCC) 启动文件的核心部分，逐行解释：

### 2.1 栈和堆大小配置

```armasm
/* 栈大小定义 (Cortex-M 使用满递减栈) */
_estack = ORIGIN(RAM) + LENGTH(RAM);    /* 栈顶 = SRAM 结束地址 */

_Min_Heap_Size  = 0x200;   /* 堆最小 512 字节 (malloc 使用的区域) */
_Min_Stack_Size = 0x400;   /* 栈最小 1024 字节 (局部变量、中断入栈) */
```

### 2.2 中断向量表

```armasm
.section .isr_vector, "a", %progbits
.type g_pfnVectors, %object
.size g_pfnVectors, .-g_pfnVectors

g_pfnVectors:
  .word  _estack                        /* 0x0000: 初始化 MSP */
  .word  Reset_Handler                  /* 0x0004: 复位 → 第一个执行的代码 */
  .word  NMI_Handler                    /* 0x0008: 不可屏蔽中断 */
  .word  HardFault_Handler              /* 0x000C: 硬件故障 */
  .word  MemManage_Handler              /* 0x0010: 内存管理故障 */
  .word  BusFault_Handler               /* 0x0014: 总线故障 */
  .word  UsageFault_Handler             /* 0x0018: 未定义指令/除零等 */
  .word  0                              /* 0x001C: 保留 */
  .word  0                              /* 0x0020: 保留 */
  .word  0                              /* 0x0024: 保留 */
  .word  SVC_Handler                    /* 0x0028: 系统服务调用 (SVCall) */
  .word  DebugMon_Handler               /* 0x002C: 调试监视器 */
  .word  0                              /* 0x0030: 保留 */
  .word  PendSV_Handler                 /* 0x0034: 可挂起系统调用 (OS 调度) */
  .word  SysTick_Handler                /* 0x0038: 系统滴答定时器 (RTOS tick) */

  /* 外部中断向量 (按中断号排列) */
  .word  WWDG_IRQHandler                /* 窗口看门狗 */
  .word  PVD_IRQHandler                 /* PVD */
  .word  TAMP_STAMP_IRQHandler          /* 入侵/时间戳 */
  /* ... 更多外设中断向量 ... */
```

### 2.3 弱定义中断函数

```armasm
/* 弱定义: 用户如果在 main.c 中定义了同名函数，用户版本会覆盖此默认版本 */
.weak  NMI_Handler
.thumb_set NMI_Handler, Default_Handler

.weak  HardFault_Handler
.thumb_set HardFault_Handler, Default_Handler

/* 默认处理: 无限循环 (B . = 跳转到自身) */
Default_Handler:
  b .   /* ← 芯片停在这里不动，调试器可断住 */
```

::: tip 默认中断有用吗？
默认的 `b .` (死循环) 在开发阶段非常有用 —— 当未定义的中断触发时，芯片会停在这里，你可以通过调试器看到当前正在哪个 Default_Handler 中，从而定位是哪个中断触发了但没有编写 ISR。
:::

---

## 3. 复位处理流程

```armasm
.section .text.Reset_Handler, "ax", %progbits
.weak Reset_Handler
.type Reset_Handler, %function
Reset_Handler:
  /* ====== 第一步: 初始化数据段 (搬运 .data from Flash to SRAM) ====== */
  ldr r0, =_sdata        /* r0 = .data 段在 SRAM 的起始地址 */
  ldr r1, =_edata        /* r1 = .data 段在 SRAM 的结束地址 */
  ldr r2, =_sidata       /* r2 = .data 段在 Flash 的加载地址 (初始值存储处) */
  movs r3, #0
  b LoopCopyDataInit

CopyDataInit:
  ldr r4, [r2, r3]       /* 从 Flash 读 4 字节 */
  str r4, [r0, r3]       /* 写到 SRAM          */
  adds r3, r3, #4         /* 指针 +4             */

LoopCopyDataInit:
  adds r4, r0, r3
  cmp r4, r1
  bcc CopyDataInit        /* if (r0+r3 < r1) 继续循环 */

  /* ====== 第二步: 清零 .bss 段 (未初始化全局变量) ====== */
  ldr r2, =_sbss
  ldr r4, =_ebss
  movs r3, #0
  b LoopFillZerobss

FillZerobss:
  str r3, [r2]            /* 写 0 到 SRAM */
  adds r2, r2, #4

LoopFillZerobss:
  cmp r2, r4
  bcc FillZerobss

  /* ====== 第三步: 调用 SystemInit (时钟配置、FPU 使能等) ====== */
  bl SystemInit

  /* ====== 第四步: 调用 C 库初始化 (_start / __libc_init_array) ====== */
  bl __libc_init_array      /* 调用所有 C++ 构造函数 (.init_array 表) */

  /* ====== 第五步: 跳转到 main() ====== */
  bl main

  /* main() 不应该返回; 如果返回了, 执行这里 */
  bx lr
.size Reset_Handler, .-Reset_Handler
```

---

## 4. 初始化全局变量 (.data 段搬运)

```
Flash 布局:                      SRAM 布局:
┌──────────────┐                ┌──────────────┐
│ .text (代码)  │                │ .data (SRAM) │  ← 初始值从 Flash 搬来
│ ...          │                │ (RW 区)      │
│ _sidata ──→  │ initial values  │              │
│ ...          │       ╲         │              │
│              │        拷贝到 →  │              │
│              │                │ _sbss        │
│              │                │ .bss (0 区)  │  ← 全部写 0
│              │                │ _ebss        │
└──────────────┘                │ heap         │
                                │ ...          │
                                │ _estack (栈顶)│
                                └──────────────┘
```

**关键变量的来源**：
- `_sdata`, `_edata`, `_sidata`, `_sbss`, `_ebss` — 这些符号由链接脚本定义 (不是 C 代码中的变量)。
- Reset_Handler 通过这些符号知道该搬运哪些内存、搬到哪里。

---

## 5. 清零未初始化变量 (.bss 段)

```c
// .bss 段的 C 等价概念
int global_counter;          // .bss (未初始化, 上电后为 0)
static int instance_count;   // .bss (未初始化静态变量)

int initialized_var = 42;    // .data (已初始化, 值 42 存储在 Flash, 启动时搬移到 SRAM)

void func(void) {
    int local_var;           // 栈 (不参与 .bss)
    static int s_var = 100;  // .data (已初始化静态变量)
    static int s_zero;       // .bss
}
```

---

## 6. 从 Reset_Handler 到 main()

```
系统上电:
  │
  ├─ 硬件自动:
  │   1. MSP = 从向量表偏移 0x00 处读取 (_estack 值)
  │   2. PC  = 从向量表偏移 0x04 处读取 (Reset_Handler 地址)
  │   3. LR  = 0xFFFFFFFF (指示这是最外层的异常返回)
  │
  └─ Reset_Handler (软件):
      1. 搬运 .data 段 (Flash → SRAM)
      2. 清零 .bss 段
      3. SystemInit()
         ├─ 配置 FPU (CPACR 寄存器)
         ├─ 配置 Flash 等待周期
         ├─ 配置时钟源 (HSE/PLL)
         └─ 配置中断向量表偏移 (VTOR)
      4. __libc_init_array() [编译器自动生成]
         ├─ 调用 C++ 全局对象构造函数
         └─ 调用 __attribute__((constructor)) 修饰的函数
      5. main()
```

---

## 7. 常见启动失败场景

| # | 现象 | 原因 | 排查方法 |
|---|------|------|---------|
| 1 | 上电后完全无反应 | 晶振不起振或 Flash 等待周期错误 | 用示波器测晶振波形，降低主频测试 |
| 2 | 进入 HardFault_Handler | 时钟配置错误、栈溢出、非法内存访问 | 在 HardFault 中保存 SP 和 PC 值分析调用栈 |
| 3 | 全局变量初始值不对 | .data 段搬运失败或链接脚本错误 | 比较 `.data` 段在 Flash 和 SRAM 中的值 |
| 4 | main() 之前就进入 BusFault | 访问了未使能的外设总线上的地址 | 检查 SystemInit() 中是否有对未使能外设的访问 |
| 5 | Bootloader 跳转后 HardFault | 跳转前未正确复位外设或未设置 VTOR | 跳转前：`__disable_irq()`, 复位所有外设, 设置 MSP, 设置 VTOR, 跳转 |
| 6 | 向量表偏移不对 (VTOR) | BOOT 模式配置或链接脚本地址不匹配 | 检查 linker script 的 FLASH 起始地址是否匹配实际物理地址 |

---

## 8. 参考文档

1. ARM DDI 0403E: Cortex-M4 TRM — 复位和异常模型
2. ST Application Note AN2606: STM32 系统存储器启动模式
3. GNU Assembler (GAS) Manual — ARM 语法
4. GCC ARM Embedded Toolchain Documentation — Startup Code and Linker Scripts
5. STM32CubeF4 固件包中的 startup_stm32f407xx.s (启动文件标准范例)
