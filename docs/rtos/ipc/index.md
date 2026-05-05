# 队列与信号量 (IPC)

> **文档说明**：本文档基于 FreeRTOS 官方文档，深入讲解任务间通信 (IPC) 机制。

---

## 目录

1. [IPC 机制概述](#1-ipc-机制概述)
2. [队列 (Queue)](#2-队列-queue)
3. [信号量 (Semaphore)](#3-信号量-semaphore)
4. [互斥锁 (Mutex)](#4-互斥锁-mutex)
5. [选择指南与常见陷阱](#5-选择指南与常见陷阱)
6. [参考文档](#6-参考文档)

---

## 1. IPC 机制概述

```
FreeRTOS IPC 工具一览:

队列 (Queue) — 传递数据
  ├─ 发送: xQueueSend, xQueueSendToBack, xQueueSendToFront
  ├─ 接收: xQueueReceive (阻塞/非阻塞)
  └─ 使用场景: 任务间传递消息

信号量 (Semaphore) — 传递事件/信号
  ├─ Binary Semaphore: 事件通知 (0 或 1)
  ├─ Counting Semaphore: 计数资源管理
  └─ 使用场景: ISR 通知任务、资源计数

互斥锁 (Mutex) — 保护共享资源
  ├─ 带优先级继承 (避免优先级反转)
  ├─ 递归互斥锁: 同一任务可多次获取
  └─ 使用场景: 保护共享数据结构
```

---

## 2. 队列 (Queue)

### 2.1 队列基本用法

```c
// 创建队列: 队列长度 10, 每个元素 4 字节
QueueHandle_t xQueue = xQueueCreate(10, sizeof(int32_t));

// 发送 (任务中)
int32_t value = sensor_reading;
xQueueSend(xQueue, &value, portMAX_DELAY);  // 阻塞直到有空位

// 接收 (任务中)
int32_t received;
if (xQueueReceive(xQueue, &received, pdMS_TO_TICKS(100)) == pdTRUE) {
    // 收到数据
}

// 从 ISR 发送
BaseType_t xHigherPriorityTaskWoken = pdFALSE;
xQueueSendFromISR(xQueue, &value, &xHigherPriorityTaskWoken);
portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
```

### 2.2 队列作为数据管道

```c
// 常见模式: 任务 A (生产者) → 队列 → 任务 B (消费者)

// 生产者 (如 CAN ISR)
void CAN_Rx_ISR(void) {
    CAN_Message_t msg;
    Read_CAN_Msg(&msg);
    xQueueSendFromISR(can_queue, &msg, &xTaskWoken);
    portYIELD_FROM_ISR(xTaskWoken);
}

// 消费者 (如 CAN 协议解析任务)
void CAN_Processor_Task(void *pv) {
    CAN_Message_t msg;
    while (1) {
        if (xQueueReceive(can_queue, &msg, portMAX_DELAY) == pdTRUE) {
            Parse_CAN_Message(&msg);  // 在这里做复杂的协议解析
        }
    }
}
```

---

## 3. 信号量 (Semaphore)

### 3.1 Binary Semaphore: 任务同步

```c
// ISR → 任务的信号通知模式
SemaphoreHandle_t xSemaphore;

void Setup(void) {
    xSemaphore = xSemaphoreCreateBinary();
}

// ISR 中: 发送信号 (表示数据就绪)
void ADC_DMA_ISR(void) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xSemaphoreGiveFromISR(xSemaphore, &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}

// 任务中: 等待信号
void Data_Processing_Task(void *pv) {
    while (1) {
        xSemaphoreTake(xSemaphore, portMAX_DELAY);  // 阻塞直到 ISR 发信号
        Process_ADC_Data();  // ISR 通知后执行处理
    }
}
```

### 3.2 Counting Semaphore: 资源管理

```c
// 管理 4 个 UART 发送缓冲区的可用数量
SemaphoreHandle_t xTxSemaphore;

void Setup(void) {
    xTxSemaphore = xSemaphoreCreateCounting(4, 4);  // 最大 4, 初始 4 可用
}

void UART_Tx_Task(void *pv) {
    while (1) {
        xSemaphoreTake(xTxSemaphore, portMAX_DELAY);  // 等待缓冲区可用
        HAL_UART_Transmit_DMA(&huart1, buf, len);      // 使用 1 个缓冲区
        // 在 DMA 完成回调中归还: xSemaphoreGive(xTxSemaphore)
    }
}
```

---

## 4. 互斥锁 (Mutex)

```c
// Mutex 保护共享数据
SemaphoreHandle_t xMutex;

void Setup(void) {
    xMutex = xSemaphoreCreateMutex();
}

void Log_Write(const char *msg) {
    xSemaphoreTake(xMutex, portMAX_DELAY);  // 获取锁
    // --- 临界区: 独占访问 ---
    fprintf(log_file, "%s\n", msg);
    // --- 临界区结束 ---
    xSemaphoreGive(xMutex);  // 释放锁
}

// 优先级继承
// FreeRTOS Mutex 自动启用优先级继承:
// 如果高优先级任务 A 等待 Mutex (被低优先级任务 C 持有),
// 任务 C 的优先级会临时提升到任务 A 的级别,
// 防止中优先级任务 B 无限期延迟 C 释放锁
```

---

## 5. 选择指南与常见陷阱

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| ISR → 任务事件通知 | Binary Semaphore | ISR 版本效率高 |
| 任务间传递数据 | Queue | 线程安全队列 |
| 保护共享资源 | Mutex | 优先级继承 |
| 管理有限资源 | Counting Semaphore | 精确计数 |
| 单任务单事件 (最高效) | Task Notifications | 比 Semaphore 快 45% |

| 陷阱 | 说明 |
|------|------|
| **互斥锁 + 阻塞操作** | 持有 Mutex 期间不要调用 vTaskDelay 或等另一个锁! |
| **忘记解锁** | 建议使用 RAII 风格的包装 (C++ 的话) 或集中式获取/释放 |
| **优先级反转** | 用 Mutex (不是 Binary Semaphore!) 来保护共享资源 |
| **ISR 中 Take Semaphore** | ISR 只能用 `GiveFromISR`, 不能等待 (Take) |

---

## 6. 参考文档

1. FreeRTOS Queue Management: https://www.freertos.org/Embedded-RTOS-Queues.html
2. FreeRTOS Mutex: https://www.freertos.org/Real-time-embedded-RTOS-mutexes.html
3. "FreeRTOS Task Notifications" — 官方文档
