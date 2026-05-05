# FreeRTOS 软件定时器

> **文档说明**：本文档基于 FreeRTOS 官方文档及嵌入式项目实践经验整理。

---

## 目录

1. [软件定时器基础](#1-软件定时器基础)
2. [定时器守护任务原理](#2-定时器守护任务原理)
3. [API 使用与实战代码](#3-api-使用与实战代码)
4. [常见问题](#4-常见问题)

---

## 1. 软件定时器基础

软件定时器不依赖硬件定时器外设，由 FreeRTOS 内核的**定时器守护任务 (Timer Service Task)** 统一管理。适用于周期性任务、超时检测等不需要精确定时的场景。

| 特性 | 软件定时器 | 硬件定时器 |
|------|-----------|-----------|
| 精度 | ms 级 (受 Tick 限制) | μs 级 |
| 数量 | 无限制 (仅受 RAM 限制) | 受外设数量限制 |
| 上下文 | 定时器回调 (任务上下文) | ISR 上下文 |
| 适用场景 | 协议超时、状态轮询 | PWM 生成、精确捕获 |

### 定时器类型

| 类型 | 行为 |
|------|------|
| **单次 (One-shot)** | 到期后执行一次回调，然后停止 |
| **自动重载 (Auto-reload)** | 到期后执行回调，自动重新启动 |

```
单次定时器:   Start → [等待 period] → Callback → Stop
自动重载:     Start → [等待 period] → Callback → [等待 period] → Callback → ...
```

---

## 2. 定时器守护任务原理

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ 用户任务     │────→│  定时器命令队列    │────→│  定时器守护任务 │
│ (创建/启动)  │     │  (xTimerQueue)    │     │  (优先级可配)   │
└─────────────┘     └──────────────────┘     └──────┬───────┘
                                                    │
                                              ┌─────▼──────┐
                                              │  定时器列表  │
                                              │  (按到期排序) │
                                              └────────────┘
```

- 定时器命令通过队列发送给守护任务，用户的 API 调用**不会**直接操作定时器
- 守护任务按到期时间排序管理所有定时器，每次 Tick 中断检查到期
- 定时器回调在**守护任务上下文**中执行，不是 ISR 上下文

::: warning 回调限制
定时器回调函数在守护任务中执行，不能调用会阻塞的 API（如 `vTaskDelay`、`xQueueReceive` 带超时），否则会阻塞所有其他定时器。
:::

---

## 3. API 使用与实战代码

```c
#include "FreeRTOS.h"
#include "timers.h"

// ===== 3.1 创建定时器 =====

TimerHandle_t led_timer;       // LED 闪烁 (自动重载)
TimerHandle_t timeout_timer;   // 通信超时 (单次)

// 定时器回调函数
void LEDTimer_Callback(TimerHandle_t xTimer) {
    // 注意: 回调中使用 FromISR 版本 API，传入 NULL 作为上下文
    HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
}

void Timeout_Callback(TimerHandle_t xTimer) {
    // 超时处理: 复位通信状态机
    extern CommState_t comm_state;
    comm_state = COMM_IDLE;
}

void Timers_Init(void) {
    // 创建自动重载定时器: pdTRUE = auto-reload
    // 参数: 名称, 周期(ms), 是否自动重载, 定时器ID(可NULL), 回调
    led_timer = xTimerCreate(
        "LED",                          // 调试用名称
        pdMS_TO_TICKS(500),            // 500ms 周期
        pdTRUE,                         // 自动重载
        (void *)0,                      // 定时器 ID (可绑定数据)
        LEDTimer_Callback
    );

    // 创建单次超时定时器
    timeout_timer = xTimerCreate(
        "Timeout",
        pdMS_TO_TICKS(1000),           // 1000ms 超时
        pdFALSE,                        // 单次触发
        (void *)0,
        Timeout_Callback
    );

    configASSERT(led_timer != NULL);
    configASSERT(timeout_timer != NULL);
}

// ===== 3.2 启动 / 停止 =====

void Start_LED_Blink(void) {
    // 从任务上下文启动
    if (xTimerStart(led_timer, 0) != pdPASS) {
        // 启动失败
    }
}

void Restart_Timeout(void) {
    // 从 ISR 启动/重置 (如 UART 收到数据时刷新超时)
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    if (xTimerStartFromISR(timeout_timer, &xHigherPriorityTaskWoken) != pdPASS) {
        // 处理失败
    }
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}

// ===== 3.3 动态修改周期 =====

void Adjust_LED_Period(uint32_t new_period_ms) {
    // 先停止, 改周期, 再启动
    xTimerStop(led_timer, 0);
    xTimerChangePeriod(led_timer, pdMS_TO_TICKS(new_period_ms), 0);
    xTimerStart(led_timer, 0);
}

// ===== 3.4 获取定时器 ID (传递上下文) =====

typedef struct {
    uint8_t channel;
    GPIO_TypeDef *port;
    uint16_t pin;
} LEDConfig_t;

LEDConfig_t led1_cfg = {1, GPIOA, GPIO_PIN_5};

void MultiLED_Callback(TimerHandle_t xTimer) {
    LEDConfig_t *cfg = (LEDConfig_t *)pvTimerGetTimerID(xTimer);
    HAL_GPIO_TogglePin(cfg->port, cfg->pin);
}

void Create_ConfigTimer(void) {
    TimerHandle_t t = xTimerCreate("LED1", pdMS_TO_TICKS(200), pdTRUE,
                                    (void *)&led1_cfg, MultiLED_Callback);
    xTimerStart(t, 0);
}
```

---

## 4. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 定时器不触发 | 守护任务未创建或优先级过低饿死 | 检查 `configUSE_TIMERS` 为 1，`configTIMER_TASK_PRIORITY` 足够高 |
| 2 | 定时器精度差 (>10ms 误差) | Tick 频率太低 (`configTICK_RATE_HZ` 默认 100Hz) | 提高 Tick 到 1000Hz 或使用硬件定时器 |
| 3 | 回调中调用 `xQueueReceive` 卡死 | 回调中阻塞了守护任务 | 回调必须非阻塞；改用任务通知 |
| 4 | ISR 中调用 `xTimerStart` 崩溃 | 用了非 FromISR 版本 | ISR 中必须用 `xTimerStartFromISR` |
| 5 | 大量定时器导致 RAM 不足 | 每个定时器占用约 80 字节 | 合并定时器或使用单定时器+状态机轮询 |
| 6 | 定时器在睡眠模式下停止 | Tick 中断停止 (Tickless 模式) | 配置 `configSYSTICK_CLOCK_HZ` 或使用低功耗定时器 |

---

## 5. 参考文档

1. FreeRTOS 官方文档 — Software Timers: https://www.freertos.org/FreeRTOS-Software-Timer-API.html
2. "Mastering the FreeRTOS Real Time Kernel" — Richard Barry, Chapter 6
3. FreeRTOS 定时器源码分析: `timers.c` (约 1200 行, 值得通读)
