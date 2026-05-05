# SPI 串行外设接口

> **文档说明**：本文档基于 STM32 参考手册 SPI 章节及项目实践经验整理。

---

## 目录

1. [SPI 协议基础](#1-spi-协议基础)
2. [四种工作模式](#2-四种工作模式)
3. [STM32 SPI 配置](#3-stm32-spi-配置)
4. [SPI Flash 实战](#4-spi-flash-实战)
5. [常见问题与排查](#5-常见问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. SPI 协议基础

### 1.1 信号线

```
SPI 主从连接 (4 线制):

  主机 (Master)                  从机 (Slave)
  ┌──────────┐                  ┌──────────┐
  │ SCK  ─────────────────────→ │ SCK      │
  │ MOSI ─────────────────────→ │ MOSI     │
  │ MISO ←───────────────────── │ MISO     │
  │ CS/NSS ────────────────────→│ CS/SS    │
  └──────────┘                  └──────────┘

SCK:  时钟 (由主机提供)
MOSI: 主机发-从机收 (Master Out Slave In)
MISO: 主机收-从机发 (Master In Slave Out)
CS:   片选 (Chip Select), 低有效
```

### 1.2 全双工 vs 半双工

SPI 是全双工协议：主机在发送数据的同时也会收到数据。这个特性可以用于连续的读写操作。

---

## 2. 四种工作模式

SPI 有 4 种模式，由 CPOL (时钟极性) 和 CPHA (时钟相位) 决定：

| 模式 | CPOL | CPHA | 空闲时 SCK | 数据采样边沿 | 数据变化边沿 |
|------|------|------|-----------|------------|------------|
| 0 | 0 | 0 | 低 | 第 1 个上升沿 | 第 1 个下降沿 |
| 1 | 0 | 1 | 低 | 第 2 个下降沿 | 第 1 个上升沿 |
| 2 | 1 | 0 | 高 | 第 1 个下降沿 | 第 1 个上升沿 |
| 3 | 1 | 1 | 高 | 第 2 个上升沿 | 第 1 个下降沿 |

```
CPOL=0 (空闲低):

SCK: _____┌─┐__┌─┐__┌─┐__┌─┐__┌─┐__┌─┐__┌─┐__┌─┐______
    空闲   └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘
          ↑ 取 ↑ 取 ↑ 取 ↑ 取              ← CPHA=0 (上升沿采样)
          └取─┘  └取─┘  └取─┘  └取─┘        ← CPHA=1 (下降沿采样)

CPOL=1 (空闲高):

SCK: ─────┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐
    空闲    └──┘  └──┘  └──┘  └──┘
           ↓取  ↓取  ↓取  ↓取              ← CPHA=0 (下降沿采样)
           └取──┘  └取──┘  └取──┘  └取──┘   ← CPHA=1 (上升沿采样)
```

::: tip 模式选择
- 模式 0 (CPOL=0, CPHA=0) 是最常见的，大多数 SPI 设备默认此模式
- **不要猜**：查看从设备数据手册的 SPI Timing Diagram
- 如果通信数据全错，且有 1-bit 偏移 → 大概率模式选错
:::

---

## 3. STM32 SPI 配置

### 3.1 SPI 初始化

```c
SPI_HandleTypeDef hspi1;

void MX_SPI1_Init(void) {
    hspi1.Instance = SPI1;
    hspi1.Init.Mode = SPI_MODE_MASTER;
    hspi1.Init.Direction = SPI_DIRECTION_2LINES;
    hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
    hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;        // CPOL=0
    hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;             // CPHA=0
    hspi1.Init.NSS = SPI_NSS_SOFT;                     // 软件控制 CS
    hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_8;
    // SCK = PCLK/8 = 84/8 = 10.5 MHz
    hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
    hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
    hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
    HAL_SPI_Init(&hspi1);
}
```

### 3.2 SPI 读写

```c
// 单字节收发
uint8_t SPI_Transfer(uint8_t tx_data) {
    uint8_t rx_data;
    HAL_SPI_TransmitReceive(&hspi1, &tx_data, &rx_data, 1, 100);
    return rx_data;
}

// 多字节发送
void SPI_Write(uint8_t *data, uint16_t len) {
    HAL_GPIO_WritePin(SPI_CS_PORT, SPI_CS_PIN, GPIO_PIN_RESET);  // CS=0
    HAL_SPI_Transmit(&hspi1, data, len, 100);
    HAL_GPIO_WritePin(SPI_CS_PORT, SPI_CS_PIN, GPIO_PIN_SET);    // CS=1
}
```

---

## 4. SPI Flash 实战

```c
// W25Q64 (8MB SPI Flash) 读取 JEDEC ID
// 命令: 0x9F → 返回 3 字节 (Manufacturer + Memory Type + Capacity)

#define FLASH_CMD_JEDEC_ID  0x9F
#define FLASH_CS_LOW()      HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET)
#define FLASH_CS_HIGH()     HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET)

uint32_t Flash_Read_ID(void) {
    uint8_t cmd = FLASH_CMD_JEDEC_ID;
    uint8_t id[3] = {0};

    FLASH_CS_LOW();
    HAL_SPI_Transmit(&hspi1, &cmd, 1, 100);        // 发送命令
    HAL_SPI_Receive(&hspi1, id, 3, 100);            // 读取 3 字节 ID
    FLASH_CS_HIGH();

    return (id[0] << 16) | (id[1] << 8) | id[2];  // 例如: 0xEF4017 (W25Q64)
}
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 读到的数据全是 0x00 或 0xFF | MISO 引脚没连接或 AF 配置错 | 检查 MISO 引脚连接和 CubeMX 配置 |
| 2 | 数据位偏移 (如 0x55 变成 0xAA) | CPOL/CPHA 模式错 | 用逻辑分析仪验证: 看 SCK 边沿和 MOSI 数据的关系 |
| 3 | SCK 上没有时钟信号 | SPI 未使能, 或 NSS 硬件管理导致 | 尝试软件 NSS 模式 (SPI_NSS_SOFT) |
| 4 | SPI Flash 读取超时 | 片选 (CS) 电平状态不对 | 逻辑分析仪确认: CS 在传输期间保持低，传输后恢复高 |
| 5 | 高速通信不稳定 (>20MHz) | PCB 走线阻抗不匹配，振铃 | 缩短走线；加串联终端电阻 (22-33Ω) |

---

## 6. 参考文档

1. RM0090: STM32F4xx 参考手册 — SPI 章节
2. W25Q64JV 数据手册 (Winbond)
3. ST AN4678: SPI 协议在 STM32 上的实现
