# JTAG / SWD 调试

> **文档说明**：本文档基于 ARM CoreSight 调试架构、OpenOCD 用户手册、Segger J-Link 文档及实际调试经验整理。

---

## 目录

1. [调试接口概述](#1-调试接口概述)
2. [JTAG vs SWD 对比](#2-jtag-vs-swd-对比)
3. [主流调试器对比](#3-主流调试器对比)
4. [OpenOCD 配置与使用](#4-openocd-配置与使用)
5. [SWO / RTT 高速日志](#5-swo--rtt-高速日志)
6. [高级调试技巧](#6-高级调试技巧)
7. [常见问题与排查](#7-常见问题与排查)
8. [参考文档](#8-参考文档)

---

## 1. 调试接口概述

ARM Cortex-M 系列内置 CoreSight 调试架构，通过 JTAG 或 SWD 接口与外部调试器通信，提供断点、单步、内存读取、Flash 编程等功能。

```
调试系统架构:

┌──────────┐    SWD/JTAG    ┌──────────────┐    USB     ┌──────────┐
│  MCU     │←──────────────→│ 调试器        │←─────────→│ PC       │
│ (Target) │  2-5 线        │ (J-Link/     │           │ (IDE/GDB)│
└──────────┘                │  ST-Link等)  │           └──────────┘
                            └──────────────┘

CoreSight 调试组件:
  ├─ DAP (Debug Access Port) — 调试接口访问端口
  ├─ FPB (Flash Patch & Breakpoint) — 6 个硬件断点 + 字面量修补
  ├─ DWT (Data Watchpoint & Trace) — 4 个数据监控点
  ├─ ITM (Instrumentation Trace Macrocell) — SWO 输出 (printf 通过硬件)
  └─ TPIU (Trace Port Interface Unit) — 跟踪数据输出到 SWO 引脚
```

---

## 2. JTAG vs SWD 对比

| 特性 | JTAG | SWD |
|------|------|-----|
| 信号线数 | 5 (TMS, TCK, TDI, TDO, nTRST) | 2 (SWDIO, SWCLK) + 可选 SWO |
| 最高速度 | 50 MHz | 50+ MHz (SWD 通常更快) |
| 额外功能 | 边界扫描 (Boundary Scan) | 无边界扫描 |
| 占用引脚 | 5 个 | 2-3 个 (含 SWO) |
| 可靠性 | 较高 (差分逻辑) | 相同 (串行通信稳定) |
| 推荐 | 需要边界扫描的复杂 PCB 测试 | **嵌入式开发首选** (引脚少、速度快) |

```
SWD 引脚连接 (最简方案):

MCU                 调试器
SWDIO (PA13) ────────── SWDIO
SWCLK (PA14) ────────── SWCLK
GND         ────────── GND
(可选) SWO (PB3) ──── SWO (用于高速打印)
```

::: tip SWD 的引脚冲突
PA13 (SWDIO) 和 PA14 (SWCLK) 是 SWD 调试接口。如果在代码中将它们配置为普通 GPIO，调试器就会断开连接。对于量产不需要调试的固件可以重映射，但在开发阶段务必保留这两个引脚。
:::

---

## 3. 主流调试器对比

| 调试器 | 协议 | 价格 | MCU 支持 | 特色功能 |
|--------|------|------|----------|---------|
| **ST-Link V3 MINIE** | SWD/JTAG | ¥80 | STM32 | SWO 支持, 虚拟串口 |
| **J-Link EDU Mini** | SWD | ¥150 | 所有 ARM | RTT, Ozone 分析器 |
| **J-Link BASE** | SWD/JTAG | ¥3,500 | 所有 ARM | 无限断点, RTT, Ozone, J-Scope |
| **CMSIS-DAP (DAPLink)** | SWD | ¥25-80 | 所有 ARM | 开源, 拖放编程, 虚拟串口 |
| **Black Magic Probe** | SWD/JTAG | ¥200+ | 部分 ARM | 开源, GDB Server 内置于调试器 |
| **ST-Link V2 (克隆)** | SWD | ¥10-15 | STM32 | 极低价格, 没有 SWO |

### 3.1 调试器推荐

```
个人学习/业余项目:
  ├─ 最低成本: ST-Link V2 克隆 (¥10-15)
  ├─ 体验好: CMSIS-DAP (¥30-80, DAPLink 开源)
  └─ 专业入门: J-Link EDU Mini (¥150)

企业/团队开发:
  ├─ 日常工作: ST-Link V3 (¥80, ST 官方)
  └─ 深度调试: J-Link BASE (¥3,500, Ozone + RTT + J-Scope)
```

---

## 4. OpenOCD 配置与使用

OpenOCD 是开源的调试服务器，支持几乎所有调试器和芯片。

### 4.1 基本配置

```bash
# 启动 OpenOCD (J-Link + STM32F407)
openocd -f interface/jlink.cfg -f target/stm32f4x.cfg

# 启动 OpenOCD (ST-Link V2 + STM32F103)
openocd -f interface/stlink.cfg -f target/stm32f1x.cfg

# 启动 OpenOCD (CMSIS-DAP + STM32G474)
openocd -f interface/cmsis-dap.cfg -f target/stm32g4x.cfg
```

### 4.2 GDB 连接与调试

```bash
# 1. 启动 OpenOCD (另开一个终端)
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg

# 2. 启动 GDB
arm-none-eabi-gdb firmware.elf

# 3. GDB 中连接 OpenOCD
(gdb) target extended-remote :3333

# 4. 基本 GDB 命令
(gdb) monitor reset halt     # 复位并停止在第一条指令
(gdb) load                   # 下载程序到 Flash
(gdb) continue               # 全速运行
(gdb) Ctrl+C                 # 暂停 (在任意时刻)
(gdb) backtrace              # 查看调用栈
(gdb) info registers         # 查看寄存器
(gdb) print variable         # 打印变量
(gdb) break main.c:42        # 在 main.c 第 42 行设断点
(gdb) x/16x 0x20000000      # 查看 SRAM 中 16 个 32-bit 值
(gdb) monitor reset run      # 复位并运行
```

### 4.3 VS Code 调试配置

```json
// .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Cortex Debug",
            "cwd": "${workspaceRoot}",
            "executable": "./build/firmware.elf",
            "request": "launch",
            "type": "cortex-debug",
            "servertype": "openocd",
            "configFiles": [
                "interface/stlink.cfg",
                "target/stm32f4x.cfg"
            ],
            "svdFile": "STM32F407.svd",
            "runToEntryPoint": "main"
        }
    ]
}
```

---

## 5. SWO / RTT 高速日志

### 5.1 SWO (Serial Wire Output) — ST-Link V3 / J-Link

SWO 通过一根额外的信号线实现零 CPU 等待的 printf 输出。相比 UART printf 占用几十 ms，SWO 输出一条日志只需几百 ns。

```c
// SWO printf 配置 (使用 ITM)
// 在 main.c 中重定向 printf 到 SWO (ITM 端口 0)
int _write(int file, char *ptr, int len) {
    for (int i = 0; i < len; i++) {
        ITM_SendChar(*ptr++);  // 发送一个字符到 SWO 端口
    }
    return len;
}

// 使用: 就像普通 printf 一样, 但输出通过 SWO 而非串口
printf("ADC value = %d\n", adc_val);  // < 1μs 完成输出!
```

### 5.2 RTT (Real-Time Transfer) — J-Link 独有

RTT 是 Segger 的专利技术，通过在 SRAM 中放置一个环形缓冲区，J-Link 通过 SWD 接口读取该缓冲区。**不需要额外引脚，也不需要 UART**。

```c
// RTT 配置 (使用 Segger RTT 库)
#include "SEGGER_RTT.h"

// 初始化 (只需做一次)
SEGGER_RTT_Init();

// 打印日志 (与 printf 语法相同)
SEGGER_RTT_printf(0, "Task %s: sensor = %d\n", task_name, sensor_value);

// 在 PC 上查看:
// JLinkRTTViewer 或 JLinkRTTClient
```

| 日志方式 | 速度 | 需要引脚 | 调试器要求 | CPU 占用 |
|---------|------|---------|-----------|---------|
| UART printf | ~10-50ms/行 | TX/RX | 任意 | 高 (等待发送) |
| SWO printf | ~1μs/行 | SWO | ST-Link V3/J-Link | 极低 |
| RTT | ~1μs/行 | 无 (通过 SWD) | J-Link | 极低 |
| Semihosting | ~10ms/行 | 无 | 任意 | 极高 (阻塞 CPU) |

---

## 6. 高级调试技巧

### 6.1 DWT 非侵入式变量监控

```c
// 使用 DWT (Data Watchpoint and Trace) 计数器精确测量执行时间
// 不需要任何额外硬件

void DWT_Init(void) {
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

// 精确测量某段代码的执行时间
uint32_t start = DWT->CYCCNT;
Critical_Function();  // 被测代码
uint32_t end = DWT->CYCCNT;
uint32_t cycles = end - start;
float time_us = (float)cycles / (SystemCoreClock / 1000000.0f);
printf("Critical_Function: %lu cycles (%.2f us)\n", cycles, time_us);
```

### 6.2 查看 HardFault 调用栈

```c
// 在 HardFault_Handler 中添加全局变量，调试器中查看
volatile uint32_t fault_sp;
volatile uint32_t fault_pc;
volatile uint32_t fault_lr;

void HardFault_Handler(void) {
    __asm volatile (
        "MRS r0, MSP             \n"
        "LDR r1, =fault_sp       \n"
        "STR r0, [r1]            \n"
    );
    // 从栈帧中提取 PC 和 LR
    uint32_t *sp = (uint32_t *)__get_MSP();
    fault_pc = sp[6];  // 栈帧中的 PC
    fault_lr = sp[5];  // 栈帧中的 LR

    // 现在在调试器中看 fault_pc 就能知道是哪条指令出错了
    while (1);
}
```

### 6.3 Ozone 调试分析器 (J-Link 配套)

Ozone 是 Segger 提供的免费调试前端（配合 J-Link 使用时），提供：
- 指令跟踪 (Instruction Trace)
- 实时变量曲线图
- 代码覆盖率分析
- 函数调用时间分析

---

## 7. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | **No target connected / Target not detected** | SWD 线接反或接触不良；MCU 处于低功耗模式关闭了调试接口 | 检查接线；按住复位键再连接，连接成功后再释放 |
| 2 | **连接成功但无法下载程序** | Flash 被写保护 (RDP Level 1) | 用 STM32CubeProgrammer 解除 RDP (注意会擦除 Flash!) |
| 3 | **SWD 连接断开 (调试器找不到芯片)** | 代码将 PA13/PA14 配置为 GPIO | CubeMX 中检查 SWD 引脚是否启用 (SYS → Debug → Serial Wire) |
| 4 | **调试器连接时芯片功耗偏高** | SWD 接口本身耗电 (内部上拉) | 调试功耗时拔掉调试器；不能带着调试器测功耗 |
| 5 | **RTT 不输出数据** | J-Link 版本太旧或芯片 SRAM 区域改了 | 更新 J-Link 固件；检查 `SEGGER_RTT` 的缓冲区地址 |
| 6 | **SWO 没有输出** | PB3 被配置为 GPIO 或被 JTAG 占用 | 确保 SWO 引脚正确配置且 TPIU 已初始化 |
| 7 | **断点设不上 (最多 6 个硬件断点)** | Cortex-M 只有 6 个硬件断点 (FPB) | 关闭一些断点，或使用软件断点（Flash 中）。注意 Flash 断点会磨损 |
| 8 | **Cannot access memory** | 外设时钟未使能，该地址空间不可访问 | 确保在访问前已使能对应外设的时钟 |

---

## 8. 参考文档

1. ARM CoreSight Architecture Specification (ARM IHI 0029)
2. OpenOCD User Guide: https://openocd.org/doc/html/
3. Segger J-Link User Manual: https://www.segger.com/downloads/jlink/
4. ARM DAPLink (CMSIS-DAP): https://github.com/ARMmbed/DAPLink
5. Black Magic Probe: https://github.com/blackmagic-debug/blackmagic
6. "Cortex-M Debugging" — ST Community Wiki
