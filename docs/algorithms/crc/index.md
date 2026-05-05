# CRC 与纠错码

> **文档说明**：本文档基于 CRC 算法标准 (ITU-T V.42, IEEE 802.3)、嵌入式通信协议开发经验整理。

---

## 目录

1. [CRC 基础](#1-crc-基础)
2. [查表法实现](#2-查表法实现)
3. [模 2 除法详解](#3-模-2-除法详解)
4. [汉明码与 BCH 编码简介](#4-汉明码与-bch-编码简介)
5. [常见问题](#5-常见问题)

---

## 1. CRC 基础

CRC (Cyclic Redundancy Check) 是一种基于多项式除法的错误检测码。发送方计算校验值附加到数据末尾，接收方重新计算并比对。

```
CRC 工作原理:

  数据 M(x) → ┌──────────┐ → 余数 R(x) → 附加到数据后 (M+R)
  G(x)多项式 →│ mod 2 除法 │
              └──────────┘

  接收方: 收到 (M+R) → 用 G(x) 除 → 余数=0 → 数据完整
                                    → 余数≠0 → 数据错误
```

| CRC 类型 | 多项式 | 宽度 | 典型应用 |
|---------|--------|------|---------|
| CRC-8 | x⁸ + x² + x + 1 (0x07) | 8 | SMBus, 1-Wire |
| CRC-8/MAXIM | x⁸ + x⁵ + x⁴ + 1 (0x31) | 8 | DS18B20, DHT22, SHT30 |
| CRC-16/CCITT | x¹⁶ + x¹² + x⁵ + 1 (0x1021) | 16 | XMODEM, Bluetooth |
| CRC-16/Modbus | x¹⁶ + x¹⁵ + x² + 1 (0x8005) | 16 | Modbus RTU |
| CRC-32 | x³² + x²⁶ + x²³ + x²² + x¹⁶ + x¹² + x¹¹ + x¹⁰ + x⁸ + x⁷ + x⁵ + x⁴ + x² + x + 1 (0x04C11DB7) | 32 | Ethernet, ZIP, PNG |

### 关键参数

| 参数 | 说明 |
|------|------|
| 多项式 (Poly) | 生成多项式 G(x) |
| 初始值 (Init) | CRC 寄存器初始值 (常用 0xFFFF 或 0x0000) |
| 输入反转 (RefIn) | 每个字节是否按位反转 (LSB first) |
| 输出反转 (RefOut) | CRC 结果是否按位反转 |
| 异或输出 (XorOut) | 结果与 XorOut 异或 |

```
常见 CRC 配置速查:

  CRC-16/Modbus:  Poly=0x8005, Init=0xFFFF, RefIn=true,  RefOut=true,  XorOut=0x0000
  CRC-16/CCITT:   Poly=0x1021, Init=0x0000, RefIn=false, RefOut=false, XorOut=0x0000
  CRC-32/MPEG-2:  Poly=0x04C11DB7, Init=0xFFFFFFFF, RefIn=false, RefOut=false, XorOut=0x00000000
  CRC-32 (Ethernet): Poly=0x04C11DB7, Init=0xFFFFFFFF, RefIn=true, RefOut=true, XorOut=0xFFFFFFFF
```

---

## 2. 查表法实现

```c
// ===== CRC-16/Modbus (最常用的嵌入式 CRC) =====
// 参数: Poly=0x8005, Init=0xFFFF, RefIn=true, RefOut=true

// 生成 CRC16 查找表 (程序启动时调用一次, 或预编译为 const)
static uint16_t crc16_table[256];
static uint8_t  crc16_table_ready = 0;

void CRC16_Modbus_InitTable(void) {
    for (uint16_t i = 0; i < 256; i++) {
        uint16_t crc = i;
        for (int j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;  // 0x8005 的反射值
            } else {
                crc = crc >> 1;
            }
        }
        crc16_table[i] = crc;
    }
    crc16_table_ready = 1;
}

uint16_t CRC16_Modbus_Compute(const uint8_t *data, uint32_t len) {
    if (!crc16_table_ready) CRC16_Modbus_InitTable();

    uint16_t crc = 0xFFFF;
    while (len--) {
        uint8_t idx = (crc ^ *data++) & 0xFF;
        crc = (crc >> 8) ^ crc16_table[idx];
    }
    return crc;
}

// 使用示例:
// uint8_t frame[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01};
// uint16_t crc = CRC16_Modbus_Compute(frame, 6);
// frame[6] = crc & 0xFF;    // 低字节在前 (Modbus 惯例)
// frame[7] = crc >> 8;
```

```c
// ===== CRC-8/MAXIM (用于 DS18B20, DHT22, SHT30 等传感器) =====
// 参数: Poly=0x31 (x⁸+x⁵+x⁴+1), Init=0xFF, RefIn=true, RefOut=true

static const uint8_t crc8_table[256] = {
    0x00,0x5E,0xBC,0xE2,0x61,0x3F,0xDD,0x83,0xC2,0x9C,0x7E,0x20,
    // ... 完整 256 字节表 (可在编译前用 Python 预生成)
};

uint8_t CRC8_MAXIM_Compute(const uint8_t *data, uint32_t len) {
    uint8_t crc = 0xFF;
    while (len--) {
        crc = crc8_table[crc ^ *data++];
    }
    return crc;
}

// 预生成 CRC8 表的 Python 代码:
// def crc8_table():
//     table = []
//     for i in range(256):
//         crc = i
//         for _ in range(8):
//             if crc & 0x80:
//                 crc = ((crc << 1) ^ 0x31) & 0xFF
//             else:
//                 crc = (crc << 1) & 0xFF
//         table.append(crc)
//     return table
```

```c
// ===== CRC-32 (Ethernet) =====
// 用于固件完整性校验 (stm32 crc 外设可用硬件加速)

uint32_t CRC32_Compute(const uint8_t *data, uint32_t len) {
    uint32_t crc = 0xFFFFFFFF;

    while (len--) {
        crc ^= *data++;
        for (int j = 0; j < 8; j++) {
            if (crc & 1)
                crc = (crc >> 1) ^ 0xEDB88320;  // 反射多项式
            else
                crc = crc >> 1;
        }
    }
    return crc ^ 0xFFFFFFFF;
}

// STM32 硬件 CRC (STM32F4 及以上有 CRC 外设):
uint32_t STM32_HW_CRC32(const uint32_t *data, uint32_t word_count) {
    __HAL_RCC_CRC_CLK_ENABLE();
    CRC->CR |= CRC_CR_RESET;  // 复位 CRC 模块
    for (uint32_t i = 0; i < word_count; i++) {
        CRC->DR = data[i];  // 32-bit 写入, 硬件自动计算
    }
    return CRC->DR;
}
// 注意: STM32 硬件 CRC 使用多项式 0x04C11DB7 (与 Ethernet CRC 相同),
//       但输入/输出不反转 (MPEG-2 variant), 使用时需要软件反转换
```

---

## 3. 模 2 除法详解

对于不使用查表法的场景（如 RAM 极度受限），可以用位移寄存器逐位计算。

```
CRC-4 (Poly=x⁴+x+1=0x3=10011b) 计算示例:
  数据: 0x9 = 1001b
  被除数: 1001 0000 (数据 + 4 位 0, 即左移 4 位)

  模 2 除法 (无进位减法 = XOR):

        110
  10011)10010000
        10011
        ─────
          01010
          00000
          ─────
           10100
           10011
           ─────
            0111 ← 余数 = CRC

  最终: 0x9 的 CRC-4 = 0111b = 0x7
```

---

## 4. 汉明码与 BCH 编码简介

CRC 只能**检错**，不能**纠错**。以下编码可纠错：

### 4.1 汉明码 (Hamming Code)

```
汉明(7,4): 4 位数据 → 7 位码字 (可纠 1 位错)
检验矩阵 H 可定位错误位置

实际应用: 较少直接使用, 常用于 ECC 存储 (如 NAND Flash 汉明 ECC)
```

### 4.2 BCH / RS 编码

```
BCH (Bose-Chaudhuri-Hocquenghem): 可纠多位错误
RS (Reed-Solomon): BCH 的特例, 使用非二进制符号

应用: QR 码 (RS), NAND Flash ECC (BCH), CD/DVD (交叉 RS 编码)
```

::: tip 嵌入式选择指南
- **通信协议 (<1KB 数据帧)** → CRC-8/16 足够
- **固件完整性 (>1MB)** → CRC-32
- **NAND Flash** → BCH 4/8-bit ECC (硬件 ECC 更常见)
- **无线/高误码** → FEC (卷积码, Turbo 码, LDPC)
:::

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | CRC 计算值与标准工具不匹配 | 参数 (Init/RefIn/RefOut/XorOut) 不匹配 | 使用在线工具 (如 sunshowers/crc) 验证 CRC 参数组合 |
| 2 | Modbus CRC 高低字节反了 | Modbus 约定 CRC 低字节在前 | 显式交换: `data[pos] = crc & 0xFF; data[pos+1] = crc >> 8` |
| 3 | CRC 查表法结果全 0 | 查表初始化未执行 | 构建时生成 const 表 (推荐) 或运行时 init |
| 4 | 大数据量 CRC 计算太慢 (1MB+) | 逐字节查表慢 | 用逐字 (32-bit) 查表; 或用 STM32 硬件 CRC |
| 5 | STM32 硬件 CRC 与软件 CRC 不一致 | 硬件 CRC 不反转输入输出 | 软件端做位反转转换 |
| 6 | CRC 正确但数据有误 | CRC 碰撞 (H₀·D₁=H₀·D₂) | 改用更长 CRC (8→16→32); 或 CRC+校验和双重验证 |

---

## 6. 参考文档

1. "A Painless Guide to CRC Error Detection Algorithms" — Ross N. Williams: http://www.ross.net/crc/
2. CRC 在线计算器: https://crccalc.com/
3. "Hamming, BCH, and Reed-Solomon Codes" — ECC 入门
4. STM32 CRC 外设应用笔记: AN4187
5. Modbus 协议规范: https://modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf
