# IWDG 与 WWDG 对比及实战

> **文档说明**：本文档涵盖独立看门狗和窗口看门狗的应用场景对比、精确定时配置和高级使用技巧。

---

## 目录

1. [IWDG 与 WWDG 选择指南](#1-iwdg-与-wwdg-选择指南)
2. [IWDG 高级配置](#2-iwdg-高级配置)
3. [WWDG 高级配置](#3-wwdg-高级配置)
4. [调试时如何暂停看门狗](#4-调试时如何暂停看门狗)
5. [看门狗在功能安全中的应用](#5-看门狗在功能安全中的应用)
6. [完整的看门狗代码示例](#6-完整的看门狗代码示例)

---

## 1. IWDG 与 WWDG 选择指南

```
选择 IWDG 如果你需要:
├─ 独立于系统时钟的保护 (系统时钟坏了仍能复位)
├─ 最简单可靠的最后防线
├─ 不关心超时精度
└─ 一旦启动永不关闭的保障

选择 WWDG 如果你需要:
├─ 精确的定时超时 (基于 PCLK)
├─ 提前中断 (在复位前做紧急保存)
├─ 窗口机制 (检测异常的代码执行时序)
└─ 调试时可以暂停 (DBGMCU 中可配置)
```

---

## 2. IWDG 高级配置

### 2.1 使用 RTC 校准 LSI 频率

由于 LSI 频率偏差大，可以用更精确的 HSE/LSE 来校准它：

```c
// 使用 TIM 测量 LSI 的实际频率
// 原理: 用 HSE (8MHz) 作为计时基准，测量 LSI 的周期
float Measure_LSI_Frequency(void) {
    // TIM5 输入捕获: CH1 捕获来自 LSI 的信号
    // 时基: PCLK1 = 42MHz (来自 HSE/PLL)

    // 实测 LSI 周期 = (捕获差值 / 42MHz)
    // LSI 频率 = 1 / 周期

    // 返回实际 LSI 频率 (Hz)
    uint32_t capture_diff = /* 两次捕获间的计数值 */;
    float lsi_freq = 42000000.0f / capture_diff;
    return lsi_freq;
}

// 使用校准后的 LSI 配置 IWDG
void IWDG_Init_Calibrated(void) {
    float lsi_freq = Measure_LSI_Frequency();

    // 根据实际 LSI 频率计算重装载值
    // 想要 2 秒超时: Reload = 2 * lsi_freq / Prescaler
    uint32_t prescaler = 64;
    uint32_t reload = (uint32_t)(2.0f * lsi_freq / prescaler);

    hiwdg.Instance = IWDG;
    hiwdg.Init.Prescaler = IWDG_PRESCALER_64;
    hiwdg.Init.Reload = reload;
    HAL_IWDG_Init(&hiwdg);
}
```

---

## 3. WWDG 高级配置

### 3.1 计算 WWDG 超时时间

```
WWDG 超时计算公式:

t_WWDG = t_PCLK1 × 4096 × 2^WDGTB × (T[5:0] + 1)

其中:
  t_PCLK1    = 1 / PCLK1 频率
  WDGTB (预分频) = 0→1, 1→2, 2→4, 3→8
  T[5:0]     = 计数器低 6 位 (递减计数器低 6 位)

当 PCLK1 = 42MHz, WDGTB = 3 (÷8), T=0x7F→0x3F:
  t = (1/42e6) × 4096 × 8 × (0x40) = 0.0238e-6 × 32768 × 64
    ≈ 49.93 ms

当计数器从 0x7F 减到 0x3F 时, 有 49.93ms 的时间窗口
```

### 3.2 调试模式下的看门狗控制

```c
// 在调试时冻结看门狗 (调试器停止时, 看门狗计时也停止)
void DBGMCU_Freeze_Watchdogs(void) {
    // 必须在 SystemInit() 之后立即调用，否则一旦使能了看门狗就无法停止了
    DBGMCU->APB1FZ |= DBGMCU_APB1_FZ_DBG_IWDG_STOP
                   |  DBGMCU_APB1_FZ_DBG_WWDG_STOP;
    // 注意: 这只在调试器连接时有效。芯片独立运行时，看门狗照常运行。
}
```

---

## 4. 调试时如何暂停看门狗

::: danger 量产固件中切勿包含此配置!
此配置仅用于开发调试阶段，量产固件必须删除，否则看门狗形同虚设。
:::

```c
// 方法 1: DBGMCU 冻结 (调试器连接时)
DBGMCU->APB1FZ |= DBGMCU_APB1_FZ_DBG_IWDG_STOP;

// 方法 2: 条件编译 (开发版启用, 量产版禁用)
#ifdef DEBUG_BUILD
    // 不启动 IWDG
#else
    IWDG_Init();  // 量产启用
#endif

// 方法 3: 通过选项字节在硬件层面配置
// 在 CubeProgrammer 中设置 IWDG_SW = 1 (软件启动, 默认)
// 如果设置 IWDG_SW = 0 (硬件启动, 上电即自动运行)
```

---

## 5. 看门狗在功能安全中的应用

在功能安全标准 (如 ISO 26262, IEC 61508) 中，看门狗是 **Safety Element** 的一部分：

1. **外部看门狗 (External WDG)**：使用独立于 MCU 的看门狗芯片 (如 TPS3823)，即使 MCU 时钟完全失效也能复位。这是安全等级 SIL-2/ASIL-B 以上的常见要求。

2. **内部看门狗 (Internal WDG)**：IWDG 和 WWDG 互为补充。WWDG 作为"智能"看门狗检测时序异常，IWDG 作为"笨"看门狗保证最后复位。

3. **看门狗测试**：功能安全要求定期测试看门狗本身功能是否正常（不能等到真正卡死时才"测试"看门狗）。

```c
// 看门狗自检 (功能安全标准要求)
void Watchdog_SelfTest(void) {
    // 1. 记录 IWDG 的当前计数值
    // 2. 等待一小段时间
    // 3. 确认计数器确实在递减
    // 4. 如果计数器没变 → 看门狗时钟源失效 → 报告故障

    uint32_t cnt_before = IWDG->KR;  // 只能通过一定方法间接检测
    // (实际实现需要结合外部硬件辅助)

    HAL_Delay(10);
    // ... 检测计数器变化 ...
}
```

---

## 6. 完整的看门狗代码示例

```c
// 完整的多级看门狗系统 (适用于生产环境)
#include "stm32f4xx_hal.h"

// ====== IWDG 看门狗 (硬件最后防线) ======
#define IWDG_TIMEOUT_MS  2000    // 2 秒超时

IWDG_HandleTypeDef hiwdg;

void IWDG_Hardware_Init(void) {
    hiwdg.Instance = IWDG;
    hiwdg.Init.Prescaler = IWDG_PRESCALER_64;  // LSI/64 ≈ 625Hz
    hiwdg.Init.Reload = (uint16_t)((float)IWDG_TIMEOUT_MS / 1000.0f * 625.0f);
    // ≈ 1250 (2 秒超时)

    HAL_IWDG_Init(&hiwdg);  // 启动后无法停止!
}

// ====== 软件看门狗 (RTOS 任务级别) ======
#define SOFT_WDG_TIMEOUT_MS  500
#define NUM_TASKS             4

typedef enum {
    TASK_COMM = 0,      // 通信任务
    TASK_SENSOR = 1,    // 传感器数据采集
    TASK_CONTROL = 2,   // 控制算法
    TASK_LOGGING = 3,   // 日志记录
} TaskID_t;

typedef struct {
    uint32_t last_feed[NUM_TASKS];
    uint32_t timeout_ms[NUM_TASKS];
    const char *task_name[NUM_TASKS];
} SoftWatchdog_t;

SoftWatchdog_t swdg = {
    .timeout_ms = {500, 500, 300, 1000},
    .task_name = {"Comm", "Sensor", "Control", "Logging"},
};

void SoftWDG_Feed(TaskID_t task_id) {
    if (task_id < NUM_TASKS) {
        swdg.last_feed[task_id] = HAL_GetTick();
    }
}

void SoftWDG_Check(void) {
    uint32_t now = HAL_GetTick();
    for (int i = 0; i < NUM_TASKS; i++) {
        if (swdg.last_feed[i] != 0 &&
            (now - swdg.last_feed[i]) > swdg.timeout_ms[i]) {
            // 记录哪个任务卡死了
            Error_Log("Task %s timeout!\n", swdg.task_name[i]);
            // 尝试恢复: 先试试删除并重建任务
            // 如果恢复失败: System_Reset();
        }
    }
}

// ====== 主循环中喂硬件看门狗 ======
void Main_Loop(void) {
    IWDG_Hardware_Init();

    while (1) {
        // 1. 检查软件看门狗 (所有任务是否健康)
        SoftWDG_Check();

        // 2. 做其他工作

        // 3. 喂硬件看门狗 (这是最后的安全网)
        HAL_IWDG_Refresh(&hiwdg);
    }
}
```

---

## 7. 参考文档

1. ST RM0090: STM32F4xx 参考手册 — 看门狗章节
2. IEC 61508-2 Annex A — Safety Functions for E/E/PE Systems
3. "Using the STM32 Hardware Watchdogs" — ST Application Note (Community)
4. TPS3823/TPS382x Processor Supervisory Circuits — TI Datasheet
