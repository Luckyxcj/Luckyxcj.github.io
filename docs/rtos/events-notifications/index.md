# FreeRTOS 事件与任务通知

> **文档说明**：本文档基于 FreeRTOS 官方文档及多任务同步实战经验整理。

---

## 目录

1. [概述与对比](#1-概述与对比)
2. [事件组 (Event Groups)](#2-事件组-event-groups)
3. [任务通知 (Task Notifications)](#3-任务通知-task-notifications)
4. [选择指南](#4-选择指南)
5. [常见问题](#5-常见问题)

---

## 1. 概述与对比

多任务协作中，一个任务常常需要等待多个事件。FreeRTOS 提供了事件组和任务通知两种轻量级机制。

| 特性 | 事件组 | 任务通知 | 信号量 | 队列 |
|------|--------|---------|--------|------|
| 等待多事件 | 支持 (AND/OR) | 不支持 | 不支持 | 不支持 |
| RAM 占用 | ~40 字节 | 0 (复用 TCB) | ~60 字节 | ~80+ 字节 |
| 速度 | 快 | 最快 | 快 | 中等 |
| 广播 | 支持 (多任务可等待同一组) | 不支持 (一对一) | 支持 | 不支持 |
| ISR 使用 | 支持 (FromISR) | 部分支持 | 支持 | 支持 |

---

## 2. 事件组 (Event Groups)

### 2.1 工作原理

事件组是一个 24 位 (或 8 位，取决于 `configUSE_16_BIT_TICKS`) 的位掩码，每一位代表一个事件。

```
Bit:   23 ... 3    2    1    0
       ───── ──── ──── ──── ────
       未使用  ... UART CAN  I2C
                   就绪 就绪  完成
```

### 2.2 实战代码

```c
#include "FreeRTOS.h"
#include "event_groups.h"

// 事件位定义
#define EVENT_I2C_DONE   (1 << 0)
#define EVENT_CAN_READY  (1 << 1)
#define EVENT_UART_RX    (1 << 2)
#define EVENT_ALL_COMM   (EVENT_I2C_DONE | EVENT_CAN_READY | EVENT_UART_RX)

EventGroupHandle_t comm_events;

void Comm_Init(void) {
    comm_events = xEventGroupCreate();
    configASSERT(comm_events != NULL);
}

// ===== 发送事件 =====

void I2C_TransferComplete_Callback(void) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xEventGroupSetBitsFromISR(comm_events, EVENT_I2C_DONE,
                               &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}

void CAN_ISR(void) {
    if (CAN_MessagePending()) {
        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        xEventGroupSetBitsFromISR(comm_events, EVENT_CAN_READY,
                                   &xHigherPriorityTaskWoken);
        portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
    }
}

// ===== 等待事件 =====

void CommTask(void *pvParameters) {
    for (;;) {
        // 等待任一通信事件 (OR), 超时 1000ms
        EventBits_t bits = xEventGroupWaitBits(
            comm_events,
            EVENT_ALL_COMM,          // 等待的位
            pdTRUE,                  // 读取后清除
            pdFALSE,                 // pdFALSE = OR (任一); pdTRUE = AND (全部)
            pdMS_TO_TICKS(1000)
        );

        if (bits & EVENT_I2C_DONE) {
            // 处理 I2C 完成
        }
        if (bits & EVENT_CAN_READY) {
            // 处理 CAN 数据
        }
        if (bits & EVENT_UART_RX) {
            // 处理 UART 接收
        }
        if (bits == 0) {
            // 超时: 所有通信都无响应, 进入待机检查
        }
    }
}

// ===== 同步多个任务 (广播模式) =====

void WaitForInitComplete(void) {
    // 多个任务可以等待同一个事件组
    // 当初始化任务设置 EVENT_INIT_DONE 后，所有等待任务同时唤醒
    xEventGroupSync(
        comm_events,
        EVENT_TASK1_READY,          // 本任务贡献的位
        EVENT_ALL_READY,            // 等待所有任务就绪
        pdMS_TO_TICKS(5000)
    );
}
```

---

## 3. 任务通知 (Task Notifications)

### 3.1 工作原理

每个 FreeRTOS 任务 TCB 中内置一个 32 位通知值。任务通知直接写入目标任务的 TCB，无需创建内核对象，是**最快**的任务间通信方式。

```
任务 A ──(xTaskNotify)──→ 任务 B 的 TCB
                           ├─ ulNotifiedValue (32-bit)
                           └─ 通知状态 (Pending / Not Pending)

任务 B ──(xTaskNotifyWait)──→ 读取并清除通知
```

### 3.2 实战代码

```c
#include "FreeRTOS.h"
#include "task.h"

// ===== 用作轻量级信号量 =====

void SensorTask(void *pvParameters) {
    for (;;) {
        // 等待通知 (相当于 take semaphore), 进入阻塞
        ulTaskNotifyTake(pdTRUE,    // pdTRUE: 读取后清零; pdFALSE: 减1
                         portMAX_DELAY);

        // 收到 ISR 通知, 读取传感器数据
        ReadSensor();
    }
}

// ISR 中通知任务
void EXTI9_5_IRQHandler(void) {
    if (__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_6)) {
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_6);

        BaseType_t xHigherPriorityTaskWoken = pdFALSE;
        vTaskNotifyGiveFromISR(SensorTask_Handle, &xHigherPriorityTaskWoken);
        portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
    }
}

// ===== 用作快速数据传递 =====

void CAN_RxTask(void *pvParameters) {
    uint32_t can_id;
    for (;;) {
        // 等待通知 + 接收数据 (一次调用完成同步和数据传输)
        if (xTaskNotifyWait(0x00,           // 进入时不清除位
                            0xFFFFFFFF,     // 退出时清除所有位
                            &can_id,        // 接收通知值
                            portMAX_DELAY) == pdTRUE) {

            ProcessCANMessage(can_id);
        }
    }
}

void CAN_IRQHandler(void) {
    uint32_t id = CAN_GetRxID();
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    // 发送通知 + 传递数据 (eSetValueWithOverwrite: 覆写旧值)
    xTaskNotifyFromISR(CAN_RxTask_Handle, id,
                       eSetValueWithOverwrite,
                       &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

---

## 4. 选择指南

```
是否需要等待多个事件?
  ├─ 是 → 事件组
  └─ 否 → 是否需要传递数据?
            ├─ 是, 且数据>4字节 → 队列
            ├─ 是, 且数据≤4字节 → 任务通知
            └─ 否 → 是 ISR→任务 同步?
                      ├─ 是 → 任务通知 (最快)
                      └─ 否 → 信号量
```

::: tip 性能提示
任务通知比信号量快约 **45%**，比队列快约 **60%**。如果场景符合，优先使用任务通知。
:::

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 事件位丢失 | 多个 ISR 同时写同一位 | 每个 ISR 使用独立的事件位 |
| 2 | `xEventGroupSetBitsFromISR` 返回失败 | 守护任务队列满 | 增加 `configTIMER_QUEUE_LENGTH` 或降低事件频率 |
| 3 | 任务通知未触发 | 通知在 `xTaskNotifyWait` 之前发送 | 通知是持久化的，下次调用会立即返回；检查发送时序 |
| 4 | 通知值被覆盖 | 使用了 `eSetValueWithOverwrite` | 改用 `eIncrement` 或使用队列 |
| 5 | 事件组读后不能清除 | 参数 `xClearOnExit` 设为 pdFALSE | 检查 `xEventGroupWaitBits` 第三个参数 |
| 6 | 多个任务等同一通知 | 通知只能发给一个任务 | 改用事件组或信号量广播 |

---

## 6. 参考文档

1. FreeRTOS Event Groups: https://www.freertos.org/FreeRTOS-Event-Groups.html
2. FreeRTOS Task Notifications: https://www.freertos.org/RTOS-task-notifications.html
3. "Mastering the FreeRTOS Real Time Kernel" — Richard Barry, Chapter 7
4. FreeRTOS 源码 `event_groups.c` / `tasks.c` (通知部分)
