# RT-Thread 入门

> **文档说明**：本文档基于 RT-Thread 官方文档及国产 MCU 平台移植经验整理。

---

## 目录

1. [RT-Thread 简介](#1-rt-thread-简介)
2. [与 FreeRTOS 对比](#2-与-freertos-对比)
3. [快速上手 (STM32)](#3-快速上手-stm32)
4. [核心功能速览](#4-核心功能速览)
5. [常见问题](#5-常见问题)

---

## 1. RT-Thread 简介

RT-Thread 是一个国产开源实时操作系统，由上海睿赛德科技主导。与 FreeRTOS 仅提供内核不同，RT-Thread 定位为**物联网操作系统**，内置了丰富的中间件组件。

```
RT-Thread 架构:

┌──────────────────────────────────────────┐
│  软件包 (300+)                             │
│  ┌─────┐ ┌─────┐ ┌──────┐ ┌──────────┐  │
│  │MQTT │ │TLS  │ │HTTP │ │WebTerminal│  │
│  └─────┘ └─────┘ └──────┘ └──────────┘  │
├──────────────────────────────────────────┤
│  组件层                                    │
│  ┌──────────┐ ┌──────┐ ┌──────────────┐  │
│  │ 虚拟文件系统│ │网络栈 │ │ 设备驱动框架  │  │
│  │  (DFS)    │ │(LwIP)│ │ (I2C/SPI/UART)│  │
│  └──────────┘ └──────┘ └──────────────┘  │
├──────────────────────────────────────────┤
│  内核层                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────┐ │
│  │任务调度│ │ IPC  │ │内存管理│ │ 时钟管理 │ │
│  └──────┘ └──────┘ └──────┘ └─────────┘ │
├──────────────────────────────────────────┤
│  硬件抽象 (libcpu / BSP)                   │
└──────────────────────────────────────────┘
```

---

## 2. 与 FreeRTOS 对比

| 特性 | FreeRTOS | RT-Thread |
|------|----------|-----------|
| 内核 | 仅内核 | 内核 + 丰富的组件生态 |
| 设备驱动框架 | 无 (需自行封装) | 内置统一 I/O 设备框架 |
| 文件系统 | 无内置 | DFS (支持 FAT, LittleFS, etc.) |
| 网络协议栈 | 需自行集成 LwIP | 自带 LwIP + SAL 抽象层 |
| 软件包管理 | 无 | env 工具 + pkgs 在线仓库 (300+ 包) |
| 命令行 | 无 (需 FreeRTOS+CLI) | 内置 FinSH (类 Linux shell) |
| 学习曲线 | 低 | 中 |
| 内存占用 | ~5KB ROM + ~1KB RAM | ~6KB ROM + ~2KB RAM (最小内核) |
| IDE 支持 | 各厂商原生 | RT-Thread Studio (基于 Eclipse) |
| 商业授权 | MIT | Apache 2.0 |

::: tip 选型建议
- 纯内核需求（只需调度 + IPC）→ FreeRTOS（更轻量、文档更广）
- 需要设备框架、文件系统、网络、Shell 调试 → RT-Thread（开箱即用）
- 国内供应链 + 中文社区支持 → RT-Thread
:::

---

## 3. 快速上手 (STM32)

### 3.1 使用 RT-Thread Studio 创建项目

```
1. 下载 RT-Thread Studio: https://www.rt-thread.org/page/studio.html
2. 新建项目 → 选择芯片 (如 STM32F407ZE)
3. 自动生成带内核 + FinSH + 串口驱动的工程
4. 编译烧录, 串口终端输入 help 查看命令
```

### 3.2 手动移植 (Keil / CubeMX)

```c
// 使用 RT-Thread Nano (极简内核, 仅 ~3KB ROM)
// 步骤: CubeMX 生成 HAL 工程 → 添加 RT-Thread Nano 包

// 1. Clock 配置: 在 SysTick_Handler 中调用
void SysTick_Handler(void) {
    HAL_IncTick();
    rt_tick_increase();  // RT-Thread 心跳
}

// 2. 创建任务
#include <rtthread.h>

static struct rt_thread led_thread;
static char led_thread_stack[256];

void led_thread_entry(void *parameter) {
    while (1) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        rt_thread_mdelay(500);
    }
}

int main(void) {
    HAL_Init();
    SystemClock_Config();

    rt_thread_init(&led_thread,
                   "led",
                   led_thread_entry,
                   RT_NULL,
                   led_thread_stack, sizeof(led_thread_stack),
                   RT_THREAD_PRIORITY_MAX - 1,  // 高优先级
                   20);  // 时间片 (tick)
    rt_thread_startup(&led_thread);

    // 启动调度器 (永不返回)
    return 0;  // 永远不会执行到这里
}
```

---

## 4. 核心功能速览

### 4.1 FinSH 控制台

```
// 串口终端交互式调试
msh >help
msh >ps          // 查看所有线程
msh >free        // 查看内存
msh >list_device // 查看注册的设备
msh >list_timer  // 查看定时器

// 可导出自定义命令
static void my_cmd(int argc, char **argv) {
    rt_kprintf("Hello from my_cmd!\n");
}
MSH_CMD_EXPORT(my_cmd, custom shell command example);
```

### 4.2 I/O 设备框架

```c
// 统一的设备操作接口
#include <rtdevice.h>

rt_device_t i2c_dev = rt_device_find("i2c1");
rt_device_open(i2c_dev, RT_DEVICE_FLAG_RDWR);

// 所有设备共用一套 read/write/control 接口
struct rt_i2c_msg msgs[2];
// ... 配置 msgs
rt_device_control(i2c_dev, RT_I2C_DEV_CTL_TRANSFER, &msgs);
```

### 4.3 信号量 / 互斥量

```c
// RT-Thread IPC 与 FreeRTOS 类似，但 API 前缀不同
rt_sem_t sem = rt_sem_create("mysem", 0, RT_IPC_FLAG_FIFO);
rt_sem_take(sem, RT_WAITING_FOREVER);
rt_sem_release(sem);

rt_mutex_t mtx = rt_mutex_create("mymtx", RT_IPC_FLAG_PRIO);
rt_mutex_take(mtx, RT_WAITING_FOREVER);
// 临界区 ...
rt_mutex_release(mtx);
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | RT-Thread Studio 找不到芯片 | 未安装对应芯片支持包 | SDK Manager → 安装对应系列的 Board Support Package |
| 2 | 系统不调度 (卡在空闲任务) | SysTick 中断未配置 | 检查 `SysTick_Handler` 中是否调用了 `rt_tick_increase()` |
| 3 | `rt_thread_mdelay` 不准 | 时钟配置错误 | 检查 `RT_TICK_PER_SECOND` 与实际 SysTick 频率一致 |
| 4 | FinSH 无响应 | 串口设备未注册或波特率不匹配 | 检查 `rt_hw_console_output()` 实现 |
| 5 | 堆栈溢出 | 线程栈太小 | 使用 `list_thread` 查看栈使用率，增大栈大小 |
| 6 | Nano 版本缺少组件功能 | Nano 只含内核 | 升级到完整版或手动添加组件 |

---

## 6. 参考文档

1. RT-Thread 文档中心: https://www.rt-thread.org/document/site/
2. RT-Thread 编程指南: https://github.com/RT-Thread/rtthread-manual-doc
3. RT-Thread Studio 用户手册: https://www.rt-thread.org/page/studio.html
4. RT-Thread 软件包仓库: https://packages.rt-thread.org/
5. "嵌入式实时操作系统 RT-Thread 设计与实现" — 邱祎 著
