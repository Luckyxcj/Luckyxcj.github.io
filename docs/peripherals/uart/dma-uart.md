# DMA 串口 + 空闲中断实战

> **文档说明**：本文档深入讲解 UART DMA + 空闲中断 (IDLE) 方案，这是嵌入式开发中最常用的串口接收模式。

---

## 目录

1. [为什么选择 DMA + IDLE](#1-为什么选择-dma--idle)
2. [DMA 配置详解](#2-dma-配置详解)
3. [不定长帧接收实现](#3-不定长帧接收实现)
4. [DMA 半满/全满双重中断](#4-dma-半满全满双重中断)
5. [常见问题与排查](#5-常见问题与排查)

---

## 1. 为什么选择 DMA + IDLE

```
四种 UART 接收方案对比:

方案                     CPU 占用    延迟     缓冲区管理    适合场景
───────────────────────────────────────────────────────────────────
单字节轮询                极高     实时      简单          测试/演示
单字节中断              中       实时      环形缓冲区      简单协议
DMA 定长接收            零       需满才响应 简单          固定长度协议
DMA + IDLE (推荐)       零        <1ms     自适应         所有场景
```

---

## 2. DMA 配置详解

```c
// DMA 配置 (CubeMX 生成 + 手动增强)
void MX_DMA_Init(void) {
    __HAL_RCC_DMA1_CLK_ENABLE();

    // USART1 RX DMA 通道
    hdma_usart1_rx.Instance = DMA1_Stream5;
    hdma_usart1_rx.Init.Channel = DMA_CHANNEL_4;
    hdma_usart1_rx.Init.Direction = DMA_PERIPH_TO_MEMORY;  // 外设→内存
    hdma_usart1_rx.Init.PeriphInc = DMA_PINC_DISABLE;      // 外设地址不变
    hdma_usart1_rx.Init.MemInc = DMA_MINC_ENABLE;           // 内存地址自增
    hdma_usart1_rx.Init.PeriphDataAlignment = DMA_PDATAALIGN_BYTE;
    hdma_usart1_rx.Init.MemDataAlignment = DMA_MDATAALIGN_BYTE;
    hdma_usart1_rx.Init.Mode = DMA_CIRCULAR;                // 循环模式!
    hdma_usart1_rx.Init.Priority = DMA_PRIORITY_HIGH;

    HAL_DMA_Init(&hdma_usart1_rx);
    __HAL_LINKDMA(&huart1, hdmarx, hdma_usart1_rx);
}
```

---

## 3. 不定长帧接收实现

```c
// 完整的不定长帧接收实现 (基于 DMA + IDLE)
#define UART_BUF_SIZE 512

static uint8_t  dma_buf[UART_BUF_SIZE];
static uint8_t  frame_buf[UART_BUF_SIZE];
static volatile uint16_t frame_len = 0;
static volatile uint8_t  frame_ready = 0;

void UART_DMA_IDLE_Start(void) {
    // 使能 IDLE 中断
    __HAL_UART_ENABLE_IT(&huart1, UART_IT_IDLE);
    // 启动 DMA 循环接收
    HAL_UART_Receive_DMA(&huart1, dma_buf, UART_BUF_SIZE);
}

void USART1_IRQHandler(void) {
    if (__HAL_UART_GET_FLAG(&huart1, UART_FLAG_IDLE)) {
        // 清除 IDLE 标志 (读 SR 然后读 DR)
        __HAL_UART_CLEAR_IDLEFLAG(&huart1);

        // 停止 DMA 获取已接收的字节数
        HAL_UART_DMAStop(&huart1);

        uint16_t pos = UART_BUF_SIZE - __HAL_DMA_GET_COUNTER(huart1.hdmarx);
        if (pos > 0 && pos <= UART_BUF_SIZE) {
            memcpy(frame_buf, dma_buf, pos);
            frame_len = pos;
            frame_ready = 1;
        }

        // 重新开始 DMA 接收
        HAL_UART_Receive_DMA(&huart1, dma_buf, UART_BUF_SIZE);
    }
    HAL_UART_IRQHandler(&huart1);
}
```

---

## 4. DMA 半满/全满双重中断

当数据量较大时，只用 IDLE 可能不够快。可以配合 DMA 的 Half Transfer Complete (HT) 和 Transfer Complete (TC) 中断：

```c
// 双缓冲区 (Ping-Pong) 模式
#define BUF_SIZE 256
uint8_t buf_a[BUF_SIZE], buf_b[BUF_SIZE];

void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size) {
    if (Size == BUF_SIZE / 2) {
        // 半满: 处理 buf 的前半部分
    } else if (Size == BUF_SIZE) {
        // 全满: 处理 buf 的后半部分
    }
}

// 在 CubeMX 中启用: DMA Settings → Mode → Circular
// USART Settings → Overrun → Enable (防止溢出错误导致 DMA 停止)
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | IDLE 中断不触发 | 连续数据流无空闲 | 需配合 DMA HT/TC 中断；或使用定时器超时检测 |
| 2 | DMA 接收的字节顺序混乱 | 缓冲区地址不是字节对齐，或 memcpy 了错误大小 | `dma_buf` 确保地址对齐；用 `pos = BUF_SIZE - NDTR` 计算位置 |
| 3 | IDLE 中断反复触发 | IDLE 标志没有正确清除 | 读 SR 再读 DR 两步操作不要被中断打断 |
| 4 | DMA 在溢出后停止 | ORE (溢出错误) 标志会同时设置 → HAL 库会 Abort DMA | 在 CubeMX 中启用 Overrun Disable 选项 |

---

## 6. 参考文档

1. RM0090: STM32F4xx — USART 和 DMA 章节
2. ST AN3109: STM32 UART 应用笔记
3. ST Wiki: UART DMA IDLE Line Detection
