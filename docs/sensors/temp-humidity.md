# 温湿度传感器 (DHT22 / SHT30 / BME280)

> **文档说明**：本文档基于 DHT22、SHT30、BME280 数据手册及嵌入式传感器驱动开发经验整理。

---

## 目录

1. [传感器对比](#1-传感器对比)
2. [DHT22 单总线驱动](#2-dht22-单总线驱动)
3. [SHT30 I2C 驱动](#3-sht30-i2c-驱动)
4. [BME280 环境传感器](#4-bme280-环境传感器)
5. [常见问题](#5-常见问题)

---

## 1. 传感器对比

| 参数 | DHT22 | SHT30 | BME280 |
|------|-------|-------|--------|
| 接口 | 单总线 (自定义协议) | I2C | I2C / SPI |
| 温度范围 | -40~80°C | -40~125°C | -40~85°C |
| 温度精度 | ±0.5°C | ±0.3°C | ±0.5°C |
| 湿度范围 | 0~100% RH | 0~100% RH | 0~100% RH |
| 湿度精度 | ±2% RH | ±2% RH | ±3% RH |
| 气压 | 无 | 无 | 300~1100 hPa (±1 hPa) |
| 采样率 | 0.5 Hz (最慢) | 最高 10 Hz | 最高 182 Hz |
| 价格 | ~¥5 | ~¥8 | ~¥15 |
| 适用场景 | 简单温湿度采集 | 工业级温湿度 | 气象站/高度计 |

---

## 2. DHT22 单总线驱动

DHT22 使用单总线 (One-Wire) 协议，通过一根数据线完成通信。

```
DHT22 时序:

  MCU 发送起始信号:           DHT22 响应 + 40bit 数据:
  ────┐     ┌───────────    ───┐  ┌─┐ ┌─┐ ┌───      ┌─┐ ┌───
      │     │                   │  │ │ │ │ │  │  ... │ │ │
      └─────┘ (>1ms 低)        └──┘ └─┘ └─┘ └──      └─┘ └──
                                响应   40 bit (5 bytes)
  拉低 1ms → 拉高 30μs →  80μs 低 + 80μs 高 (响应)
                          50μs 低 + 26μs 高 = 0
                          50μs 低 + 70μs 高 = 1
```

```c
// DHT22 单总线驱动 (基于 STM32 定时器输入捕获精确计时)
#include "dht22.h"

#define DHT22_PORT  GPIOA
#define DHT22_PIN   GPIO_PIN_0

// 微秒级延时 (使用 DWT 或 TIM 实现)
static void DWT_Delay_us(uint32_t us) {
    uint32_t start = DWT->CYCCNT;
    uint32_t ticks = us * (SystemCoreClock / 1000000);
    while ((DWT->CYCCNT - start) < ticks);
}

static void DHT22_SetOutput(void) {
    GPIO_InitTypeDef gpio = {0};
    gpio.Mode = GPIO_MODE_OUTPUT_OD;  // 开漏输出 (需要外部 4.7kΩ 上拉)
    gpio.Pin = DHT22_PIN;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(DHT22_PORT, &gpio);
}

static void DHT22_SetInput(void) {
    GPIO_InitTypeDef gpio = {0};
    gpio.Mode = GPIO_MODE_INPUT;
    gpio.Pin = DHT22_PIN;
    HAL_GPIO_Init(DHT22_PORT, &gpio);
}

// 等待 DHT22 响应 (超时返回 0)
static uint8_t DHT22_Wait(uint8_t level, uint32_t timeout_us) {
    uint32_t count = 0;
    while (HAL_GPIO_ReadPin(DHT22_PORT, DHT22_PIN) == level) {
        if (++count > timeout_us) return 0;
        DWT_Delay_us(1);
    }
    return 1;
}

uint8_t DHT22_Read(float *temperature, float *humidity) {
    uint8_t data[5] = {0};

    // 1. 发送起始信号: 拉低 1ms → 拉高 30μs
    DHT22_SetOutput();
    HAL_GPIO_WritePin(DHT22_PORT, DHT22_PIN, GPIO_PIN_RESET);
    HAL_Delay(1);
    HAL_GPIO_WritePin(DHT22_PORT, DHT22_PIN, GPIO_PIN_SET);
    DWT_Delay_us(30);

    // 2. 切换到输入, 等待 DHT22 响应
    DHT22_SetInput();
    if (!DHT22_Wait(GPIO_PIN_RESET, 100)) return 1;  // 等待响应低电平
    if (!DHT22_Wait(GPIO_PIN_SET, 100))  return 2;  // 等待响应高电平

    // 3. 读取 40 位数据
    for (int i = 0; i < 5; i++) {
        for (int j = 0; j < 8; j++) {
            if (!DHT22_Wait(GPIO_PIN_RESET, 100)) return 3;
            DWT_Delay_us(40);  // 跳过 50μs 低电平, 在 40μs 处采样
            if (HAL_GPIO_ReadPin(DHT22_PORT, DHT22_PIN)) {
                data[i] |= (1 << (7 - j));
                if (!DHT22_Wait(GPIO_PIN_SET, 100)) return 4;
            }
        }
    }

    // 4. 校验 (前 4 字节之和 = 第 5 字节)
    if (((data[0] + data[1] + data[2] + data[3]) & 0xFF) != data[4]) {
        return 5;
    }

    // 5. 解析数据
    uint16_t hum_raw = (data[0] << 8) | data[1];
    int16_t  temp_raw = (data[2] << 8) | data[3];
    if (temp_raw & 0x8000) temp_raw = -(temp_raw & 0x7FFF);  // 负温度

    *humidity    = hum_raw * 0.1f;
    *temperature = temp_raw * 0.1f;

    return 0;  // 成功
}
```

::: warning DHT22 读取时序关键
读取过程中**必须关中断**（或至少关 SysTick），否则 1μs 级别的时序误差将导致读取失败。每次读取间隔 > 2 秒（DHT22 内部采样周期限制）。
:::

---

## 3. SHT30 I2C 驱动

```c
// SHT30 I2C 驱动 (比 DHT22 可靠得多, 推荐工业应用)
#define SHT30_ADDR  0x44  // ADDR 引脚接 GND (接 VCC 时 0x45)

typedef enum {
    SHT30_REPEAT_HIGH   = 0x2400,  // 高重复性
    SHT30_REPEAT_MEDIUM = 0x240B,  // 中重复性
    SHT30_REPEAT_LOW    = 0x2416,  // 低重复性 (最快)
} SHT30_Repeat_t;

uint8_t SHT30_Read(float *temp, float *humi, SHT30_Repeat_t repeat) {
    uint8_t buf[6];

    // 发送测量指令
    uint8_t cmd[2] = {(repeat >> 8) & 0xFF, repeat & 0xFF};
    HAL_I2C_Master_Transmit(&hi2c1, SHT30_ADDR << 1, cmd, 2, 100);

    // 等待测量完成 (高重复性最大 15ms)
    HAL_Delay(15);

    // 读取 6 字节 (温度高+低+CRC + 湿度高+低+CRC)
    if (HAL_I2C_Master_Receive(&hi2c1, SHT30_ADDR << 1, buf, 6, 100) != HAL_OK) {
        return 1;
    }

    // CRC8 校验 (多项式 0x31, 初始值 0xFF)
    // ... 校验 buf[0..1] vs buf[2], buf[3..4] vs buf[5] ...

    uint16_t temp_raw = (buf[0] << 8) | buf[1];
    uint16_t humi_raw = (buf[3] << 8) | buf[4];

    *temp = -45.0f + 175.0f * temp_raw / 65535.0f;
    *humi = 100.0f * humi_raw / 65535.0f;

    return 0;
}
```

---

## 4. BME280 环境传感器

```c
// BME280: 温度 + 湿度 + 气压 (支持 I2C + SPI)
#define BME280_ADDR  0x76  // SDO=GND (接 VCC 时 0x77)

// BME280 补偿系数 (从 NVM 加载, 初始化时读取一次)
typedef struct {
    uint16_t dig_T1; int16_t dig_T2, dig_T3;
    uint16_t dig_P1; int16_t dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
    uint8_t  dig_H1, dig_H3; int16_t dig_H2, dig_H4, dig_H5; int8_t dig_H6;
} BME280_Calib_t;

// 温度补偿 (基于 BME280 数据手册公式, 使用 int32_t 避免浮点)
int32_t BME280_CompensateTemp(int32_t adc_T, BME280_Calib_t *calib) {
    int32_t var1, var2;
    var1 = ((((adc_T >> 3) - ((int32_t)calib->dig_T1 << 1)))
            * ((int32_t)calib->dig_T2)) >> 11;
    var2 = (((((adc_T >> 4) - ((int32_t)calib->dig_T1))
              * ((adc_T >> 4) - ((int32_t)calib->dig_T1))) >> 12)
            * ((int32_t)calib->dig_T3)) >> 14;
    return var1 + var2;  // 返回 t_fine (用于后续气压/湿度补偿)
}

void BME280_Init(void) {
    // 读取校准数据 (0x88-0xA1 + 0xE1-0xE7, 共 41 字节)
    uint8_t calib_buf[41];
    HAL_I2C_Mem_Read(&hi2c1, BME280_ADDR << 1, 0x88,
                     I2C_MEMADD_SIZE_8BIT, calib_buf, 26, 100);
    // ... 解析补偿系数 ...

    // 配置传感器: 温度/气压 x1 过采样, 湿度 x1, 普通模式
    uint8_t config[] = {
        0xF2, 0x01,  // ctrl_hum: x1 oversampling
        0xF4, 0x27,  // ctrl_meas: T/P x1, normal mode
        0xF5, 0x00,  // config: standby 0.5ms, filter off
    };
    HAL_I2C_Master_Transmit(&hi2c1, BME280_ADDR << 1, config, 6, 100);
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | DHT22 读取全 0 | 起始信号时序不对 | 用逻辑分析仪确认 1ms 低电平 + 30μs 高电平 |
| 2 | DHT22 偶发校验失败 | 读取期间被中断打断 | 读取 40bit 时关中断 |
| 3 | SHT30 读到 0xFFFF | 传感器未完成测量 | 增加延时确保测量完成 |
| 4 | BME280 温度偏高 2-3°C | PCB 自发热或传感器自发热 | 降低采样率；使用 force mode (单次测量) |
| 5 | 湿度读数 100% 不变化 | 传感器结露 | 加热恢复 (SHT30 有内部加热器); 避免高湿环境 |
| 6 | SHT30 长时间漂移 | 化学污染 (PCB 助焊剂、胶水挥发) | PCB 清洗 + 三防漆密封除传感器外区域 |

---

## 6. 参考文档

1. DHT22 数据手册: https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf
2. SHT30 数据手册: https://sensirion.com/products/catalog/SHT30-DIS/
3. BME280 数据手册: https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/
4. BME280 补偿公式应用笔记: BST-BME280-DS002
5. Sensirion 湿度传感器应用指南 (PCB 设计、焊接、存储建议)
