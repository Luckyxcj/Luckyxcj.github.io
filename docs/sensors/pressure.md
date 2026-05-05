# 压力传感器 (MS5611 / BMP280 / HX711)

> **文档说明**：本文档基于 MS5611、BMP280、HX711 数据手册及嵌入式压力/称重传感器应用经验整理。

---

## 目录

1. [传感器对比](#1-传感器对比)
2. [MS5611 气压传感器](#2-ms5611-气压传感器)
3. [HX711 称重传感器](#3-hx711-称重传感器)
4. [常见问题](#4-常见问题)

---

## 1. 传感器对比

| 参数 | MS5611 | BMP280 | HX711 + 桥式传感器 |
|------|--------|--------|-------------------|
| 测量对象 | 气压、温度 | 气压、温度 | 重量/压力/拉力 |
| 压力范围 | 10~1200 mbar | 300~1100 hPa | 取决于传感器 (如 5kg/10kg/100kg) |
| 精度 | ±1.5 mbar | ±1 hPa | 24-bit ADC (噪声 ~50nV) |
| 接口 | I2C / SPI | I2C / SPI | 串行 (时钟+数据, 类似 I2C) |
| 电压 | 1.8~3.6V | 1.7~3.6V | 2.6~5.5V (HX711) |
| 采样率 | 最高 50 Hz | 最高 182 Hz | 10 Hz / 80 Hz 可选 |
| 适用场景 | 气象站、高度计、无人机 | 气象、高度 | 电子秤、拉力计、压力传感器 |

---

## 2. MS5611 气压传感器

MS5611 内置高精度 24-bit ΔΣ ADC + 工厂校准系数 (PROM)。

```
MS5611 命令序列:

  1. Reset (0x1E)
  2. 读取 PROM 校准数据 (0xA0~0xAE, 8 个 16-bit 值)
  3. 发起转换 (0x48 = D1/压力, 0x58 = D1/温度)
     OSR 4096 (最高精度): 0x48 / 0x58 (9ms)
     OSR 256  (最低精度): 0x40 / 0x50 (0.6ms)
  4. 读取 ADC 结果 (0x00, 返回 3 字节)
  5. 温度补偿 + 气压计算 (二阶补偿)
```

```c
// MS5611 I2C 驱动
#define MS5611_ADDR  0x77  // CSB 接 VCC (接 GND 时 0x76)

uint16_t prom[8];  // 校准系数

void MS5611_Reset(void) {
    uint8_t cmd = 0x1E;
    HAL_I2C_Master_Transmit(&hi2c1, MS5611_ADDR << 1, &cmd, 1, 100);
    HAL_Delay(10);  // 复位需要 2.8ms
}

void MS5611_ReadPROM(void) {
    for (uint8_t i = 0; i < 8; i++) {
        HAL_I2C_Mem_Read(&hi2c1, MS5611_ADDR << 1, 0xA0 + i * 2,
                         I2C_MEMADD_SIZE_8BIT, (uint8_t *)&prom[i], 2, 100);
        prom[i] = __REV16(prom[i]);  // 大端转小端
    }
}

uint32_t MS5611_ReadADC(uint8_t osr_cmd) {
    uint8_t buf[3];

    // 发起转换
    HAL_I2C_Master_Transmit(&hi2c1, MS5611_ADDR << 1, &osr_cmd, 1, 100);

    // 等待转换完成 (OSR 4096 = 9.04ms)
    HAL_Delay(10);

    // 读取结果
    HAL_I2C_Mem_Read(&hi2c1, MS5611_ADDR << 1, 0x00,
                     I2C_MEMADD_SIZE_8BIT, buf, 3, 100);

    return ((uint32_t)buf[0] << 16) | (buf[1] << 8) | buf[2];
}

// 温度补偿 (MS5611 数据手册精确公式)
void MS5611_Calculate(int32_t *pressure_pa, int32_t *temperature_c100,
                      uint32_t D1, uint32_t D2) {
    int32_t dT   = D2 - (int32_t)prom[5] * 256;
    int32_t TEMP = 2000 + (int64_t)dT * prom[6] / 8388608;

    int64_t OFF  = (int64_t)prom[2] * 65536
                 + (int64_t)prom[4] * dT / 128;
    int64_t SENS = (int64_t)prom[1] * 32768
                 + (int64_t)prom[3] * dT / 256;

    // 二阶温度补偿 (TEMP < 20°C)
    if (TEMP < 2000) {
        int32_t T2   = (int64_t)dT * dT / 2147483648;
        int64_t OFF2 = 5 * (TEMP - 2000) * (TEMP - 2000) / 2;
        int64_t SENS2 = 5 * (TEMP - 2000) * (TEMP - 2000) / 4;
        TEMP -= T2;
        OFF  -= OFF2;
        SENS -= SENS2;
    }

    int32_t P = (D1 * SENS / 2097152 - OFF) / 32768;
    *pressure_pa = P;        // 单位: Pascal (0.01 mbar)
    *temperature_c100 = TEMP; // 单位: 0.01°C
}
```

---

## 3. HX711 称重传感器

HX711 是一款 24-bit 高精度 ADC，专为桥式称重传感器设计。

```
HX711 信号连接:

  [称重传感器]     [HX711]       [MCU]
  (惠斯通电桥)      (ADC)
  ┌──────┐       ┌──────┐      ┌──────┐
  │ E+ ←─┼──AVDD │      │      │      │
  │ E- ←─┼──AGND │ PD_SCK┼─────→│ GPIO │
  │ S+ ──┼─→IN+  │ DOUT ┼─────←│ GPIO │
  │ S- ──┼─→IN-  │      │      │      │
  └──────┘       └──────┘      └──────┘
```

```c
// HX711 驱动程序
#define HX711_SCK_PIN   GPIO_PIN_1
#define HX711_SCK_PORT  GPIOA
#define HX711_DOUT_PIN  GPIO_PIN_2
#define HX711_DOUT_PORT GPIOA

#define HX711_SCK_H()  HAL_GPIO_WritePin(HX711_SCK_PORT, HX711_SCK_PIN, GPIO_PIN_SET)
#define HX711_SCK_L()  HAL_GPIO_WritePin(HX711_SCK_PORT, HX711_SCK_PIN, GPIO_PIN_RESET)
#define HX711_DOUT_R() HAL_GPIO_ReadPin(HX711_DOUT_PORT, HX711_DOUT_PIN)

// 读取 24-bit 原始值 (阻塞, 约 70μs)
int32_t HX711_Read(void) {
    uint32_t data = 0;

    // 等待 DOUT 变低 (数据就绪)
    uint32_t timeout = 100000;
    while (HX711_DOUT_R() && --timeout);
    if (timeout == 0) return 0x80000000;  // 超时

    // 读取 24 位 (MSB first)
    for (int i = 0; i < 24; i++) {
        HX711_SCK_H();
        data = (data << 1) | (HX711_DOUT_R() ? 1 : 0);
        // 最小 SCK 高电平 0.2μs, 不需要软件延时
        HX711_SCK_L();
    }

    // 第 25 个脉冲: 选择下一次的增益和通道
    // 0 → 增益 128, 通道 A
    HX711_SCK_H();
    HX711_SCK_L();

    // 处理符号位 (24-bit 有符号)
    if (data & 0x800000) {
        data |= 0xFF000000;  // 符号扩展到 32 位
    }

    return (int32_t)data;
}

// 获取去皮重量 (平均值, 提高精度)
int32_t HX711_GetTare(int samples) {
    int64_t sum = 0;
    for (int i = 0; i < samples; i++) {
        sum += HX711_Read();
    }
    return sum / samples;
}

// 获取当前重量 (已去皮)
int32_t HX711_GetWeight(int32_t tare, float scale) {
    int64_t sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += HX711_Read();
    }
    int32_t avg = sum / 5;
    return (int32_t)((avg - tare) / scale);
}

// 标定: 放已知重量砝码, 计算 scale = (raw - tare) / 已知重量
```

::: warning HX711 时序要点
- DOUT 高电平表示 ADC 忙 (未完成转换)
- SCK 频率不可 > 500kHz (推荐 ~200kHz, 即跳变间隔 ≥2.5μs)
- 读完 24 bit 后必须再发一个 SCK 脉冲设置增益, 否则下次输出错误
:::

---

## 4. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | MS5611 气压值异常 (如 0 或 1e6+) | CRC 校验失败或 PROM 损坏 | 读取后校验 PROM CRC4; 重新焊接/更换 |
| 2 | MS5611 高度计算误差大 (>10m) | 未做海平面气压修正 | 从当地气象站获取参考气压, 做差分修正 |
| 3 | HX711 读数漂移大 | 传感器或 ADC 未预热 | 上电预热 30 分钟; 加温度补偿 |
| 4 | HX711 读数一直 0 或满量程 | E+/E- 供电反接或 S+/S- 接反 | 万用表量传感器桥臂阻值; 确认红黑绿白线序 |
| 5 | HX711 50Hz 工频干扰 | 交流电源耦合 | 使用 80 SPS 采样率 (内部有 50/60Hz 抑制); 加屏蔽 |
| 6 | 称重读数不线性 | 传感器过载或疲劳 | 检查量程; 使用多点校准 (2点以上) |

---

## 5. 参考文档

1. MS5611-01BA03 数据手册: https://www.te.com/commerce/DocumentDelivery/DDEController?Action=showdoc&DocId=Data+Sheet
2. BMP280 数据手册: https://www.bosch-sensortec.com/products/environmental-sensors/pressure-sensors/bmp280/
3. HX711 数据手册 (Avia Semiconductor)
4. "称重传感器原理与应用" — 惠斯通电桥 + 应变片基础
5. 国际标准大气 (ISA) 模型: 高度→气压转换公式
