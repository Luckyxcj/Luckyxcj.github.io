# DMA 直接存储器访问

> **文档说明**：本文档基于 STM32 参考手册 DMA 章节，涵盖双 DMA 控制器架构、传输模式和常见陷阱。

---

## 目录

1. [DMA 基础](#1-dma-基础)
2. [STM32 DMA 架构](#2-stm32-dma-架构)
3. [DMA 配置实战](#3-dma-配置实战)
4. [DMA 与 Cache 一致性](#4-dma-与-cache-一致性)
5. [常见问题与排查](#5-常见问题与排查)

---

## 1. DMA 基础

DMA (Direct Memory Access) 控制器可以在不占用 CPU 的情况下完成数据在外设和内存之间的传输。

```
DMA 传输路径:

 外设 (ADC, USART, SPI, 等)
      ↕   DMA 请求
  DMA 控制器
      ↕   总线矩阵
  SRAM / Flash / 外设寄存器
```

**DMA 的优势**：
- CPU 完全不参与数据传输 (解放 CPU)
- 高速传输 (通过总线矩阵)
- 支持复杂传输模式 (循环、双缓冲、 scatter-gather)

---

## 2. STM32 DMA 架构

### 2.1 F4/H7 系列 DMA 控制器

```
STM32F4:
  DMA1: 8 个 Stream × 8 个 Channel
  DMA2: 8 个 Stream × 8 个 Channel
  共 16 个独立的 DMA 通道

每个 Stream 可配置为:
  ├─ 外设→内存 (RX)
  ├─ 内存→外设 (TX)
  └─ 内存→内存 (Mem-to-Mem)
```

### 2.2 DMA 请求映射

```c
// 常用 DMA 映射 (F4 系列):

// USART1 RX → DMA2 Stream 5 Channel 4
// USART1 TX → DMA2 Stream 7 Channel 4
// SPI1 RX   → DMA2 Stream 0 Channel 3
// SPI1 TX   → DMA2 Stream 3 Channel 3
// ADC1      → DMA2 Stream 0 Channel 0

// 查数据手册的 DMA Request Mapping 表格获取完整映射!
```

---

## 3. DMA 配置实战

### 3.1 USART TX DMA (常见应用)

```c
// DMA USART1 发送
DMA_HandleTypeDef hdma_usart1_tx;

void MX_DMA_USART1_TX_Init(void) {
    __HAL_RCC_DMA2_CLK_ENABLE();

    hdma_usart1_tx.Instance = DMA2_Stream7;
    hdma_usart1_tx.Init.Channel = DMA_CHANNEL_4;             // USART1 TX
    hdma_usart1_tx.Init.Direction = DMA_MEMORY_TO_PERIPH;    // 内存→外设
    hdma_usart1_tx.Init.PeriphInc = DMA_PINC_DISABLE;        // 外设地址不变
    hdma_usart1_tx.Init.MemInc = DMA_MINC_ENABLE;            // 内存地址自增
    hdma_usart1_tx.Init.PeriphDataAlignment = DMA_PDATAALIGN_BYTE;
    hdma_usart1_tx.Init.MemDataAlignment = DMA_MDATAALIGN_BYTE;
    hdma_usart1_tx.Init.Mode = DMA_NORMAL;                   // 单次模式
    hdma_usart1_tx.Init.Priority = DMA_PRIORITY_MEDIUM;
    HAL_DMA_Init(&hdma_usart1_tx);

    // 链接到 USART1
    __HAL_LINKDMA(&huart1, hdmatx, hdma_usart1_tx);
}
```

### 3.2 DMA 循环模式 (ADC 连续采集)

```c
// ADC DMA 循环接收
hdma_adc1.Init.Mode = DMA_CIRCULAR;  // 循环模式: 传输完成后自动重新开始
hdma_adc1.Init.Direction = DMA_PERIPH_TO_MEMORY;

// 启动后, ADC 数据自动填充到 adc_buf[], 不需要 CPU 任何干预
HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buf, BUF_SIZE);
```

### 3.3 内存到内存传输

```c
// DMA 可以在内存之间拷贝数据 (极快, 不占用 CPU)
uint8_t src[1024], dst[1024];

// 配置 DMA2 Stream 0 为 Mem-to-Mem 模式
hdma_mem.Init.Direction = DMA_MEMORY_TO_MEMORY;
hdma_mem.Init.Mode = DMA_NORMAL;
HAL_DMA_Init(&hdma_mem);

// 执行内存拷贝 (CPU 继续执行其他任务)
HAL_DMA_Start(&hdma_mem, (uint32_t)src, (uint32_t)dst, 1024);
```

---

## 4. DMA 与 Cache 一致性

::: danger H7/F7 系列特别注意
Cortex-M7 系列 (F7, H7) 有 L1 Cache。CPU 写入的数据可能在 Cache 中（还未刷到 SRAM），而 DMA 直接读 SRAM。两者看到的数据不一致！
:::

```c
// 发送数据前: Clean Cache → SRAM (确保 DMA 读到最新数据)
uint8_t tx_buf[256] __attribute__((aligned(32)));  // 必须 32 字节对齐!

// 填充 tx_buf ...
SCB_CleanDCache_by_Addr((uint32_t *)tx_buf, 256);  // 刷 Cache
HAL_UART_Transmit_DMA(&huart1, tx_buf, 256);        // 启动 DMA

// 接收数据后: Invalidate Cache ← SRAM (确保 CPU 读到 DMA 写入的最新数据)
HAL_UART_Receive_DMA(&huart1, rx_buf, 256);
// ... 在 DMA 完成中断中:
SCB_InvalidateDCache_by_Addr((uint32_t *)rx_buf, 256);
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | DMA 传输数据全为 0 | DMA 源或目标地址错误 | 检查 `PeriphInc`/`MemInc` 设置；地址是否在可访问范围内 |
| 2 | H7/F7 DMA 和 CPU 数据不一致 | Cache 一致性 | Clean/Invalidate Cache |
| 3 | DMA 不启动 | 外设的 DMA 请求未使能 | 对于 USART: 需要 `__HAL_UART_ENABLE_IT(&huart, UART_IT_IDLE)` 或类似的使能 |
| 4 | DMA 传输长度少于预期 | DMA 配置的数据宽度与数据尺寸不匹配 | 例如: 用 HALFWORD 传输 BYTE 数据 → 长度减半 |
| 5 | DMA 通道冲突 | 两个外设共用一个 DMA Stream | 查看 DMA Request Mapping 表格, 确保 Stream/Channel 组合唯一 |

---

## 6. 参考文档

1. RM0090: STM32F4xx — DMA 章节
2. RM0433: STM32H7x3 — DMA 和 MDMA 章节
3. ST AN4031: STM32F2/F4 DMA 使用指南
4. ARM TRM: Cortex-M7 L1 Cache Maintenance
