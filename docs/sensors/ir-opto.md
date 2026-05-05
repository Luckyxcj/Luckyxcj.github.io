# 红外与光电传感器 (TCRT5000 / VL53L0X)

> **文档说明**：本文档基于 Vishay/VL53L0X 数据手册及嵌入式光电传感器应用经验整理。

---

## 目录

1. [传感器类型对比](#1-传感器类型对比)
2. [TCRT5000 红外反射](#2-tcrt5000-红外反射)
3. [VL53L0X ToF 测距](#3-vl53l0x-tof-测距)
4. [AMS TCS34725 颜色传感器](#4-ams-tcs34725-颜色传感器)
5. [常见问题](#5-常见问题)

---

## 1. 传感器类型对比

| 传感器 | 类型 | 量程 | 精度 | 接口 | 适用场景 |
|--------|------|------|------|------|---------|
| TCRT5000 | 红外反射 | 1-25mm | 开关量 | GPIO/ADC | 循迹、卡检测 |
| VL53L0X | 激光 ToF | 30-2000mm | ±3% | I2C | 避障、测距 |
| VL6180X | 红外 ToF | 0-200mm | ±2% | I2C | 近距离精确测距 |
| TCS34725 | 颜色传感器 | ~10mm | RGB 16-bit | I2C | 颜色识别 |
| GP2Y0A21 | 红外三角测距 | 10-80cm | ±5% | ADC | 模拟量测距 |

---

## 2. TCRT5000 红外反射

TCRT5000 是红外反射式光电对管，内含红外发射 LED 和光敏三极管。

```
TCRT5000 原理:

  ┌──────────┐
  │  TCRT5000 │  红外 LED (940nm)
  │  ┌──┐ ┌──┐│
  │  │IR│ │PD││   发射 ──→  物体表面  ←── 反射
  │  └──┘ └──┘│
  └──────────┘

  反射强度 → 光敏三极管电流 → 电阻分压 → ADC 读取

  发射电路:              接收电路:
   3.3V                   3.3V
    │                      │
   [220Ω]                 [10kΩ]
    │                      │
    ├─ ANODE              ├─ COLLECTOR
   [LED]                 [PT]
    │                      │
   GPIO── CATHODE         EMITTER ── GND
```

```c
// TCRT5000 黑白循迹 (常用于小车)
#define TRACK_ADC_CHANNEL  ADC_CHANNEL_0

// 阈值判断 (黑线 = 低反射 = ADC 值小)
uint8_t Track_ReadLine(void) {
    uint16_t adc_value = ADC_Read(TRACK_ADC_CHANNEL);

    if (adc_value < 1500) return 0;  // 黑线 (需要实际标定阈值)
    else                  return 1;  // 白色/高反射
}

// ADC + 动态阈值 (适应环境光变化)
uint16_t Track_AutoThreshold(void) {
    uint32_t sum = 0;
    for (int i = 0; i < 100; i++) {
        sum += ADC_Read(TRACK_ADC_CHANNEL);
        HAL_Delay(1);
    }
    return sum / 100 * 0.7;  // 阈值 = 平均值的 70%
}
```

### 遮断式检测 (如编码器)

```
遮断式 (光耦): 发射器和接收器分列两侧

  [LED 发射] ──→  │ 遮挡物 │ ←── [光敏接收]

  有遮挡 → 接收端无光 → 输出高/低 (取决于电路)
```

---

## 3. VL53L0X ToF 测距

VL53L0X 是 ST 微电子的激光飞行时间 (ToF) 传感器，精度远优于红外方案。

```
ToF 原理:

  MCU ──I2C──→ VL53L0X ──940nm VCSEL──→ 目标
               │                          │
               ←────  光子返回  ──────────┘

  时间差 → 距离 = c × t / 2

  优点: 不受目标颜色/反射率影响
```

```c
// VL53L0X 驱动 (使用 ST 官方 API)
#include "vl53l0x_api.h"

VL53L0X_Dev_t vl53_dev;
VL53L0X_RangingMeasurementData_t range_data;

uint8_t VL53L0X_Init(void) {
    VL53L0X_Error status;

    // 1. 初始化设备结构体
    vl53_dev.I2cHandle = &hi2c1;
    vl53_dev.I2cDevAddr = 0x52;  // 默认 7 位地址 0x29 (写入 0x52)

    // 2. 等待传感器上电完成
    HAL_Delay(10);

    // 3. 初始化传感器
    status = VL53L0X_DataInit(&vl53_dev);
    if (status != VL53L0X_ERROR_NONE) return 1;

    // 4. 校准
    status = VL53L0X_StaticInit(&vl53_dev);
    if (status != VL53L0X_ERROR_NONE) return 2;

    // 5. 配置测距模式
    // 高精度: VL53L0X_PRESETMODE_HIGH_ACCURACY (33ms, 200mm@暗环境)
    // 长距离: VL53L0X_PRESETMODE_LONG_RANGE   (33ms, 高环境光表现好)
    // 高速:   VL53L0X_PRESETMODE_HIGH_SPEED   (20ms)
    status = VL53L0X_SetDeviceMode(&vl53_dev,
                                    VL53L0X_DEVICEMODE_CONTINUOUS_RANGING);
    if (status != VL53L0X_ERROR_NONE) return 3;

    // 6. 开始连续测距
    status = VL53L0X_StartMeasurement(&vl53_dev);
    if (status != VL53L0X_ERROR_NONE) return 4;

    return 0;
}

// 读取距离 (mm)
uint16_t VL53L0X_ReadDistance(void) {
    VL53L0X_GetRangingMeasurementData(&vl53_dev, &range_data);

    if (range_data.RangeStatus == 0) {  // 0 = 测量有效
        return range_data.RangeMilliMeter;
    }
    return 0xFFFF;  // 无效
}

// 配置测量预算 (Timing Budget)
// 越小越快(但精度低): 20000 (20ms) → 200000 (200ms)
VL53L0X_SetMeasurementTimingBudgetMicroSeconds(&vl53_dev, 33000);
```

::: warning VL53L0X 环境光限制
VL53L0X 在强光下 (过曝) 量程缩短。户外阳光下仅 50-80cm。如需户外使用，VL53L1X (量程 4m, 红外带通滤波) 更合适。
:::

---

## 4. AMS TCS34725 颜色传感器

```c
// TCS34725 I2C 颜色传感器 — 读取 RGB + 清除通道
#define TCS34725_ADDR  0x29

typedef struct {
    uint16_t clear, red, green, blue;
} TCS34725_Color_t;

void TCS34725_Init(void) {
    // 使能传感器 (ENABLE reg = 0x00)
    uint8_t cmd = 0x80 | 0x00;  // 自动递增 + 寄存器 0x00
    uint8_t buf[] = {cmd, 0x03};  // AEN + PON
    HAL_I2C_Master_Transmit(&hi2c1, TCS34725_ADDR << 1, buf, 2, 100);

    // 配置积分时间: 0x01 = ATIME (0xD5 = 50ms)
    uint8_t atime_buf[] = {0x81, 0xD5};
    HAL_I2C_Master_Transmit(&hi2c1, TCS34725_ADDR << 1, atime_buf, 2, 100);

    // 配置增益: 0x0F = Control (0x00 = 1x, 0x01 = 4x, 0x02 = 16x, 0x03 = 60x)
    uint8_t gain_buf[] = {0x8F, 0x00};
    HAL_I2C_Master_Transmit(&hi2c1, TCS34725_ADDR << 1, gain_buf, 2, 100);
}

void TCS34725_ReadColor(TCS34725_Color_t *c) {
    uint8_t buf[8];
    // 从 0x94 开始读 8 字节 (CLEAR_L, CLEAR_H, RED_L, RED_H, GREEN_L, GREEN_H, BLUE_L, BLUE_H)
    HAL_I2C_Mem_Read(&hi2c1, TCS34725_ADDR << 1, 0x94 | 0x80,
                     I2C_MEMADD_SIZE_8BIT, buf, 8, 100);

    c->clear = (buf[1] << 8) | buf[0];
    c->red   = (buf[3] << 8) | buf[2];
    c->green = (buf[5] << 8) | buf[4];
    c->blue  = (buf[7] << 8) | buf[6];
}

// 归一化为 RGB 0-255
void TCS34725_Normalize(TCS34725_Color_t *c, float *r, float *g, float *b) {
    float sum = c->red + c->green + c->blue;
    *r = 255.0f * c->red   / sum;
    *g = 255.0f * c->green / sum;
    *b = 255.0f * c->blue  / sum;
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | TCRT5000 对黑色/白色区分不明显 | LED 发射功率不足或接收电阻不匹配 | 调小 LED 限流电阻 (≤100Ω) 或调大接收上拉电阻 |
| 2 | TCRT5000 受环境光影响严重 | 可见光/日光含有红外成分 | 使用调制解调方案 (38kHz) 或遮光罩 |
| 3 | VL53L0X 测距偶尔返回 8191 | 传感器认为无效测量 | 检查 `RangeStatus` 字段 (0=有效) |
| 4 | VL53L0X 上电后 I2C 无应答 | XSHUT 引脚未拉高 | 将 XSHUT 接 VCC (或 GPIO 控制, 多个传感器共存) |
| 5 | 多个 VL53L0X 同时使用互相干扰 | 所有传感器同频发射 | 分时使能 (XSHUT 切换); 每个传感器单独校准 |
| 6 | TCS34725 RGB 值与肉眼不符 | LED 光源光谱不连续 | 在自然白光下校准; 使用色温校正矩阵 |

---

## 6. 参考文档

1. VL53L0X 数据手册: https://www.st.com/en/imaging-and-photonics-solutions/vl53l0x.html
2. VL53L0X API 用户手册: UM2039
3. TCRT5000 数据手册 (Vishay)
4. TCS34725 数据手册 (AMS/Osram)
5. "仅用 ToF 传感器制作避障小车" — ST Community Blog
