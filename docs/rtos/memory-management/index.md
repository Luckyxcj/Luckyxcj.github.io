# FreeRTOS 内存管理

> **文档说明**：本文档基于 FreeRTOS 源码 (`heap_1.c` ~ `heap_5.c`) 及嵌入式系统内存受限场景实战经验整理。

---

## 目录

1. [概述](#1-概述)
2. [heap_1 ~ heap_5 对比](#2-heap_1--heap_5-对比)
3. [各方案详解](#3-各方案详解)
4. [内存使用优化](#4-内存使用优化)
5. [常见问题](#5-常见问题)

---

## 1. 概述

FreeRTOS 内核对象（任务、队列、信号量等）需要动态内存，但**不使用标准库 `malloc/free`**，而是提供了 5 种可选的堆管理方案 (`heap_1.c` ~ `heap_5.c`)。

```
配置: FreeRTOSConfig.h
#define configSUPPORT_DYNAMIC_ALLOCATION  1   // 启用动态分配
#define configTOTAL_HEAP_SIZE          (15 * 1024)  // 堆总大小 (字节)
```

---

## 2. heap_1 ~ heap_5 对比

| 特性 | heap_1 | heap_2 | heap_3 | heap_4 | heap_5 |
|------|--------|--------|--------|--------|--------|
| 释放内存 | 不支持 | 支持 | 支持 | 支持 | 支持 |
| 碎片合并 | N/A | 不支持 | 取决于 libc | 支持 | 支持 |
| 线程安全 | 无 | 有 | 取决于 libc | 有 | 有 |
| 确定性 | 固定 | 低 (碎片) | 取决于 libc | 中 | 中 |
| 多堆区域 | 不支持 | 不支持 | 不支持 | 不支持 | 支持 |
| 适用场景 | 只创建不删除 | 已废弃 | 不推荐 | 通用首选 | 多 RAM 区 |

---

## 3. 各方案详解

### 3.1 heap_1 — 纯创建，永不删除

```c
// 适用: 系统启动时创建所有任务/队列, 运行中不删除
// 优点: 简单确定, 无碎片, 无互斥开销

void *pvPortMalloc(size_t xWantedSize) {
    // 简单地从堆起始地址线性分配, 永不释放
    // 内部只是一个 pucAlignedHeap 指针向前移动
}
```

### 3.2 heap_4 — 首选通用方案 (合并相邻空闲块)

```c
// 适用: 大多数应用 (90% 场景)
// 优点: 合并相邻空闲块, 减少碎片

// FreeRTOSConfig.h 推荐配置:
#define configFRTOS_MEMORY_SCHEME  4
#define configTOTAL_HEAP_SIZE      ((size_t)(15 * 1024))
```

```c
// 实际项目中, 估算堆大小的经验公式:
// Heap = 任务栈之和 + 队列 + 信号量 + 定时器 + 1KB 余量
//
// 每个任务栈: ~200-500 字 (取决于局部变量大小)
// 队列: item_size × length + 队列头 (~60 字节)
// 信号量: ~60 字节
// 软件定时器: ~80 字节
//
// 示例: 5 任务(512×5) + 3 队列(200×3) + 2 信号量(60×2) + 2KB margin
//      = 2560 + 600 + 120 + 2048 ≈ 6KB → 设 8KB
```

### 3.3 heap_5 — 多 RAM 区域

```c
// 适用: 系统有多个不连续的 RAM 区域 (如 STM32 CCM RAM + SRAM)
// CCM RAM (Core Coupled Memory): 64KB, 只能 CPU 访问
// SRAM (如 F4): 112KB, CPU + DMA 可访问

#include "FreeRTOS.h"

// 定义多个堆区域
const HeapRegion_t xHeapRegions[] = {
    { (uint8_t *)0x10000000, 0x10000 },  // CCM RAM: 64KB (任务栈, 高速数据)
    { (uint8_t *)0x20000000, 0x1C000 },  // SRAM:    112KB (DMA 缓冲, 队列)
    { NULL, 0 }                           // 终止
};

void vPortDefineHeapRegions(const HeapRegion_t * const pxHeapRegions);

// 在 main() 中调用一次:
int main(void) {
    vPortDefineHeapRegions(xHeapRegions);
    // ... 之后才能创建 FreeRTOS 对象
}
```

::: warning CCM RAM 限制
CCM RAM 不能用于 DMA 传输。将需 DMA 的数据结构 (如 ADC 缓冲、UART 缓冲) 放在 SRAM 区域，将纯 CPU 数据 (任务栈) 放在 CCM。
:::

---

## 4. 内存使用优化

```c
// 4.1 使用静态分配 (避免堆的确定性风险)
// FreeRTOSConfig.h:
#define configSUPPORT_STATIC_ALLOCATION  1

// 静态创建任务
static StackType_t  task_stack[256];
static StaticTask_t task_tcb;

TaskHandle_t handle = xTaskCreateStatic(
    vTaskFunction, "Task", 256, NULL, 1,
    task_stack,    // 预分配的栈
    &task_tcb      // 预分配的 TCB
);

// 4.2 运行时监控剩余堆
size_t free_heap = xPortGetFreeHeapSize();
size_t min_free  = xPortGetMinimumEverFreeHeapSize();
printf("Heap free: %u, min ever: %u\n", free_heap, min_free);

// 4.3 malloc 失败钩子
// FreeRTOSConfig.h:
#define configUSE_MALLOC_FAILED_HOOK  1

void vApplicationMallocFailedHook(void) {
    // 记录错误、进入安全模式、复位
    Error_Handler();
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | `pvPortMalloc` 返回 NULL | 堆耗尽 | 增大 `configTOTAL_HEAP_SIZE`；检查内存泄漏 |
| 2 | 运行一段时间后分配失败 | 内存碎片 (heap_2) | 切换到 heap_4 或 heap_5 |
| 3 | 任务创建失败 | 栈大小不足 | 使用 `uxTaskGetStackHighWaterMark()` 诊断 |
| 4 | HardFault 在 malloc 后 | DMA 访问了 CCM RAM | 将 DMA 缓冲放在 SRAM |
| 5 | heap_3 死锁 | libc malloc 无线程安全 | 用 heap_4 替代；若必须用 heap_3 则挂起调度器再 malloc |
| 6 | 静态分配对象无法删除 | 静态对象生命周期固定 | 若需动态删除/创建，使用动态分配 + heap_4 |

---

## 6. 参考文档

1. FreeRTOS 内存管理: https://www.freertos.org/a00111.html
2. FreeRTOS `heap_4.c` 源码 (~400 行，含详细注释)
3. STM32 CCM RAM 应用笔记: AN4296
4. "Mastering the FreeRTOS Real Time Kernel" — Chapter 3 (Heap Memory Management)
