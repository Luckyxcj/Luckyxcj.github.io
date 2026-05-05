# Modbus 协议

> **文档说明**：本文档基于 Modbus 协议规范 (Modbus Organization)、FreeModbus 开源协议栈及工业通信实践经验整理。

---

## 目录

1. [Modbus 概述](#1-modbus-概述)
2. [Modbus RTU 详解](#2-modbus-rtu-详解)
3. [Modbus TCP 详解](#3-modbus-tcp-详解)
4. [STM32 上实现 Modbus](#4-stm32-上实现-modbus)
5. [常见问题与排查](#5-常见问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. Modbus 概述

Modbus 是工业自动化领域应用最广泛的串行通信协议之一，自 1979 年发布以来已部署在数以千万计的 PLC、传感器、执行器设备中。

```
Modbus 变体:

Modbus RTU (Remote Terminal Unit)
├─ 物理层: RS-485 / RS-232
├─ 编码: 二进制 (Compact)
├─ 帧间隔: ≥ 3.5 字符时间
└─ 应用最广 (PLC、仪表、变频器)

Modbus ASCII
├─ 物理层: RS-485 / RS-232
├─ 编码: ASCII (人类可读)
└─ 已很少使用

Modbus TCP
├─ 物理层: Ethernet
├─ 端口: 502
└─ 在 RTU 帧前面加 MBAP 头
```

### 1.1 Modbus 数据模型

| 数据类型 | 访问方式 | 地址范围 | 说明 |
|---------|---------|---------|------|
| Coil (线圈) | 读写 | 0x0000 - 0xFFFF | 开关量输出 (DO) |
| Discrete Input | 只读 | 0x0000 - 0xFFFF | 开关量输入 (DI) |
| Holding Register | 读写 | 0x0000 - 0xFFFF | 保持寄存器 (16-bit) |
| Input Register | 只读 | 0x0000 - 0xFFFF | 输入寄存器 (16-bit, AI) |

---

## 2. Modbus RTU 详解

### 2.1 RTU 帧结构

```
主机请求帧:
┌────────┬──────────┬──────────┬──────────┬───────┬───────┐
│ 地址    │ 功能码    │ 数据      │ CRC L    │ CRC H │
│ 1 byte  │ 1 byte   │ N bytes   │ 1 byte   │ 1 byte│
└────────┴──────────┴──────────┴──────────┴───────┴───────┘

从机响应帧:
┌────────┬──────────┬──────────┬──────────┬───────┬───────┐
│ 地址    │ 功能码    │ 数据      │ CRC L    │ CRC H │
│ 1 byte  │ 1 byte   │ N bytes   │ 1 byte   │ 1 byte│
└────────┴──────────┴──────────┴──────────┴───────┴───────┘

帧间隔: ≥ 3.5 字符时间 (用于隔开不同的帧)
  @ 9600 bps: 3.5 × 11 / 9600 ≈ 4ms
  @ 115200 bps: 3.5 × 11 / 115200 ≈ 0.33ms
```

### 2.2 常用功能码

| 功能码 | 名称 | 操作 |
|--------|------|------|
| 0x01 | Read Coils | 读线圈 1-2000 个 |
| 0x02 | Read Discrete Inputs | 读离散输入 |
| 0x03 | Read Holding Registers | **读保持寄存器 (最常用)** |
| 0x04 | Read Input Registers | 读输入寄存器 |
| 0x05 | Write Single Coil | 写单个线圈 |
| 0x06 | Write Single Register | 写单个寄存器 |
| 0x0F | Write Multiple Coils | 写多个线圈 |
| 0x10 | Write Multiple Registers | **写多个寄存器 (最常用)** |

### 2.3 CRC 计算

```c
// Modbus CRC16 标准实现 (查表法)
// 多项式: 0x8005 (反转: 0xA001)
static const uint16_t crc_table[256] = {
    0x0000, 0xC0C1, 0xC181, 0x0140, /* ... 完整 256 项 ... */
};

uint16_t Modbus_CRC16(uint8_t *data, uint16_t len) {
    uint16_t crc = 0xFFFF;
    while (len--) {
        crc = (crc >> 8) ^ crc_table[(crc ^ *data++) & 0xFF];
    }
    return crc;
}
// 注意: Modbus CRC 发送顺序是 LSB 先 (小端)
```

---

## 3. Modbus TCP 详解

```c
// Modbus TCP 帧格式 (与 RTU 的区别):
// 头部加了 MBAP (Modbus Application Protocol) 头，去掉了 CRC
//
// ┌──────┬──────┬──────┬──────┬──────┬──────┬──────────┬──────┐
// │事务ID │协议ID │长度   │单元ID │功能码 │数据   │
// │2bytes│2bytes│2bytes│1 byte│1 byte│N bytes│
// └──────┴──────┴──────┴──────┴──────┴──────┴──────────┴──────┘
```

---

## 4. STM32 上实现 Modbus

### 4.1 使用 FreeModbus 协议栈

```c
// 移植 FreeModbus 到 STM32F4 (精简版)
#include "mb.h"

// 1. 硬件初始化 (UART + RS-485 方向控制 + 定时器)
void Modbus_Hardware_Init(void) {
    MX_USART2_UART_Init();     // RS-485 接口
    MX_TIM7_Init();            // 3.5 字符时间定时器 (T3.5)
    RS485_Set_RX();            // 初始化为接收模式
}

// 2. 移植回调函数
eMBErrorCode eMBRegHoldingCB(UCHAR *pucRegBuffer, USHORT usAddress,
                              USHORT usNRegs, eMBRegisterMode eMode) {
    if (eMode == MB_REG_READ) {
        // 读取保持寄存器
        while (usNRegs > 0) {
            *pucRegBuffer++ = (holding_regs[usAddress] >> 8) & 0xFF;
            *pucRegBuffer++ = holding_regs[usAddress] & 0xFF;
            usAddress++;
            usNRegs--;
        }
    } else if (eMode == MB_REG_WRITE) {
        // 写入保持寄存器
        while (usNRegs > 0) {
            holding_regs[usAddress] = (*pucRegBuffer << 8) | *(pucRegBuffer + 1);
            pucRegBuffer += 2;
            usAddress++;
            usNRegs--;
        }
    }
    return MB_ENOERR;
}

// 3. 启动协议栈
void Modbus_Start(void) {
    eMBInit(MB_RTU, 0x01, "COM2", 115200, MB_PAR_NONE);  // 从站地址=1
    eMBEnable();
}

// 4. 协议栈轮询 (低优先级任务/主循环)
void Modbus_Poll_Task(void) {
    while (1) {
        eMBPoll();  // 协议栈处理
        vTaskDelay(10);
    }
}
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 主站收不到响应 | 地址错误或波特率不对 | 用 Modbus Poll 软件测试从站 |
| 2 | CRC 校验失败 | CRC 算法错误或字节序不对 | 对照标准 CRC 计算器验证 |
| 3 | RS-485 通信偶尔丢包 | 偏置电阻缺失，总线在空闲时电平不确定 | 加 1kΩ 上下拉偏置 (A→VCC, B→GND) |
| 4 | T3.5 帧间隔不准确 | 波特率变化时需动态调整定时器 | 使用硬件 UART IDLE 中断检测帧结束 |

---

## 6. 参考文档

1. Modbus Application Protocol Specification V1.1b3 — Modbus Organization
2. FreeModbus: https://github.com/cwalter-at/freemodbus
3. "Modbus RTU on STM32" — ST Community Wiki
