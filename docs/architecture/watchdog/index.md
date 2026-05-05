# 看门狗与系统复位

> **文档说明**：本文档基于 STM32 参考手册中 WWDG 和 IWDG 章节、ARM 系统复位机制及应用经验整理。

---

## 目录

1. [看门狗概述](#1-看门狗概述)
2. [独立看门狗 IWDG](#2-独立看门狗-iwdg)
3. [窗口看门狗 WWDG](#3-窗口看门狗-wwdg)
4. [看门狗设计策略](#4-看门狗设计策略)
5. [复位源识别与处理](#5-复位源识别与处理)
6. [常见问题与排查](#6-常见问题与排查)
7. [参考文档](#7-参考文档)

---

## 1. 看门狗概述

看门狗 (Watchdog) 是一个独立的倒计时定时器。当计时器归零时，触发系统复位。软件需要定期"喂狗"（重置计数器），以此证明系统仍在正常运行。

```
看门狗的工作原理:

     ┌── 喂狗 (重装载计数器) ←─── 正常运行的代码
     │
 ┌───▼──────┐
 │ 计数器     │
 │ ↓ 递减    │──→ 归零 ──→ 系统复位!
 └──────────┘
      ↑
      └── 如果代码卡死/跑飞 → 计数器一直递减 → 归零复位
```

STM32 提供两种看门狗：

| 特性 | IWDG (Independent) | WWDG (Window) |
|------|-------------------|---------------|
| 时钟源 | 独立 LSI (40kHz) | PCLK1 (42MHz 经预分频) |
| 供电域 | VDD 域 (独立) | VDD 域 |
| 独立性 | 与系统时钟无关 | 依赖系统时钟 |
| 窗口特性 | 无 (喂狗即重置) | 有 (必须在有效窗口内喂狗) |
| 触发中断 | 无 (直接复位) | 有 (提前中断, Early Wakeup) |
| 精确度 | 低 (LSI 频率偏差大) | 高 (PCLK 来源可靠) |

---

## 2. 独立看门狗 IWDG

```c
// IWDG 配置: 2 秒超时, 如果 2 秒内没有喂狗 → 复位
IWDG_HandleTypeDef hiwdg;

void IWDG_Init(void) {
    hiwdg.Instance = IWDG;
    hiwdg.Init.Prescaler = IWDG_PRESCALER_64;   // LSI/64 = 40000/64 = 625Hz
    hiwdg.Init.Reload = 1250;                    // 1250/625 = 2 秒
    // 超时 = (Reload × Prescaler) / LSI = (1250 × 64) / 40000 = 2s

    HAL_IWDG_Init(&hiwdg);
}

// 在关键代码路径上喂狗
void Main_Loop(void) {
    IWDG_Init();  // 启动 IWDG (启动后无法关闭!)

    while (1) {
        Do_Work();
        // 喂狗: 证明主循环还在正常迭代
        HAL_IWDG_Refresh(&hiwdg);
    }
}
```

::: warning IWDG 一旦启动就无法停止
IWDG 被设计为独立的硬件保护机制，启动后（往 KR 寄存器写入 0xCCCC 后）无法通过软件关闭。只有系统复位或上电重启才能停止它。这保证了即使代码失控，看门狗也不能被意外关闭。
:::

### 2.1 IWDG 的时间精度问题

LSI 的频率偏差很大（30kHz ~ 60kHz，典型 40kHz），因此 IWDG 不适合需要精确超时的场景。如果需要在低功耗模式下保持精确计时，用 RTC。

---

## 3. 窗口看门狗 WWDG

### 3.1 什么是"窗口"

WWDG 有"有效喂狗窗口"：必须在计数器降到窗口值以下、降到复位值之前这个窗口内喂狗。太早喂狗（计数器还 > 窗口值）或太晚喂狗（计数器已归零）都会触发复位。

```
计数器值
  0x7F ─┐
        │  不能喂狗 ← 太早! (在此区间喂狗会复位)
  0x50 ─┤──────────────── ← 配置的窗口上限
        │  ✅ 可以喂狗 (有效窗口)
        │  必须在这个区间内喂狗
        │  太晚! (在此区间喂狗会复位)
  0x3F ─┼──────────────── ← WWDG 自己产生提前中断
        │  ❌ 不能喂狗 (已触发复位)
   0x00 ─┘──→ 复位
```

```c
// WWDG 配置: PCLK1=42MHz, 预分频=8
// 窗口 = 0x50, 计数器初值 = 0x7F
// 喂狗窗口: 0x50 ~ 0x3F
WWDG_HandleTypeDef hwwdg;

void WWDG_Init(void) {
    hwwdg.Instance = WWDG;
    hwwdg.Init.Prescaler = WWDG_PRESCALER_8;
    hwwdg.Init.Window = 0x50;       // 窗口上限
    hwwdg.Init.Counter = 0x7F;      // 计数器初值
    // 超时周期 = 4096 × 2^prescaler × (Counter - 0x3F + 1) / PCLK1
    //         = 4096 × 8 × (0x7F-0x3F+1) / 42MHz
    //         = 4096 × 8 × 65 / 42000000 ≈ 50.7ms

    hwwdg.Init.EWIMode = WWDG_EWI_ENABLE;  // 使能提前唤醒中断
    HAL_WWDG_Init(&hwwdg);
}

// WWDG 提前唤醒中断 (在计数器降到 0x40 时触发)
// 可以在此时做紧急保存、喂狗
void WWDG_IRQHandler(void) {
    HAL_WWDG_IRQHandler(&hwwdg);
}

void HAL_WWDG_EarlyWakeupCallback(WWDG_HandleTypeDef *hwwdg) {
    // 在复位前做紧急处理 (时间很短)
    // 例如：将关键数据写入备份 SRAM
    // 注意: 此 ISR 的执行时间非常有限 (~几个 ms)
    HAL_WWDG_Refresh(hwwdg);  // 喂狗避免立即复位
}
```

---

## 4. 看门狗设计策略

### 4.1 多级看门狗策略

```
Level 1: IWDG (硬件最后防线)     → 2s 超时, 主循环喂狗
                                  证明: 主循环还在运行

Level 2: Soft Watchdog Timer     → 500ms 超时, 关键任务喂狗
                                  证明: 关键任务 (通信、控制) 还在运行

Level 3: Task Monitor (RTOS)     → 200ms 超时, 每个关键任务喂狗
                                  证明: 每个任务都正常运行
```

```c
// 多级看门狗实现
#define NUM_TASKS  3
typedef struct {
    uint32_t last_feed[NUM_TASKS];  // 每个任务的最后喂狗时间
    uint32_t timeout_ms[NUM_TASKS]; // 每个任务的超时限制
} TaskWatchdog_t;

TaskWatchdog_t task_wd;

// 任务喂狗函数
void Task_Feed_Watchdog(uint8_t task_id) {
    task_wd.last_feed[task_id] = HAL_GetTick();
}

// 看门狗监控任务 (最高优先级)
void Watchdog_Monitor_Task(void *pvParameters) {
    while (1) {
        for (int i = 0; i < NUM_TASKS; i++) {
            if (HAL_GetTick() - task_wd.last_feed[i] > task_wd.timeout_ms[i]) {
                // 某个任务超时未喂狗! 可以采取分级处理:
                // 1. 尝试重启该任务
                // 2. 记录错误日志
                // 3. 系统复位
                System_Reset();
            }
        }
        vTaskDelay(100);
    }
}
```

### 4.2 看门狗超时设计指南

- **太长 (> 10s)**：故障检测延迟太大，系统已经很危险了才复位
- **太短 (< 100ms)**：正常代码可能来不及喂狗，误复位
- **推荐**：IWDG 设置在 1-5 秒，给正常代码足够的时间，同时快速检测死锁

---

## 5. 复位源识别与处理

### 5.1 读取复位源

```c
// 在系统启动时，识别上次复位的来源
typedef enum {
    RESET_POWER_ON  = 0,   // 上电复位
    RESET_PIN       = 1,   // NRST 引脚复位
    RESET_SOFTWARE  = 2,   // 软件复位 (NVIC_SystemReset)
    RESET_IWDG      = 3,   // 独立看门狗复位
    RESET_WWDG      = 4,   // 窗口看门狗复位
    RESET_LOW_POWER = 5,   // 低功耗复位 (BOR/PVD)
    RESET_OBL       = 6,   // 选项字节加载复位
    RESET_UNKNOWN   = 7,
} Reset_Source_t;

Reset_Source_t Get_Reset_Source(void) {
    uint32_t csr = RCC->CSR;

    if (csr & RCC_CSR_IWDGRSTF) {
        __HAL_RCC_CLEAR_RESET_FLAGS();
        return RESET_IWDG;
    }
    if (csr & RCC_CSR_WWDGRSTF) {
        __HAL_RCC_CLEAR_RESET_FLAGS();
        return RESET_WWDG;
    }
    if (csr & RCC_CSR_SFTRSTF) {
        __HAL_RCC_CLEAR_RESET_FLAGS();
        return RESET_SOFTWARE;
    }
    if (csr & RCC_CSR_PORRSTF) {
        __HAL_RCC_CLEAR_RESET_FLAGS();
        return RESET_POWER_ON;
    }
    if (csr & RCC_CSR_PINRSTF) {
        __HAL_RCC_CLEAR_RESET_FLAGS();
        return RESET_PIN;
    }

    return RESET_UNKNOWN;
}

// 在 main() 开始时识别复位原因
int main(void) {
    HAL_Init();
    SystemClock_Config();

    Reset_Source_t reset_source = Get_Reset_Source();

    if (reset_source == RESET_IWDG || reset_source == RESET_WWDG) {
        // 看门狗复位! 记录日志, 检查异常状态
        Log_Watchdog_Reset();
        // 从备份寄存器中恢复关键数据
    } else if (reset_source == RESET_POWER_ON) {
        // 正常上电启动
    } else if (reset_source == RESET_SOFTWARE) {
        // 软件主动复位 (FOTA 完成等场景)
    }

    // ...
}
```

### 5.2 软件复位

```c
// 安全的软件复位
void System_Reset(void) {
    // 1. 禁用全局中断
    __disable_irq();

    // 2. 保存关键数据到备份 SRAM/Flash
    Save_Critical_State();

    // 3. 等待数据写入完成
    for (volatile int i = 0; i < 10000; i++);

    // 4. 执行系统复位
    NVIC_SystemReset();

    // 代码不会执行到这里
    while (1);
}
```

---

## 6. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 频繁的看门狗复位 | 喂狗间隔 > 超时，或代码有死循环 | 用调试器检查复位源；增加超时或增加喂狗频率 |
| 2 | IWDG 超时偏差大 | LSI 频率不准确 (30-60kHz) | IWDG 不适合精确计时；改用 WWDG 或 RTC |
| 3 | 空闲模式下 IWDG 复位 | 进入低功耗模式后没喂狗 | 用 RTC 闹钟定期唤醒喂狗，或关闭 IWDG 在低功耗前 |
| 4 | WWDG 喂狗太早也复位 | 窗口特性：喂狗时计数器还 > 窗口值 | 确认喂狗时机在有效窗口内 |
| 5 | 看门狗没启动 | IWDG 需要使能 LSI 时钟或写 IWDG_KR | 检查 IWDG_Init 返回值 |
| 6 | RTOS 挂了但看门狗没复位 | 如果主循环仍在喂狗，看门狗感知不到任务已死 | 必须用多级看门狗策略：主循环喂 IWDG，每个任务喂软件 WD |

---

## 7. 参考文档

1. RM0090: STM32F4xx 参考手册 — IWDG/WWDG 章节
2. RM0440: STM32G4xx 参考手册 — IWDG/WWDG 章节
3. "Watchdog Timer Best Practices" — Jack Ganssle, Embedded Systems Design
4. Barr Group Embedded C Coding Standard — 看门狗使用规则
