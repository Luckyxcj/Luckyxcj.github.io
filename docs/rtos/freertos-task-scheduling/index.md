# FreeRTOS 任务调度

> **文档说明**：本文档基于 FreeRTOS 官方文档 (www.freertos.org) 和 STM32 平台实践整理。

---

## 目录

1. [任务管理基础](#1-任务管理基础)
2. [任务创建与删除](#2-任务创建与删除)
3. [调度器深度解析](#3-调度器深度解析)
4. [任务状态转换](#4-任务状态转换)
5. [常见问题与排查](#5-常见问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. 任务管理基础

### 1.1 什么是 FreeRTOS 任务

每个任务是一个永远不返回的 C 函数（通常是一个 `while(1)` 无限循环）。FreeRTOS 调度器在多个任务之间快速切换，给每个任务分配 CPU 时间。

```c
// 标准的 FreeRTOS 任务结构
void vTaskFunction(void *pvParameters) {
    // 任务初始化
    for (;;) {  // 或 while(1)
        // 任务主要工作
        vTaskDelay(pdMS_TO_TICKS(100));  // 阻塞 100ms
    }
    // 任务不应该到达这里
    vTaskDelete(NULL);
}
```

### 1.2 任务 vs 裸机 Super-Loop

```
裸机 Super-Loop:
  while (1) {
      Task1();  // 必须等 Task1 完成才能执行 Task2
      Task2();  // 如果 Task1 阻塞，整体死锁
      Task3();
  }

FreeRTOS:
  Task1: while(1) { ... vTaskDelay(...); }  // 独立执行
  Task2: while(1) { ... vTaskDelay(...); }  // 独立执行
  Task3: while(1) { ... vTaskDelay(...); }  // 独立执行
  调度器: 自动在任务之间切换，解放开发者
```

---

## 2. 任务创建与删除

### 2.1 静态 vs 动态创建

```c
// 动态创建 (堆上分配任务栈和 TCB)
TaskHandle_t hTask1;
xTaskCreate(
    vTask1,                    // 任务函数
    "Task1",                   // 任务名称 (调试用)
    512,                        // 栈大小 (字, 不是字节!)
    NULL,                       // 参数
    1,                          // 优先级
    &hTask1                     // 任务句柄 (可为 NULL)
);

// 静态创建 (编译时分配, 无堆碎片风险)
static StackType_t  xTaskStack[512];   // 栈 (内存池)
static StaticTask_t xTaskTCB;          // TCB (任务控制块)

TaskHandle_t hTask2 = xTaskCreateStatic(
    vTask2, "Task2", 512, NULL, 2,
    xTaskStack, &xTaskTCB
);
```

### 2.2 任务创建检查清单

```
创建任务时需要确定的参数:

1. 栈大小 (configMINIMAL_STACK_SIZE 基准: ~128 字)
   ├─ 局部变量越多, 栈越大
   ├─ 函数调用嵌套越深, 栈越大
   └─ 粗略估算: 基准 + 最坏情况局部变量 + 20% 余量

2. 优先级 (0 ~ configMAX_PRIORITIES-1)
   ├─ 数字越大, 优先级越高
   ├─ 空闲任务的优先级是 0 (最低)
   └─ 通常: 控制任务 > 通信任务 > 日志任务

3. 任务栈在 FreeRTOS 中是 unsigned short 类型的数组 (不是字节!)
   → stack_size_in_bytes = 512 words × 4 = 2048 bytes
```

---

## 3. 调度器深度解析

### 3.1 FreeRTOS 调度策略

```
FreeRTOS 使用 固定优先级抢占式调度 (Fixed-Priority Preemptive):

1. 每个时钟 tick (通常 1ms), 调度器检查是否有更高优先级任务就绪
2. 如果有 → 抢占当前任务 → 运行高优先级任务
3. 同优先级任务使用 时间片轮转 (Round-Robin)
4. 空闲任务 (优先级 0) 在没有任何任务需要运行时执行

抢占发生的时机:
├─ vTaskDelay / vTaskDelayUntil → 任务主动让出 CPU
├─ 信号量释放 → 高优先级任务被唤醒
├─ ISR 发送信号 → 外部事件触发调度
└─ SysTick 时钟 tick → 周期性调度点
```

### 3.2 vTaskDelay vs vTaskDelayUntil

```c
// ❌ vTaskDelay: 相对延迟, 会累积时间漂移
void Task_Bad(void *pv) {
    while (1) {
        DoSomething();           // 执行时间不定 (0-10ms)
        vTaskDelay(100);         // 100ms 后唤醒, 但要加上 DoSomething 的时间
        // 实际周期 ≈ 100ms + 执行时间 (不是精确 100ms!)
    }
}

// ✅ vTaskDelayUntil: 绝对延迟, 无累积漂移
void Task_Good(void *pv) {
    TickType_t xLastWakeTime = xTaskGetTickCount();
    while (1) {
        DoSomething();           // 执行时间不定
        vTaskDelayUntil(&xLastWakeTime, 100);  // 从上次唤醒起固定 100ms
        // 实际周期 = 严格的 100ms (只要执行时间 < 100ms)
    }
}
```

### 3.3 任务优先级配置建议

```
推荐的优先级分配 (configMAX_PRIORITIES = 8):

7 (最高):  紧急控制 (电机过流保护、刹车)
6:        实时控制 (FOC 电流环、IMU 姿态解算)
5:        通信事件 (CAN 接收、UART 接收处理)
4:        控制算法 (PID 计算、传感器融合)
3:        传感器采集 (I2C/SPI 读数)
2:        数据记录、日志输出
1:        用户交互 (按键、LED)
0 (最低):  空闲任务 (Idle Task)
```

---

## 4. 任务状态转换

```
FreeRTOS 任务状态机:

        创建 ──→ Ready (就绪)
                    │
          ┌─────────┼─────────┐
          ↓         ↓         ↓
       Running   Blocked   Suspended
       (运行)    (阻塞)    (挂起)
          │         │         │
          └─────────┼─────────┘
                    ↓
                 Ready (返回就绪)

状态转换:
  Ready → Running:  调度器选择 (最高优先级就绪任务)
  Running → Ready:  被更高优先级任务抢占，或时间片耗尽
  Running → Blocked: vTaskDelay, xQueueReceive(阻塞), 信号量等待
  Blocked → Ready:  延迟时间到，或信号到达
  Running → Suspended: vTaskSuspend
  Suspended → Ready:   vTaskResume
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 任务不运行 | 更高优先级任务霸占 CPU (没有使用阻塞调用) | 确保每个任务有阻塞操作 (delay/semaphore/queue) |
| 2 | 任务栈溢出 | 栈大小不够或递归调用 | 启用 `configCHECK_FOR_STACK_OVERFLOW`；增大栈 |
| 3 | 空闲任务得不到执行 | 有任务优先级 0 且从不阻塞 | 空闲任务优先级 0；确保所有任务都使用阻塞调用 |
| 4 | vTaskDelay 延迟不准 | 使用了相对延迟；执行时间不定 | 改用 `vTaskDelayUntil` |
| 5 | 优先级反转 | 高优先级任务等待低优先级任务持有的锁 | 使用互斥锁 (Mutex 有优先级继承) |
| 6 | 创建任务后 HardFault | 栈空间不够 → 栈溢出 | 先尝试 ×2 栈大小；用 uxTaskGetStackHighWaterMark 测量 |

---

## 6. 参考文档

1. FreeRTOS Task Management: https://www.freertos.org/task-management.html
2. "Mastering the FreeRTOS Real Time Kernel" — Richard Barry
3. FreeRTOSConfig.h 参数详解 — FreeRTOS 官方文档
