# RTOS

实时操作系统相关知识与开发实践，以 FreeRTOS 为主线，兼顾 RT-Thread 入门和多核 SMP。

---

## 目录

### [FreeRTOS 任务调度](./freertos-task-scheduling/)
任务创建（动态/静态）、任务状态机、调度器原理、vTaskDelayUntil 精确周期、优先级分配策略

### [队列与信号量 (IPC)](./ipc/)
队列传递数据、Binary/Counting Semaphore、Mutex 优先级继承、ISR → Task 通信模式对比

### [软件定时器](./software-timers/)
软件定时器守护任务原理、一次性/周期性定时器、与硬件定时器的对比

### [事件组与任务通知](./events-notifications/)
事件组 (Event Groups) 多事件组合、任务通知 (Task Notifications) 高性能 IPC

### [内存管理方案](./memory-management/)
heap_1～heap_5 对比选择、FreeRTOS-Plus-TCP 内存需求、内存池设计

### [RT-Thread 入门](./rt-thread/)
RT-Thread 内核对比 FreeRTOS、ENV 工具、设备驱动框架简介

### [多核与 SMP](./multicore-smp/)
SMP vs AMP 架构、FreeRTOS SMP 对称多处理、任务亲和性配置
