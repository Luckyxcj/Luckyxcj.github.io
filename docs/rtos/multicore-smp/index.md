# 多核与 SMP 编程

> **文档说明**：本文档基于 ARM Cortex-A/R/M 多核架构及 FreeRTOS SMP 支持经验整理。

---

## 目录

1. [多核架构基础](#1-多核架构基础)
2. [AMP vs SMP vs BMP](#2-amp-vs-smp-vs-bmp)
3. [FreeRTOS SMP 实战](#3-freertos-smp-实战)
4. [多核同步与数据共享](#4-多核同步与数据共享)
5. [常见问题](#5-常见问题)

---

## 1. 多核架构基础

嵌入式多核处理器分类：

```
多核架构:

  AMP (非对称)              SMP (对称)              BMP (绑定)
  ┌─────┐ ┌─────┐        ┌─────┐ ┌─────┐        ┌─────┐ ┌─────┐
  │ OS1 │ │ OS2 │        │    OS (共享) │        │  OS  │ │ 裸机 │
  │Core0│ │Core1│        │Core0│ │Core1│        │Core0│ │Core1│
  └──┬──┘ └──┬──┘        └──┬──┘ └──┬──┘        └──┬──┘ └──┬──┘
     │       │              │       │              │       │
  ┌──┴───────┴──┐        ┌──┴───────┴──┐        ┌──┴───────┴──┐
  │   共享内存    │        │ 共享内存 + Cache│      │   共享内存    │
  └─────────────┘        └─────────────┘        └─────────────┘
```

| 芯片系列 | 核心数 | 架构 | 典型用途 |
|---------|--------|------|---------|
| STM32H745 | 2 (M7+M4) | AMP | M7 跑 GUI/网络, M4 跑实时控制 |
| ESP32 | 2 (LX6/LX7) | SMP | 双核均衡负载 |
| RP2040 | 2 (M0+) | SMP | 双核执行相同固件 |
| i.MX RT1170 | 2 (M7+M4) | AMP | 同 H745 |
| NXP LPC55S69 | 2 (M33+M33) | AMP/SMP 可选 | 安全核 + 应用核 |

---

## 2. AMP vs SMP vs BMP

| 特性 | AMP | SMP | BMP |
|------|-----|-----|-----|
| 每个核运行独立 OS | 是 | 否 (共享一个 OS) | OS 在指定核 |
| 负载均衡 | 手动分配 | 自动 (调度器) | 手动分配 |
| 任务迁移 | 不支持 | 支持 | 不支持 |
| 通信方式 | 共享内存 / RPMsg | 共享内存 (需互斥) | 共享内存 |
| 调试复杂度 | 低 (独立调试) | 高 (竞态条件) | 中 |
| FreeRTOS 支持 | 需两套独立实例 | FreeRTOS SMP 分支 | 自定义 |

```
双核 AMP 通信模式 (OpenAMP / RPMsg):

  Core M7 (主核)              Core M4 (从核)
  ┌────────────┐              ┌────────────┐
  │  Linux / RTOS│              │  FreeRTOS   │
  │     │       │    RPMsg     │     │       │
  │  virtIO ◄───┼──────────────┼───► virtIO │
  │     │       │  (共享内存)   │     │       │
  └────────────┘              └────────────┘
```

---

## 3. FreeRTOS SMP 实战

FreeRTOS 官方提供了 SMP 支持（原为独立仓库，现已合并到主仓库）。

```c
// FreeRTOSConfig.h SMP 配置
#define configNUMBER_OF_CORES  2  // 核数量

// 默认: 任务可以在任意核上运行
// 若需绑定到指定核:
#if (configNUMBER_OF_CORES > 1)
    // 将任务固定到 Core 0 (如实时控制)
    vTaskCoreAffinitySet(hControlTask, (1 << 0));

    // 将任务固定到 Core 1 (如网络处理)
    vTaskCoreAffinitySet(hNetTask, (1 << 1));
#endif

// SMP 任务创建 (与单核 FreeRTOS API 完全兼容)
void ControlTask(void *pvParameters) {
    // 固定到 Core 0, 高优先级实时控制
    volatile uint32_t *gpio_addr = (uint32_t *)0x40020014;

    for (;;) {
        *gpio_addr = 0x01;  // 原子操作: 对齐的 32-bit 写
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

// SMP 注意事项:
// 1. 同一优先级任务可以同时在两个核上运行
// 2. 临界区 (taskENTER_CRITICAL) 使用自旋锁 (spinlock), 不是关中断
// 3. 调度器为每个核维护独立的就绪列表
```

### Spinlock 使用

```c
// FreeRTOS SMP 提供自旋锁 API
static Spinlock_t my_spinlock;

void SharedResource_Access(void) {
    // 单核时 = 关中断; SMP 时 = 自旋锁 (不关中断)
    taskENTER_CRITICAL(&my_spinlock);
    // ... 临界区 (越短越好, 自旋锁期间另一核可能在忙等) ...
    taskEXIT_CRITICAL(&my_spinlock);
}
```

---

## 4. 多核同步与数据共享

### 4.1 Cache 一致性

```c
// Cortex-M7 带 DCache, 多核共享数据必须处理一致性问题
#include "stm32h7xx_hal.h"

// 核 A 写完数据后:
SCB_CleanDCache_by_Addr((uint32_t *)shared_buf, buf_size);

// 核 B 读数据前:
SCB_InvalidateDCache_by_Addr((uint32_t *)shared_buf, buf_size);

// 或者: 将共享数据放在 Non-Cacheable 区域
// (通过 MPU 配置 Shared 内存为 Write-Through 或 Non-Cacheable)
```

### 4.2 硬件互斥与原子操作

```c
// ARMv7-M 提供 LDREX/STREX 互斥访问指令
// CMSIS 封装为:

uint32_t value = __LDREXW(&shared_var);
// ... 修改 value ...
if (__STREXW(new_value, &shared_var) == 0) {
    // 写入成功 (无其他核竞争)
} else {
    // 写入失败，重试
}

// C11 原子操作 (ARMCC 6 / GCC 支持):
#include <stdatomic.h>
atomic_uint counter;
atomic_fetch_add(&counter, 1);  // 原子自增
```

### 4.3 硬件信号量 (HSEM)

```c
// STM32H7 提供硬件信号量 (HSEM) 用于多核同步
// HAL 库使用:

// Core M7 获取信号量 0
HAL_HSEM_Take(0, HSEM_CORE_ID_CPU1);

// Core M4 等待信号量 0 (被 M7 释放)
HAL_HSEM_FastTake(0);
// ... 访问共享外设 ...
HAL_HSEM_Release(0, HSEM_CORE_ID_CPU2);
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 数据竞争导致随机错误 | 多核同时访问共享变量 | 使用 spinlock 或原子操作保护 |
| 2 | H7 双核启动后 M4 不运行 | H7 启动时仅 M7 运行, 需手动启动 M4 | 使用 `HAL_RCCEx_EnableBootCore()` |
| 3 | Cache 一致性问题 | DCache 与共享内存不一致 | 配置 MPU 为 Non-Cacheable 或手动 Clean/Invalidate |
| 4 | 死锁 | 两核互相等待对方释放锁 | 统一加锁顺序；使用 `try_lock` + 超时 |
| 5 | SMP 任务绑定失败 | 亲和性掩码无效 | 检查 `configNUMBER_OF_CORES` 配置 |
| 6 | 单核代码在 SMP 上崩溃 | 单核假设 `taskENTER_CRITICAL` 关中断, SMP 不关闭 | 代码中依赖关中断的地方改用 spinlock |

---

## 6. 参考文档

1. FreeRTOS SMP 文档: https://www.freertos.org/symmetric-multiprocessing-introduction.html
2. STM32H7 双核编程手册: AN5617
3. ARM Cortex-M7 技术参考手册 — Cache 与互斥章节
4. OpenAMP 开源项目: https://github.com/OpenAMP/open-amp
5. RP2040 多核编程指南: https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf
