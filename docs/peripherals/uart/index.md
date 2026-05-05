# UART 通用异步收发传输器

> **文档说明**：本文档基于 STM32 参考手册 USART 章节及工程实践经验整理，涵盖从基础到 DMA 的高级用法。

---

## 目录

1. [UART 基础](#1-uart-基础)
2. [STM32 USART 配置详解](#2-stm32-usart-配置详解)
3. [中断接收与环形缓冲区](#3-中断接收与环形缓冲区)
4. [DMA 接收与空闲中断](#4-dma-接收与空闲中断)
5. [RS-232 / RS-485 实战](#5-rs-232--rs-485-实战)
6. [常见问题与排查](#6-常见问题与排查)
7. [参考文档](#7-参考文档)

---

## 1. UART 基础

### 1.1 帧格式

```
UART 数据帧 (8N1 — 最常用):

空闲 (高) ┐  起始位  ┌─┬─┬─┬─┬─┬─┬─┬─┐  停止位
          │   0     │0│1│2│3│4│5│6│7│   1    │  空闲
          └─────────┘                     └───────┘

LSB 先发送 (bit 0 最先出现在线上)
```

| 参数 | 可选值 | 最常见 |
|------|--------|--------|
| 波特率 | 9600 ~ 4608000+ | 115200 |
| 数据位 | 7, 8, 9 | 8 |
| 停止位 | 1, 0.5, 2 | 1 |
| 校验位 | None, Even, Odd | None |

### 1.2 波特率误差容忍度

UART 异步通信没有时钟线，收发双方靠各自的时钟生成波特率。如果双方频率偏差过大，会在 1 帧内累积采样误差。

```
最大允许频率偏差 ≈ 5% (典型) / 帧长

对于 8N1 (10 bit 帧: 1 Start + 8 Data + 1 Stop):
允许偏差 ≈ 5% / 10 = 0.5%

这意味着 115200 bps 下，双方的时钟误差必须 < 0.5%
内部 HSI (16MHz ±1%) 的精度不够作为 UART 时钟源
必须使用 HSE (晶振, ±20ppm) 或校准后的 PLL
```

### 1.3 典型引脚连接

```
MCU       外设
TX ───────→ RX
RX ←─────── TX
GND ─────── GND

注意: TX 接对方的 RX, 不是 TX 接 TX!
```

---

## 2. STM32 USART 配置详解

### 2.1 HAL 库初始化

```c
UART_HandleTypeDef huart1;

void MX_USART1_UART_Init(void) {
    huart1.Instance = USART1;
    huart1.Init.BaudRate = 115200;
    huart1.Init.WordLength = UART_WORDLENGTH_8B;
    huart1.Init.StopBits = UART_STOPBITS_1;
    huart1.Init.Parity = UART_PARITY_NONE;
    huart1.Init.Mode = UART_MODE_TX_RX;
    huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
    huart1.Init.OverSampling = UART_OVERSAMPLING_16;
    HAL_UART_Init(&huart1);
}

// HAL_UART_MspInit: 底层 GPIO + 时钟配置
void HAL_UART_MspInit(UART_HandleTypeDef *huart) {
    GPIO_InitTypeDef gpio = {0};
    if (huart->Instance == USART1) {
        __HAL_RCC_USART1_CLK_ENABLE();
        __HAL_RCC_GPIOA_CLK_ENABLE();

        // PA9 = TX, PA10 = RX
        gpio.Pin = GPIO_PIN_9 | GPIO_PIN_10;
        gpio.Mode = GPIO_MODE_AF_PP;
        gpio.Pull = GPIO_PULLUP;
        gpio.Speed = GPIO_SPEED_FREQ_HIGH;
        gpio.Alternate = GPIO_AF7_USART1;
        HAL_GPIO_Init(GPIOA, &gpio);

        HAL_NVIC_SetPriority(USART1_IRQn, 3, 0);
        HAL_NVIC_EnableIRQ(USART1_IRQn);
    }
}
```

### 2.2 阻塞发送 vs 中断发送 vs DMA 发送

```c
// 方式1: 阻塞发送 (CPU 等待所有数据发送完成)
// 适合: 短数据 (几个字节), 初始化阶段的调试输出
HAL_UART_Transmit(&huart1, (uint8_t*)"Hello\r\n", 7, 100);

// 方式2: 中断发送 (CPU 不等待, 发送完触发中断)
// 适合: 中等长度数据, 不需要 DMA 的场景
HAL_UART_Transmit_IT(&huart1, tx_data, tx_len);
// 完成回调: HAL_UART_TxCpltCallback()

// 方式3: DMA 发送 (CPU 完全不参与)
// 适合: 大批量数据, CPU 需要同时做其他事情
HAL_UART_Transmit_DMA(&huart1, tx_data, tx_len);
// 完成回调: HAL_UART_TxCpltCallback()
```

---

## 3. 中断接收与环形缓冲区

```c
// ====== 单字节中断接收 ======
uint8_t rx_byte;

// 启动中断接收 (每次只收 1 字节)
HAL_UART_Receive_IT(&huart1, &rx_byte, 1);

// 接收完成回调
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART1) {
        // 处理收到的字节
        Process_Byte(rx_byte);
        // 重新启动接收 (关键! 否则不会再收下一个字节)
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    }
}

// ====== 环形缓冲区 (适合高频接收) ======
#define RX_BUF_SIZE 256
uint8_t rx_buf[RX_BUF_SIZE];
volatile uint16_t rx_head = 0;
volatile uint16_t rx_tail = 0;

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART1) {
        uint16_t next = (rx_head + 1) % RX_BUF_SIZE;
        if (next != rx_tail) {
            rx_buf[rx_head] = rx_byte;
            rx_head = next;
        }
        // 重启接收
        HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
    }
}
```

---

## 4. DMA 接收与空闲中断

DMA + 空闲中断 (IDLE) 是 UART 接收的最佳方案：DMA 自动将接收到的数据写入缓冲区，空闲中断检测帧结束。

```c
#define UART_DMA_BUF_SIZE 256
uint8_t uart_dma_buf[UART_DMA_BUF_SIZE];
volatile uint8_t  uart_frame_ready = 0;
volatile uint16_t uart_frame_len = 0;

void UART_DMA_IDLE_Init(void) {
    // 1. 使能 USART1 的空闲中断 (IDLE)
    __HAL_UART_ENABLE_IT(&huart1, UART_IT_IDLE);

    // 2. 启动 DMA 接收 (循环模式)
    HAL_UART_Receive_DMA(&huart1, uart_dma_buf, UART_DMA_BUF_SIZE);
}

// USART1 中断处理
void USART1_IRQHandler(void) {
    // 检查是否是 IDLE 中断
    if (__HAL_UART_GET_FLAG(&huart1, UART_FLAG_IDLE)) {
        __HAL_UART_CLEAR_IDLEFLAG(&huart1);

        // 停止 DMA (获取当前接收了多少数据)
        HAL_UART_DMAStop(&huart1);

        // 计算接收到的帧长度
        uint16_t remaining = __HAL_DMA_GET_COUNTER(huart1.hdmarx);
        uart_frame_len = UART_DMA_BUF_SIZE - remaining;
        uart_frame_ready = 1;

        // 重新启动 DMA 接收
        HAL_UART_Receive_DMA(&huart1, uart_dma_buf, UART_DMA_BUF_SIZE);
    }

    // 处理其他中断标志 (如 RXNE, TC 等)
    HAL_UART_IRQHandler(&huart1);
}

// 主循环中处理完整帧
void Main_Loop(void) {
    if (uart_frame_ready) {
        uart_frame_ready = 0;
        Process_Frame(uart_dma_buf, uart_frame_len);
        memset(uart_dma_buf, 0, UART_DMA_BUF_SIZE);
    }
}
```

---

## 5. RS-232 / RS-485 实战

### 5.1 RS-232 vs RS-485 对比

| 特性 | RS-232 | RS-485 |
|------|--------|--------|
| 信号方式 | 单端 (对地) | 差分 (A/B) |
| 最大距离 | ~15m | ~1200m |
| 节点数 | 1 对 1 | 最多 32/256 节点 |
| 抗干扰 | 弱 | 强 (差分) |
| 电平 | -15V ~ +15V (需要电平转换芯片) | 差分 1.5V-5V |
| 芯片 | MAX3232, SP3232 | MAX485, SP3485 |

### 5.2 RS-485 方向控制

```c
// RS-485 半双工: 需要控制 DE (Driver Enable) / RE (Receiver Enable) 引脚
// DE=1 → 发送模式, DE=0 → 接收模式

#define RS485_DE_PIN   GPIO_PIN_4
#define RS485_DE_PORT  GPIOA

void RS485_Set_TX(void) {
    RS485_DE_PORT->BSRR = RS485_DE_PIN;   // DE = 高 = 发送模式
}

void RS485_Set_RX(void) {
    RS485_DE_PORT->BSRR = RS485_DE_PIN << 16;  // DE = 低 = 接收模式
}

// 使用 DMA 发送完成中断自动切换回接收模式
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART2) {
        RS485_Set_RX();  // 发送完成, 切回接收
    }
}
```

---

## 6. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 乱码 (持续) | 波特率不匹配 | 双方确认波特率；用示波器测 TX 引脚的实际脉宽 |
| 2 | 乱码 (偶发) | 时钟源精度不够 (HSI) | UART 波特率 > 9600 时使用 HSE/PLL 作为时钟源 |
| 3 | RXNE 中断只触发一次 | 中断接收只用了一次 HAL_UART_Receive_IT | 必须在回调中重新调用 `HAL_UART_Receive_IT()` |
| 4 | ORE (Overrun Error) | 接收缓冲区满时新数据到来 | 使用 DMA + 环形缓冲区; 提高 UART RX ISR 优先级 |
| 5 | 多发/少发数据 | UART 发送缓冲区未被清空 | 发送前等待 `__HAL_UART_GET_FLAG(&huart, UART_FLAG_TC)` |
| 6 | IDLE 中断不触发 | 数据连续不断 (无空闲间隔) | 如果数据流不断，IDLE 确实不触发。改用 DMA 半满/全满中断 |
| 7 | RS-485 数据回环 (收到自己发的数据) | 收发同时进行，DE 未及时切换 | 发送期间关闭接收 (`HAL_UART_AbortReceive`)，发送完成后再打开 |

---

## 7. 参考文档

1. RM0090: STM32F4xx 参考手册 — USART 章节
2. ST AN3109: STM32 USART 波特率计算
3. ST AN3070: STM32 USART DMA 使用指南
4. TIA/EIA-485-A: RS-485 标准
