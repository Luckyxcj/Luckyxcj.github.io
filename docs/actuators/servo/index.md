# 舵机控制

> **文档说明**：本文档基于 Futaba/Hitech 等舵机厂商规范及嵌入式舵机控制实践经验整理。

---

## 目录

1. [舵机基础](#1-舵机基础)
2. [PWM 控制实现](#2-pwm-控制实现)
3. [总线舵机 (LX-224 / DYNAMIXEL)](#3-总线舵机-lx-224--dynamixel)
4. [常见问题](#4-常见问题)

---

## 1. 舵机基础

舵机 (Servo) 是一种位置伺服驱动器，通过 PWM 信号精确控制输出轴角度。

```
舵机内部结构:

  PWM 输入 → ┌──────────┐
             │  控制电路  │
             │  (比较器)  │ ←→ 电位器 (角度反馈)
             └─────┬────┘
                   │
              ┌────┴────┐
              │  电机驱动 │ → 直流电机 → 减速齿轮组 → 输出轴
              └─────────┘
```

| 类型 | 角度范围 | 扭矩 | 反馈 | 价格 |
|------|---------|------|------|------|
| 标准舵机 (SG90) | 0-180° | 1.5 kg·cm | 无 | ~¥5 |
| 金属舵机 (MG996R) | 0-180° | 10 kg·cm | 无 | ~¥15 |
| 360° 舵机 | 连续旋转 | 3-5 kg·cm | 无 | ~¥10 |
| 总线舵机 (LX-224) | 0-240° | 20 kg·cm | 位置+电流+温度 | ~¥60 |
| DYNAMIXEL (XL430) | 0-360° | 1.4 N·m | 位置+速度+电流+温度 | ~¥200 |

---

## 2. PWM 控制实现

```
标准舵机 PWM 信号:

  20ms 周期 (50Hz)
  ┌──────────┬──────────────────────────────────┐
  │ 高电平   │           低电平                   │
  └──────────┘                                  └

  高电平宽度:
    0.5ms →  0° (最小角度)
    1.0ms → 45°
    1.5ms → 90° (中位)
    2.0ms → 135°
    2.5ms → 180° (最大角度)

  角度 = (脉宽 - 0.5) / 2.0 × 180  (度)
  脉宽 = 0.5 + 角度 / 180 × 2.0    (ms)
```

```c
// 使用 STM32 定时器 PWM 控制舵机
// 配置: TIM CH1 PWM, 50Hz (20ms), ARR = 20000-1 (72MHz/72预分频/50Hz = 20000)

#define SERVO_MIN_PULSE   500   // 0°   → 0.5ms (500μs)
#define SERVO_MAX_PULSE   2500  // 180° → 2.5ms (2500μs)
#define SERVO_TIM         (&htim3)
#define SERVO_CHANNEL     TIM_CHANNEL_1

void Servo_Init(void) {
    // 定时器配置: 50Hz, PWM 模式 1
    // PSC = 72-1 (1μs tick), ARR = 20000-1 (20ms 周期)
    HAL_TIM_PWM_Start(SERVO_TIM, SERVO_CHANNEL);
}

void Servo_SetAngle(float angle_deg) {
    // 限幅
    if (angle_deg < 0) angle_deg = 0;
    if (angle_deg > 180) angle_deg = 180;

    // 角度 → 脉宽 (μs)
    float pulse_us = 500.0f + (angle_deg / 180.0f) * 2000.0f;
    uint32_t compare = (uint32_t)pulse_us;  // 1 tick = 1μs

    __HAL_TIM_SET_COMPARE(SERVO_TIM, SERVO_CHANNEL, compare);
}

// 对 SG90 的三线连接: 棕(GND) 红(VCC) 橙(Signal)
// MCU 直接 GPIO 输出 PWM + 5V 供电 (SG90 需 5V, 启动电流 ~750mA)
```

### 多路舵机控制

```c
// 使用多路 PWM 输出 (TIM 多通道)
// 或用 PCA9685 16 路 PWM 驱动芯片 (I2C 控制)

#include "pca9685.h"

void PCA9685_SetAngle(uint8_t channel, float angle_deg) {
    // PCA9685 12-bit 分辨率, 50Hz (PRE_SCALE = 121)
    float pulse_us = 500.0f + (angle_deg / 180.0f) * 2000.0f;
    uint16_t on  = 0;
    uint16_t off = (uint16_t)(pulse_us / 20000.0f * 4096.0f);

    // I2C 写入: LEDn_ON_L/H, LEDn_OFF_L/H
    uint8_t buf[4] = {on & 0xFF, on >> 8, off & 0xFF, off >> 8};
    HAL_I2C_Mem_Write(&hi2c1, PCA9685_ADDR << 1,
                      0x06 + channel * 4,  // LED0_ON_L
                      I2C_MEMADD_SIZE_8BIT, buf, 4, 100);
}
```

---

## 3. 总线舵机 (LX-224 / DYNAMIXEL)

总线舵机通过串口进行数字控制，支持回读位置、电流、温度。

```
LX-224 协议帧 (UART 115200 8N1):

  [0x55 0x55] [ID] [LEN] [CMD] [PARAM...] [CHECKSUM]

  命令:
  CMD_SERVO_MOVE   0x01  控制角度 (0-1000, 对应 0-240°)
  CMD_GET_POSITION 0x02  读取当前位置
```

```c
// LX-224 总线舵机控制
#define LX224_BAUD  115200

void LX224_Move(uint8_t id, uint16_t position, uint16_t time_ms) {
    // position: 0-1000 (对应 0-240°)
    // time_ms: 运动时间
    uint8_t buf[10];
    uint8_t idx = 0;

    buf[idx++] = 0x55;  // 帧头
    buf[idx++] = 0x55;
    buf[idx++] = id;    // 舵机 ID
    buf[idx++] = 7;     // 数据长度
    buf[idx++] = 0x01;  // CMD_SERVO_MOVE
    buf[idx++] = position & 0xFF;
    buf[idx++] = (position >> 8) & 0xFF;
    buf[idx++] = time_ms & 0xFF;
    buf[idx++] = (time_ms >> 8) & 0xFF;

    // 校验和 (所有字节之和取反)
    uint8_t checksum = 0;
    for (uint8_t i = 2; i < idx; i++) checksum += buf[i];
    buf[idx++] = ~checksum;

    HAL_UART_Transmit(&huart_lx, buf, idx, 100);
}

// DYNAMIXEL 使用半双工 UART (TTL) 或 RS-485
// Protocol 2.0 更复杂, 建议使用 Robotis SDK
```

---

## 4. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 舵机不动或抖动 | 供电不足 (USB 5V 不够) | 独立电源 (>1A); 大电容 (470μF+) |
| 2 | 角度不准 (90° 变 80°) | PWM 频率偏差 | 用示波器校准; 使用外部晶振 |
| 3 | SG90 堵转冒烟 | 负载过大或角度超过机械限位 | 检查负载; 软件限制角度范围 |
| 4 | 多路舵机同时动时电压骤降 | 总电流超电源能力 | 逐路启动 (加 50ms 延迟); 更大功率电源 |
| 5 | 总线舵机无应答 | ID 错误或波特率不匹配 | 先用出厂默认 ID=1 测试; 扫描波特率 |
| 6 | 舵机回中时有声音 | 齿轮虚位 (回差) | 正常; 使用金属齿轮舵机 (MG996R) 虚位更小 |

---

## 5. 参考文档

1. SG90 微型舵机规格书 (Tower Pro)
2. PCA9685 数据手册 (NXP)
3. Hiwonder LX-224 总线舵机通讯协议
4. DYNAMIXEL Protocol 2.0: https://emanual.robotis.com/docs/en/dxl/protocol2/
5. "Introduction to Servo Motors" — Science Buddies
