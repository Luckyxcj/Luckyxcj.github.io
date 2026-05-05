# 堆与栈管理

> **文档说明**：本文档基于 ARM AAPCS (过程调用标准)、嵌入式 C 运行时库文档及实际调试经验整理。

---

## 目录

1. [栈 (Stack) 深入理解](#1-栈-stack-深入理解)
2. [堆 (Heap) 与动态内存](#2-堆-heap-与动态内存)
3. [栈溢出检测](#3-栈溢出检测)
4. [内存池与静态分配](#4-内存池与静态分配)
5. [常见内存问题排查](#5-常见内存问题排查)
6. [参考文档](#6-参考文档)

---

## 1. 栈 (Stack) 深入理解

### 1.1 栈是什么

栈是 Cortex-M 处理器的核心运行时结构。每次函数调用、中断发生时，处理器自动使用栈来保存上下文。

```
栈 (满递减, 从高地址向低地址增长):

高地址  0x2001C000  ┌──────────────┐  ← _estack (栈顶，初始 MSP)
                    │              │
                    │  已用栈空间   │  ← 当前 SP
                    │  (函数帧)    │
                    │  未用栈空间   │
低地址  0x2001B000  ├──────────────┤  ← 栈底 (由链接脚本定义)
                    │  堆          │
                    │  .bss        │
                    │  .data        │
                    └──────────────┘
```

### 1.2 中断入栈 (自动硬件行为)

当 Cortex-M 响应中断时，硬件自动将 8 个寄存器压入栈中(无需软件干预)：

```
入栈顺序 (硬件自动):
  高地址    xPSR  (状态寄存器)
            PC    (返回地址)
            LR    (链接寄存器)
            R12
            R3
            R2
            R1
  低地址    R0

总入栈大小: 8 × 4 = 32 字节 (加上可能的 FPU 扩展: +34 字节 = 共 66 字节)
```

### 1.3 栈使用估算

```c
// 示例: 分析这段代码的栈使用
void process_data(uint8_t *buf) {
    uint8_t local_copy[256];   // 栈上分配: 256 bytes
    int result;                 // 栈上分配: 4 bytes
    // ...
}

// ISR 的栈使用 = 32 bytes (自动入栈) + 256 + 4 + 可能的额外帧
// 最坏情况: 嵌套 ISR 每个 32 bytes + 各自栈使用量
```

::: danger 栈使用估算公式
嵌入式系统最坏栈深度 ≈ 基础 ISR 入栈 + 最深嵌套中断链 + 最深函数调用链 + 最深的局部变量。

粗略估计: **主栈 ≥ 8KB, 任务栈 ≥ 1KB (FreeRTOS 各任务)**。永远不要在写代码时"觉得栈够用"，要实际测量。
:::

---

## 2. 堆 (Heap) 与动态内存

### 2.1 嵌入式中的 malloc 困境

```c
// ❌ 嵌入式开发中不推荐的做法
void process_request(void) {
    // 每次请求都 malloc，可能产生碎片
    char *buffer = (char *)malloc(512);
    if (buffer == NULL) {
        // malloc 失败处理 — 但在嵌入式系统中，这几乎是不可恢复的
    }
    // ... 使用 buffer ...
    free(buffer);  // 即使 free，碎片也留下了
}
```

### 2.2 推荐：静态内存池

```c
// ✅ 嵌入式推荐：静态分配内存池
#define NUM_BUFFERS    8
#define BUFFER_SIZE  512

typedef struct {
    uint8_t  data[BUFFER_SIZE];
    uint8_t  in_use;
} Buffer_t;

Buffer_t buffer_pool[NUM_BUFFERS] = {0};  // 编译时分配，零碎片

Buffer_t *alloc_buffer(void) {
    for (int i = 0; i < NUM_BUFFERS; i++) {
        if (!buffer_pool[i].in_use) {
            buffer_pool[i].in_use = 1;
            return &buffer_pool[i];
        }
    }
    return NULL;  // 无可用 Buffer
}

void free_buffer(Buffer_t *buf) {
    buf->in_use = 0;
}
```

### 2.3 FreeRTOS heap 策略对比

FreeRTOS 提供 5 种内存管理方案 (heap_1 ~ heap_5)，选择指南：

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| heap_1 | 只分配不释放 | 简单应用，所有任务创建后不再删除 |
| heap_2 | 可释放，无合并 | 碎片化风险，不推荐新项目 |
| heap_3 | 封装标准 malloc | 线程安全的 malloc/free 封装 |
| heap_4 | 可释放 + 相邻块合并 | **推荐**，通用性最好 |
| heap_5 | heap_4 + 跨内存区域 | 有多个 RAM 区域的系统 (如 CCM+SRAM) |

---

## 3. 栈溢出检测

### 3.1 硬件方法：MPU Guard Region

```c
// 在栈底部放置一个不可读写的 MPU 防护区
void MPU_StackGuard_Config(void) {
    MPU_Region_InitTypeDef mpu = {0};

    HAL_MPU_Disable();

    mpu.Enable = MPU_REGION_ENABLE;
    mpu.Number = MPU_REGION_NUMBER0;
    mpu.BaseAddress = STACK_BOTTOM_ADDR;   // 栈底地址
    mpu.Size = MPU_REGION_SIZE_256B;       // 256 字节的防护区
    mpu.AccessPermission = MPU_REGION_NO_ACCESS;  // 禁止访问
    mpu.DisableExec = MPU_INSTRUCTION_ACCESS_DISABLE;

    HAL_MPU_ConfigRegion(&mpu);
    HAL_MPU_Enable(MPU_PRIVILEGED_DEFAULT);

    // 如果栈溢出触碰到这个区域，会触发 MemManage Fault
}
```

### 3.2 软件方法：Canary (金丝雀)

```c
// FreeRTOS 内置的栈溢出检测方法
// 在 configCHECK_FOR_STACK_OVERFLOW = 2 时启用

// 原理：在创建任务时，将任务栈全部填充为已知模式 (0xA5)
// 在每次上下文切换时，检查栈底的前 16 字节是否还是 0xA5
// 如果不是 → 栈已溢出 → 调用 vApplicationStackOverflowHook()

void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName) {
    // 栈溢出！在此记录日志、触发安全复位
    Error_Handler();
}
```

### 3.3 运行时栈使用测量

```c
// 返回当前任务的剩余栈空间 (字为单位)
uint32_t Get_Remaining_Stack(void) {
    // 在任务创建时，栈被填充为 0xA5 (如果启用了栈检查)
    // 已使用的栈会改变 0xA5 的值
    uint32_t *stack_bottom = pxCurrentTCB->pxStack;
    uint32_t *p = stack_bottom;
    while (*p == 0xA5A5A5A5UL) p++;
    return (uint32_t)(p - stack_bottom);  // 剩余栈 (字)
}
```

---

## 4. 内存池与静态分配

### 4.1 轻量级内存池实现

```c
// 可变大小的内存池分配器 (TLSF 风格简化版)
// 适合嵌入式系统，避免碎片、分配时间确定

#define POOL_SIZE (32 * 1024)  // 32KB 内存池
static uint8_t pool[POOL_SIZE] __attribute__((aligned(8)));

typedef struct BlockHeader {
    uint32_t size : 31;    // 块大小
    uint32_t used : 1;     // 是否在用
    struct BlockHeader *next;
} BlockHeader_t;

static BlockHeader_t *free_list = NULL;

void pool_init(void) {
    free_list = (BlockHeader_t *)pool;
    free_list->size = POOL_SIZE - sizeof(BlockHeader_t);
    free_list->used = 0;
    free_list->next = NULL;
}

void *pool_alloc(uint32_t size) {
    BlockHeader_t *prev = NULL;
    BlockHeader_t *curr = free_list;

    size = (size + 7) & ~7;  // 8 字节对齐

    while (curr) {
        if (!curr->used && curr->size >= size) {
            // 找到足够大的空闲块
            if (curr->size > size + sizeof(BlockHeader_t) + 8) {
                // 分割：剩余空间足够大，分出一个新块
                BlockHeader_t *new_block =
                    (BlockHeader_t *)((uint8_t *)curr +
                                      sizeof(BlockHeader_t) + size);
                new_block->size = curr->size - size - sizeof(BlockHeader_t);
                new_block->used = 0;
                new_block->next = curr->next;

                curr->size = size;
                curr->next = new_block;
            }
            curr->used = 1;
            return (void *)((uint8_t *)curr + sizeof(BlockHeader_t));
        }
        prev = curr;
        curr = curr->next;
    }
    return NULL;  // OOM
}
```

---

## 5. 常见内存问题排查

| # | 问题 | 现象 | 诊断方法 |
|---|------|------|---------|
| 1 | **栈溢出** | 程序随机死机，HardFault，变量值异常 | 检查 SP 是否超出了栈的范围；用 canary 方法 |
| 2 | **堆碎片** | 长时间运行后 malloc 返回 NULL | 用内存池替代 malloc/free |
| 3 | **使用已释放的内存 (Use-after-free)** | 随机行为，极难复现 | 释放后将指针置为 NULL；静态分析工具 |
| 4 | **内存泄漏** | 内存剩余量逐渐减小 | 跟踪 alloc/free 的配对；记录每次 malloc 的大小和调用者 |
| 5 | **返回局部变量地址** | 调用者读取到错误数据 | 编译器警告 `-Wreturn-local-addr` |
| 6 | **DMA 缓冲区在栈上** | DMA 还在传输，函数已返回 | 将 DMA 缓冲区声明为 static 或全局 |
| 7 | **CCM 内存用于 DMA** | DMA 传输的数据全为 0 | 检查 DMA 缓冲区的链接地址是否在 0x10000000 区域 |

### 5.1 HardFault 栈回溯技巧

```c
// HardFault 发生时，在 HardFault_Handler 中分析栈帧
void HardFault_Handler(void) {
    uint32_t stacked_r0;
    uint32_t stacked_pc;
    uint32_t stacked_lr;
    uint32_t stacked_psr;

    // 获取进入异常前的栈指针 (取决于使用的是 MSP 还是 PSP)
    __asm volatile (
        "TST lr, #4      \n"  // 检查 EXC_RETURN 的 bit 2
        "ITE EQ           \n"
        "MRSEQ r0, MSP    \n"  // 如果 bit 2 = 0, 使用 MSP
        "MRSNE r0, PSP    \n"  // 如果 bit 2 = 1, 使用 PSP (RTOS 任务栈)
        "B hardfault_analyze \n"
    );
}

void hardfault_analyze(uint32_t *sp) {
    // sp[0] = R0, sp[1] = R1, ..., sp[5] = LR, sp[6] = PC, sp[7] = xPSR
    uint32_t fault_pc = sp[6];       // 出错的指令地址
    uint32_t fault_lr = sp[5];       // 返回地址

    // 通过 fault_pc 在 map 文件中查找哪个函数出错了
    // arm-none-eabi-addr2line -e firmware.elf 0x08001234
    printf("HardFault at PC = 0x%08X, LR = 0x%08X\n", fault_pc, fault_lr);

    // 检查硬件故障状态寄存器以获取更多信息
    if (SCB->CFSR & SCB_CFSR_IACCVIOL_Msk)  printf("IACCVIOL\n");
    if (SCB->CFSR & SCB_CFSR_DACCVIOL_Msk)  printf("DACCVIOL\n");
    if (SCB->CFSR & SCB_CFSR_MUNSTKERR_Msk) printf("MUNSTKERR\n");
    if (SCB->CFSR & SCB_CFSR_MSTKERR_Msk)   printf("MSTKERR\n");

    while (1);  // 停在这里，调试器可以分析
}
```

---

## 6. 参考文档

1. ARM IHI 0042: Procedure Call Standard for the ARM Architecture (AAPCS)
2. ARM DDI 0403E: Cortex-M4 TRM — Fault Handling
3. FreeRTOS Memory Management: https://www.freertos.org/a00111.html
4. "TLSF: A New Dynamic Memory Allocator" — Masmano et al.
5. ST Application Note AN5342: STM32 中 MPU 的使用
