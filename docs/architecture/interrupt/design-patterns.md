# 中断设计模式与最佳实践

> **文档说明**：本文档基于 ARM 推荐的嵌入式中断设计方法和工程经验总结。

---

## 目录

1. [ISR 设计的黄金法则](#1-isr-设计的黄金法则)
2. [中断延迟处理 (Deferred Interrupt Processing)](#2-中断延迟处理-deferred-interrupt-processing)
3. [中断优先级分配策略](#3-中断优先级分配策略)
4. [临界区保护](#4-临界区保护)
5. [中断与 RTOS 的协作](#5-中断与-rtos-的协作)
6. [中断驱动架构的代码模板](#6-中断驱动架构的代码模板)
7. [参考文档](#7-参考文档)

---

## 1. ISR 设计的黄金法则

```
ISR 三大铁律：
1. ISR 必须快速进入、快速退出（目标 <10us，绝对不超过 100us）
2. ISR 内不阻塞、不等待、不做大计算
3. ISR 通过 flag/buffer/queue 将数据传给主循环或任务
```

### 为什么快速 ISR 是关键

```
假设 USART1 @ 115200 bps 接收，每个字节约 87us 间隔。
如果 ISR 执行需要 100us，则下一个字节到来时会：
  → 上一个 ISR 还在执行 → 无法响应 → 数据丢失

更坏的情况：如果 ISR 内有 while(flag_not_set)，且这个 flag
由另一个更低优先级 ISR 设置，则会发生优先级反转死锁。
```

---

## 2. 中断延迟处理 (Deferred Interrupt Processing)

### 2.1 两级处理架构

```
Level 1: ISR (高优先级, <10us)
  ├─ 读取数据寄存器
  ├─ 写入环形缓冲区
  ├─ 清除中断标志
  └─ 设置事件标志 → 触发 Level 2

Level 2: 主循环 / 低优先级任务 (无时间限制)
  ├─ 从环形缓冲区取数据
  ├─ 解析协议
  ├─ 执行算法
  └─ 更新状态
```

### 2.2 代码实现

```c
// ==== 环形缓冲区 (中断安全) ====
#define RX_BUF_SIZE 256
volatile uint8_t  rx_buf[RX_BUF_SIZE];
volatile uint16_t rx_head = 0;
volatile uint16_t rx_tail = 0;

// ISR 中使用 (生产者)
void USART1_IRQHandler(void) {
    if (USART1->SR & USART_SR_RXNE) {
        uint8_t data = USART1->DR;
        uint16_t next = (rx_head + 1) % RX_BUF_SIZE;

        if (next != rx_tail) {  // 缓冲区没满
            rx_buf[rx_head] = data;
            rx_head = next;
        } else {
            // 缓冲区溢出 → 丢弃或设置溢出标志
            // 不要在这里做复杂的错误处理！
        }
        // HAL 版本: HAL_UART_IRQHandler(&huart1);
    }
}

// 主循环中使用 (消费者)
void Process_Rx_Data(void) {
    while (rx_tail != rx_head) {
        uint8_t data = rx_buf[rx_tail];
        rx_tail = (rx_tail + 1) % RX_BUF_SIZE;

        // 这里可以安全地做任何耗时操作
        Parse_Protocol(data);
    }
}
```

### 2.3 更复杂场景：使用 FreeRTOS 任务通知

```c
// ISR 中用任务通知触发高优先级任务来处理数据
TaskHandle_t hCommTask;  // 通信处理任务

void USART1_IRQHandler(void) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    // 读取数据写入 buffer (快速操作)
    uint8_t data = USART1->DR;
    Write_To_Buffer(data);

    if (Frame_Complete()) {
        // 触发任务处理完整帧
        vTaskNotifyGiveFromISR(hCommTask, &xHigherPriorityTaskWoken);
    }
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}

// 通信任务 (等待 ISR 通知)
void CommTask(void *pvParameters) {
    while (1) {
        // 等待 ISR 发来的通知 (阻塞在此，不消耗 CPU)
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        // ISR 通知后继续处理帧数据
        Process_Complete_Frame();
    }
}
```

---

## 3. 中断优先级分配策略

### 3.1 推荐优先级分配表

```
优先级分配原则：
  - 硬实时 (< 10us 延迟要求) → 优先级 0-2
  - 软实时 (< 100us)         → 优先级 3-5
  - 标准外设 (ms 级)         → 优先级 6-10
  - 后台数据 (< 10ms)        → 优先级 11-14

示例 (STM32, 16 级抢占优先级):

优先级 | 中断源          | 理由
  0   | (保留给 SysTick) | RTOS 时钟基准
  1   | 电机电流采样 ADC | 电机控制闭环，延迟必须 < 10us
  2   | HRTIM 故障保护   | 过流保护，响应必须 < 5us
  3   | USART1 (高速通信) | 115200 bps 接收
  4   | CAN RX           | 1Mbps CAN 接收
  5   | SPI DMA 完成     | 高速数据传输完成
  6   | TIM2 (编码器)    | 位置捕获
  7   | USART2 (调试)    | 日志输出
  8   | I2C              | 传感器读取
  9   | EXTI (按键)      | 用户输入，延迟 50ms 也可接受
```

### 3.2 优先级反转问题

```c
// 场景：高优先级 ISR-A 等待低优先级 ISR-B 设置的 flag
// 如果 ISR-A 优先级 > ISR-B，则 ISR-B 永远不会运行 → 死锁

// ❌ 错误示范：
volatile int flag = 0;

// ISR-A (优先级高)
void TIM1_UP_IRQHandler(void) {
    while (flag == 0);  // ← 这里永远不会退出！ISR-B 无法运行
    // ...
}

// ISR-B (优先级低)
void EXTI0_IRQHandler(void) {
    flag = 1;
}

// ✅ 正确做法：不要跨 ISR 等待，改用主循环协调
```

---

## 4. 临界区保护

### 4.1 临界区的四种实现方式

| 方式 | 耗时 | 嵌套安全 | 适用场景 |
|------|------|---------|---------|
| `__disable_irq()` / `__enable_irq()` | 1 cycle | 否 (需保存 PRIMASK 状态) | 只有几行代码的场景 |
| `taskENTER_CRITICAL()` (FreeRTOS) | 低 | 是 | RTOS 任务间保护 |
| `BASEPRI` 屏蔽特定优先级中断 | 1 cycle | 是 | 精细控制 (只屏蔽低于某优先级的中断) |
| MUTEX/信号量 | 高 | 是 | 长时间保护的资源 |

### 4.2 BASEPRI (推荐的精细中断屏蔽)

```c
// 只屏蔽优先级 >= 10 的中断，优先级 0-9 的中断仍可响应
#define CRITICAL_SECTION_BEGIN()  \
    do { uint32_t _primask = __get_BASEPRI(); \
         __set_BASEPRI(10 << (8 - __NVIC_PRIO_BITS));  // 屏蔽优先级 10-15

#define CRITICAL_SECTION_END()    \
         __set_BASEPRI(_primask); \
    } while(0)

// 使用示例
void Update_Shared_Data(void) {
    CRITICAL_SECTION_BEGIN();
    // 在此修改 ISR 也会访问的变量 (优先级 10+ 的 ISR 不会抢占)
    shared_var++;
    CRITICAL_SECTION_END();
}
```

::: tip BASEPRI vs PRIMASK
`__disable_irq()` (操作 PRIMASK) 屏蔽所有中断，包括 SysTick。如果临界区超过 1 个 SysTick 周期 (通常 1ms)，OS 调度会被延迟。

`__set_BASEPRI()` 只屏蔽指定优先级的 ISR，SysTick (优先级 0) 仍能正常工作。这是更优雅的临界区实现。
:::

---

## 5. 中断与 RTOS 的协作

### 5.1 中断向任务传递信息的方式

| 方式 | 延迟 | 适用场景 |
|------|------|---------|
| `vTaskNotifyGiveFromISR()` | 最快 | 单任务等待一个事件 |
| `xSemaphoreGiveFromISR()` (Binary Semaphore) | 快 | 任务等待 ISR 事件 |
| `xQueueSendFromISR()` / `xStreamBufferSendFromISR()` | 中 | ISR 向任务发送数据 |
| `xEventGroupSetBitsFromISR()` | 中 | 等待多个 ISR 事件的组合 |
| `xTimerPendFunctionCallFromISR()` | 慢 | 在任务上下文中执行一个函数 (Deferred Callback) |

### 5.2 FreeRTOS ISR 模板

```c
// 标准 FreeRTOS ISR 模板
void CAN1_RX0_IRQHandler(void) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    CAN_RxMsg_t msg;

    // 1. 快速读取硬件数据
    Read_CAN_Message(&msg);

    // 2. 将数据放入队列 (FromISR 版本)
    xQueueSendFromISR(xCAN_RxQueue, &msg, &xHigherPriorityTaskWoken);

    // 3. 清除中断标志 (如果 HAL 没做)
    // CLEAR_IT_FLAG();

    // 4. 上下文切换 (如果更高优先级任务就绪)
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

---

## 6. 中断驱动架构的代码模板

### 6.1 完整的中断驱动 USART 接收模板

```c
#include <stdint.h>
#include "stm32f4xx_hal.h"

// ==== 数据结构 ====
#define UART_RX_BUF_SIZE  512
#define UART_FRAME_SIZE   64

typedef struct {
    uint8_t  buffer[UART_RX_BUF_SIZE];
    uint16_t head;
    uint16_t tail;
    uint8_t  frame_buf[UART_FRAME_SIZE];
    uint8_t  frame_idx;
    volatile uint8_t frame_ready;  // ISR 置位，主循环清位
} UART_Rx_t;

UART_Rx_t uart1_rx = {0};

// ==== ISR: 只做数据采集 (Level 1) ====
void USART1_IRQHandler(void) {
    if (__HAL_UART_GET_FLAG(&huart1, UART_FLAG_RXNE)) {
        uint8_t data = (uint8_t)(huart1.Instance->DR & 0xFF);

        // 环形缓冲区写入
        uint16_t next = (uart1_rx.head + 1) % UART_RX_BUF_SIZE;
        if (next != uart1_rx.tail) {
            uart1_rx.buffer[uart1_rx.head] = data;
            uart1_rx.head = next;
        }

        // 帧解析 (轻量级, 仅做帧边界检测)
        if (data == '\n') {  // 帧结束标记
            memcpy(uart1_rx.frame_buf, /* ... */);
            uart1_rx.frame_idx = 0;
            uart1_rx.frame_ready = 1;  // 通知主循环
        } else if (uart1_rx.frame_idx < UART_FRAME_SIZE - 1) {
            uart1_rx.frame_buf[uart1_rx.frame_idx++] = data;
        }
    }
    if (__HAL_UART_GET_FLAG(&huart1, UART_FLAG_ORE)) {
        __HAL_UART_CLEAR_OREFLAG(&huart1);  // 溢出清标志继续跑
    }
}

// ==== 主循环: 处理完整帧 (Level 2) ====
void Main_Loop(void) {
    while (1) {
        if (uart1_rx.frame_ready) {
            uart1_rx.frame_ready = 0;  // 清标志
            Process_Command(uart1_rx.frame_buf, uart1_rx.frame_idx);
        }
        // 其他主循环任务...
    }
}
```

---

## 7. 参考文档

1. ARM DDI 0403E: Cortex-M4 TRM — NVIC and exception model
2. FreeRTOS Interrupt Management: https://www.freertos.org/RTOS-Cortex-M3-M4-H7-interrupt-priority.html
3. STM32CubeMX NVIC Configuration Guide
4. ARM Application Note AN321: Coding for Cortex-M3/M4 interrupt latency
