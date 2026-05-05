# I2C 总线

> **文档说明**：本文档基于 NXP I2C 总线规范 (UM10204)、STM32 I2C 参考手册及工程调试经验整理。

---

## 目录

1. [I2C 协议基础](#1-i2c-协议基础)
2. [STM32 I2C 配置](#2-stm32-i2c-配置)
3. [I2C 设备读写实战](#3-i2c-设备读写实战)
4. [常见问题](#4-常见问题)
5. [参考文档](#5-参考文档)

---

## 1. I2C 协议基础

### 1.1 总线拓扑

```
I2C 总线 (2 线制, 多主多从):

VDD ──┬── R_pullup ── SDA ──┬──────────┬──────────┬──────────
      │                     │          │          │
      ├── R_pullup ── SCL ──┤          │          │
      │                     │          │          │
      │                   ┌───┐      ┌───┐      ┌───┐
      │                   │MCU│      │EEP│      │SEN│
      │                   │   │      │ROM│      │SOR│
      │                   └───┘      └───┘      └───┘
     GND

上拉电阻: 标准模式 (100kHz) → 4.7kΩ
         快速模式 (400kHz) → 2.2kΩ
         快速+模式 (1MHz) → 1.0kΩ
```

### 1.2 时序图

```
I2C 写时序 (主机写 1 字节到从机):

SCL: ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐ ┌┐
     ││ ││ ││ ││ ││ ││ ││ ││ ││ ││ ││ ││
─────┘└─┘└─┘└─┘└─┘└─┘└─┘└─┘└─┘└─┘└─┘└─

SDA: ──┐    ┌─┬─┬─┬─┬─┬─┬─┬─┐    ┌───
       └────┘ │ │ │ │ │ │ │ │ └────┘
     START    地址+R/W  ACK  数据    STOP
              (7bit addr + 1bit R/W)
```

### 1.3 速度等级

| 模式 | 速度 | 上拉电阻 (典型) | 用途 |
|------|------|---------------|------|
| Standard | 100 kHz | 4.7kΩ | 传感器、EEPROM |
| Fast | 400 kHz | 2.2kΩ | 大多数外设 |
| Fast Plus | 1 MHz | 1.0kΩ | 高速传输 |

---

## 2. STM32 I2C 配置

### 2.1 典型的 I2C 初始化

```c
I2C_HandleTypeDef hi2c1;

void MX_I2C1_Init(void) {
    hi2c1.Instance = I2C1;
    hi2c1.Init.ClockSpeed = 400000;         // 400kHz Fast Mode
    hi2c1.Init.DutyCycle = I2C_DUTYCYCLE_2;
    hi2c1.Init.OwnAddress1 = 0x00;          // 主机模式: 地址不重要
    hi2c1.Init.AddressingMode = I2C_ADDRESSINGMODE_7BIT;
    hi2c1.Init.DualAddressMode = I2C_DUALADDRESS_DISABLE;
    hi2c1.Init.GeneralCallMode = I2C_GENERALCALL_DISABLE;
    hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
    HAL_I2C_Init(&hi2c1);
}
```

### 2.2 重要的 I2C 时序参数 (STM32F4/F7)

```c
// 对于 STM32F4 系列, I2C 时序由 CR2 (FREQ) + CCR + TRISE 三个寄存器决定
// 实际项目中通常用 CubeMX 自动计算

// 400kHz @ PCLK1=42MHz:
// CR2 FREQ = 42 (MHz)
// CCR = 0x0034 (52 → Standard mode) 或 0x8015 (21 → Fast mode)
// TRISE = 0x000D (13 → Fast mode)
```

---

## 3. I2C 设备读写实战

### 3.1 EEPROM (AT24C02) 读写

```c
// AT24C02: 2Kbit (256 × 8) EEPROM, 地址 0x50 (7-bit)

// 写入 1 字节
uint8_t EEPROM_WriteByte(uint8_t addr, uint8_t data) {
    uint8_t buf[2] = {addr, data};
    return HAL_I2C_Master_Transmit(&hi2c1, 0x50 << 1, buf, 2, 100);
}

// 读取 1 字节
uint8_t EEPROM_ReadByte(uint8_t addr) {
    uint8_t data;
    // 先写地址 (dummy write)
    HAL_I2C_Master_Transmit(&hi2c1, 0x50 << 1, &addr, 1, 100);
    // 再读数据
    HAL_I2C_Master_Receive(&hi2c1, 0x50 << 1, &data, 1, 100);
    return data;
}
```

### 3.2 I2C 写操作地址解释

```c
// 7-bit I2C 地址
// 例如 EEPROM 地址 0x50 (1010 000)
//
// HAL 库使用 8-bit 格式: 7-bit 地址 << 1
//   0x50 << 1 = 0xA0
//
// 注意区分:
//   7-bit 地址 (常规写法): 0x50
//   8-bit 写地址: 0xA0 (HAL 库用这个格式)
//   8-bit 读地址: 0xA1
```

---

## 4. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | `HAL_I2C_Master_Transmit` 返回 HAL_TIMEOUT | 从机不存在或地址错误 | 用 I2C 扫描器确认从机地址 |
| 2 | I2C BUSY 标志一直为 1 | 上次传输异常终止 | 软件复位 I2C 外设 (HAL_I2C_DeInit + 重新 Init) |
| 3 | 通信偶尔失败 | 上拉电阻太大或 SDA/SCL 总线过长 | 减小上拉电阻；缩短 PCB 走线 |
| 4 | 读到的数据全为 0xFF | 从机没响应 (NACK) | 检查从机供电和地址 |
| 5 | F1 系列的 I2C 通信不稳定 | F1 的 I2C 有硬件设计缺陷 | 使用 F1 的 I2C 要加超时保护；F4/G4 已修复 |

---

## 5. 参考文档

1. NXP UM10204: I2C-bus specification and user manual
2. RM0090: STM32F4xx — I2C 章节
3. ST AN2824: STM32F10xxx I2C 优化示例
4. 本知识库 [I2C 故障排查](./troubleshooting)
