# 低功耗模式详解

> **文档说明**：本文档基于 STM32 各系列参考手册 PWR 章节及 AN5105 (STM32G0 低功耗)、AN4621 (STM32L4 低功耗) 等应用笔记整理。

---

## 目录

1. [低功耗模式总览](#1-低功耗模式总览)
2. [各模式详解与代码](#2-各模式详解与代码)
3. [系列差异化对比](#3-系列差异化对比)
4. [Tickless 模式原理](#4-tickless-模式原理)
5. [唤醒源配置](#5-唤醒源配置)
6. [低功耗实战代码](#6-低功耗实战代码)
7. [常见问题与排查](#7-常见问题与排查)
8. [参考文档](#8-参考文档)

---

## 1. 低功耗模式总览

STM32 提供从轻度睡眠到深度关断的多级低功耗模式，功耗逐级递减但唤醒时间逐级递增。

```
功耗与唤醒时间权衡:

功耗高 ↑
       │  Run (全速运行)              168MHz:  ~80mA
       │  Sleep (CPU 停，外设运行)     ~20mA
       │  Stop 0/1 (所有时钟停)        ~500μA
       │  Stop 2                        ~5μA
       │  Standby (1.8V域断电)         ~2μA
       │  Shutdown (全断电)            ~0.3μA
       ↓
功耗低     唤醒时间增加 →

```

### 1.1 模式选择速查

| 模式 | CPU | 时钟 | SRAM | 唤醒时间 | 唤醒源 | 典型功耗 (F4) |
|------|-----|------|------|---------|--------|-------------|
| **Run** | 运行 | 全速 | 保持 | 0 | 任意 | ~80mA @168MHz |
| **Sleep** | 停 | 运行 | 保持 | 0μs | 任意中断/事件 | ~20mA |
| **Stop** | 停 | 停 (HSI/HSE) | 保持 | ~10μs | EXTI, RTC, IWDG | ~500μA |
| **Standby** | 停 | 停 | 丢失 | ~50μs | WKUP, RTC, IWDG | ~2μA |
| **Shutdown** | 停 | 停 | 丢失 | ~100μs | WKUP, RTC | ~0.3μA |

---

## 2. 各模式详解与代码

### 2.1 Sleep 模式

Sleep 模式只停止 CPU 内核，所有外设和时钟继续运行。这是"最轻"的低功耗模式，任意中断即可唤醒，零延迟。

```c
// 进入 Sleep 模式
void Enter_Sleep_Mode(void) {
    // 1. 清除 SLEEPDEEP 位 (选择 Sleep 模式而非 Stop/Standby)
    SCB->SCR &= ~SCB_SCR_SLEEPDEEP_Msk;

    // 2. 执行 WFI (Wait For Interrupt) 或 WFE (Wait For Event)
    __WFI();  // CPU 停在此处，中断到来后继续执行下一行
    // 或
    // __WFE(); // 与 WFI 的区别: SEV (Send Event) 指令也能唤醒
}

// 典型用法：在主循环空闲时进入 Sleep
void Main_Loop(void) {
    while (1) {
        if (Has_Work()) {
            Process_Work();
        } else {
            Enter_Sleep_Mode();  // 省电等待下一个中断
        }
    }
}
```

### 2.2 Stop 模式

Stop 模式停止所有时钟 (HSI/HSE/PLL)，但 SRAM 和寄存器内容保持不变。这是保持运行状态的最低功耗模式。

```c
// 进入 Stop 模式 (F4 系列)
void Enter_Stop_Mode(void) {
    // 1. 确保所有唤醒源配置完成 (EXTI)
    // HAL_PWR_EnableWakeUpPin(PWR_WAKEUP_PIN1);

    // 2. 进入 Stop 模式
    __HAL_RCC_PWR_CLK_ENABLE();
    HAL_PWR_EnterSTOPMode(PWR_MAINREGULATOR_ON, PWR_STOPENTRY_WFI);

    // 3. 唤醒后: 重新配置系统时钟
    // Stop 唤醒后 HSI 恢复运行 (因为 HSE 关了)
    SystemClock_Config();  // 重新配置完整的 PLL 系统时钟

    // 4. 恢复外设时钟
    __HAL_RCC_GPIOA_CLK_ENABLE();
    // ... 其他外设 ...
}
```

### 2.3 Standby 模式

Standby 是最深度的省电模式之一，SRAM 内容全部丢失，唤醒后执行复位。

```c
// 进入 Standby 模式
void Enter_Standby_Mode(void) {
    // 1. 使能 PWR 时钟
    __HAL_RCC_PWR_CLK_ENABLE();

    // 2. 使能唤醒引脚 (PA0-WKUP)
    HAL_PWR_EnableWakeUpPin(PWR_WAKEUP_PIN1);

    // 3. 清除 Wakeup 标志
    __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);

    // 4. 进入 Standby
    HAL_PWR_EnterSTANDBYMode();

    // 代码不会执行到这里 — Standby 唤醒后等同于复位
}

// 判断是从 Standby 唤醒还是冷启动
int main(void) {
    HAL_Init();

    if (__HAL_PWR_GET_FLAG(PWR_FLAG_SB) != RESET) {
        // Standby 唤醒!
        __HAL_PWR_CLEAR_FLAG(PWR_FLAG_SB);
        // 从备份寄存器恢复关键状态
        uint32_t saved_state = HAL_RTCEx_BKUPRead(&hrtc, RTC_BKP_DR1);
        // 快速恢复而非冷启动
    } else {
        // 冷启动 (上电复位)
    }

    SystemClock_Config();
    // ...
}
```

---

## 3. 系列差异化对比

| 特性 | F4 | G4 | L4 | U5 |
|------|-----|-----|-----|-----|
| Sleep 电流 | ~20mA | ~15mA | ~5mA | ~2.5mA |
| Stop 电流 | ~500μA | ~100μA | ~4μA | ~0.6μA |
| Standby 电流 | ~2μA | ~0.5μA | ~0.3μA | ~0.06μA |
| 唤醒时间 | 10μs (Stop) | 4μs (Stop0) | 5μs (Stop0) | 4μs (Stop0) |
| 备份 SRAM | 4KB (BKPSRAM) | 无 | 32 个备份寄存器 | 32 个备份寄存器 |
| STOPWUCK 超驰 | 无 | 有 | 有 | 有 |
| LPBAM (低功耗后台自主模式) | 无 | 无 | 无 | 有 (U5 独有) |

::: tip U5 系列的 LPBAM 革命
STM32U5 引入 LPBAM (Low-Power Background Autonomous Mode)，允许在 Stop 模式下由 LPDMA 和外设自主传输数据，而不唤醒 CPU。例如，在 Stop 模式下 LPDMA + ADC 可以持续采样，只有当缓冲区满时才唤醒 CPU 处理。这从根本上改变了低功耗系统的架构设计。
:::

---

## 4. Tickless 模式原理

FreeRTOS 的 Tickless (无滴答) 模式，利用 SysTick 唤醒 + RTC 补偿，让 CPU 在空闲时进入更深的睡眠 (Stop 而非 Sleep)。

```c
// FreeRTOS tickless 配置 (FreeRTOSConfig.h)
#define configUSE_TICKLESS_IDLE  2   // 0=关闭, 1=Sleep, 2=Stop

// 工作机制：
// 1. RTOS 空闲任务执行时，计算到下一个任务到期还有多长时间
// 2. 如果时间 > 设定的最小睡眠时间，则进入低功耗模式
// 3. 设置 RTC 闹钟在任务到期时唤醒
// 4. 进入 Stop 模式
// 5. RTC 闹钟或外部中断唤醒
// 6. 补偿 SysTick 计数器，恢复调度
```

---

## 5. 唤醒源配置

### 5.1 EXTI 外部中断唤醒

```c
// 配置按键唤醒 (PA0)
void Wakeup_GPIO_Config(void) {
    __HAL_RCC_GPIOA_CLK_ENABLE();

    GPIO_InitTypeDef gpio = {0};
    gpio.Pin = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_FALLING;  // 下降沿触发
    gpio.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOA, &gpio);

    HAL_NVIC_SetPriority(EXTI0_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}
```

### 5.2 RTC 闹钟唤醒

```c
// 配置 RTC 在 30 秒后唤醒
void RTC_Wakeup_Config(void) {
    RTC_TimeTypeDef sTime;
    RTC_DateTypeDef sDate;

    // 设置 RTC 闹钟时间 = 当前时间 + 30 秒
    HAL_RTC_GetTime(&hrtc, &sTime, RTC_FORMAT_BIN);
    HAL_RTC_GetDate(&hrtc, &sDate, RTC_FORMAT_BIN);

    sTime.Seconds += 30;
    if (sTime.Seconds >= 60) {
        sTime.Seconds -= 60;
        sTime.Minutes++;
    }

    HAL_RTC_SetAlarm_IT(&hrtc, &sTime, RTC_FORMAT_BIN, RTC_ALARM_A);
}
```

---

## 6. 低功耗实战代码

```c
// 完整的低功耗电池供电设备框架
// 传感器节点: 每 60 秒醒来一次，采集数据，发送后继续睡

#include "stm32l4xx_hal.h"
#include "low_power.h"

RTC_HandleTypeDef hrtc;
static uint32_t wakeup_count = 0;

void SystemClock_Config(void);  // 标准时钟配置

int main(void) {
    HAL_Init();
    SystemClock_Config();    // 80MHz (Run 模式)
    RTC_Init();

    while (1) {
        // ====== 工作阶段 (Run 模式, 80MHz) ======
        uint32_t sensor_data = Read_Sensor();     // I2C 读取传感器 (2ms)
        uint8_t packet[16];
        Prepare_Packet(packet, sensor_data);      // 打包数据 (0.5ms)
        BLE_Send_Packet(packet, sizeof(packet));  // BLE 发送 (5ms)
        HAL_Delay(10);                            // 等待 BLE 发送完成

        // ====== 进入超低功耗睡眠阶段 (Stop 2, ~4μA) ======
        // 总工作时间: ~17.5ms
        // 工作时间电流: ~8mA
        // 睡眠时间: 60s - 0.0175s = 59.9825s
        // 睡眠电流: ~4μA
        // 平均电流: (0.0175*8000 + 59.9825*4) / 60 ≈ 6.3μA
        // 200mAh 电池寿命: 200000/6.3 ≈ 31746 小时 ≈ 3.6 年

        wakeup_count++;

        // 配置 RTC 在 60 秒后唤醒
        RTC_AlarmConfig_Relative(60);

        // 进入 Stop 2 模式前保存上下文
        HAL_SuspendTick();                         // 暂停 SysTick
        HAL_PWREx_EnterSTOP2Mode(PWR_STOPENTRY_WFI);
        // ====== 60 秒后 RTC 唤醒，从这里继续执行 ======
        HAL_ResumeTick();                          // 恢复 SysTick

        // 重新配置时钟: Stop 2 唤醒后 HSI 16MHz 运行
        SystemClock_Config();                      // 恢复到 80MHz
    }
}

// 功耗对比 (同一硬件, 不同模式):
//   ── 无低功耗 (一直 Run):       平均 8mA    → 200mAh 电池用 1 天
//   ── Sleep (空闲时 Sleep):      平均 3mA    → 200mAh 电池用 3 天
//   ── Stop (空闲时 Stop):        平均 500μA  → 200mAh 电池用 17 天
//   ── Stop + 周期唤醒 (60s):     平均 6.3μA  → 200mAh 电池用 3.6 年
```

---

## 7. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 进入 Stop 后电流仍然 mA 级 | 有外设未关闭时钟，或 GPIO 浮空导致漏电 | 进入低功耗前 `HAL_RCC_DeInit()`，GPIO 配置为模拟模式 |
| 2 | Stop 模式下比 datasheet 高很多 | 调试器连接着！(SWD/JTAG 接口持续耗电) | 测量功耗时拔掉调试器 |
| 3 | Stop 唤醒后程序跑飞 | 唤醒后时钟没重配 | 在唤醒后立即调用 `SystemClock_Config()` |
| 4 | Standby 后备份寄存器内容丢失 | VBAT 引脚没接电池或电容 | 检查 VBAT 供电 |
| 5 | WFI 没有真正进入睡眠 | 中断标志已挂起，WFI 立刻返回 | 进入前清除所有挂起的中断标志 |
| 6 | GPIO 漏电通过未使用的引脚 | 浮空输入引脚对地有几十μA 的泄漏 | 将未使用的 GPIO 配置为 Analog 模式 (最省电) |
| 7 | 低功耗模式下 RTC 不走 | LSE (32.768kHz 晶振) 不起振 | 检查 LSE 晶振的负载电容和 PCB 布线 |

---

## 8. 参考文档

1. ST AN5105: STM32G0 系列低功耗模式
2. ST AN4621: STM32L4/L4+ 低功耗模式
3. ST AN5289: STM32U5 系列低功耗模式和 LPBAM
4. RM0090: STM32F4xx 参考手册 — PWR 章节
5. RM0351: STM32L4x6 参考手册 — PWR 章节
6. RM0456: STM32U5 参考手册 — PWR 章节
