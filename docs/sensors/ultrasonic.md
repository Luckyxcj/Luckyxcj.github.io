# 超声波传感器 (HC-SR04 / JSN-SR04T)

> **文档说明**：本文档基于 HC-SR04、JSN-SR04T 模组数据手册及嵌入式测距应用开发经验整理。

---

## 目录

1. [超声波测距原理](#1-超声波测距原理)
2. [HC-SR04 驱动](#2-hc-sr04-驱动)
3. [JSN-SR04T 防水型驱动](#3-jsn-sr04t-防水型驱动)
4. [多传感器阵列](#4-多传感器阵列)
5. [常见问题](#5-常见问题)

---

## 1. 超声波测距原理

超声波模块发射 40 kHz 声波脉冲，遇到障碍物反射回波，通过测量往返时间计算距离。

```
  发射脉冲 (8 个 40kHz 周期)
      │
      ▼
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │   │   │   │   │   │   │   │   │
  ┘   └───┴───┴───┴───┴───┴───┴───┴─────── 时间

                  ┌──┐
  接收回波        │  │ (幅度衰减)
                  └──┘────────────── 时间

  公式: 距离 = (声速 × 回波高电平时间) / 2
        声速 ≈ 331.3 + 0.606 × 温度(°C)  [m/s]
        20°C 时 ≈ 343 m/s → 1cm ≈ 58.3 μs
```

| 参数 | HC-SR04 | JSN-SR04T |
|------|---------|-----------|
| 工作电压 | 5V | 3.0-5.5V |
| 量程 | 2cm ~ 400cm | 25cm ~ 450cm |
| 精度 | ±3mm | ±1cm |
| 测量角度 | ~15° | ~75° (宽波束) |
| 探头 | 开放 (收发分离) | 防水密封 |
| 适用 | 室内 | 户外/水箱 |

---

## 2. HC-SR04 驱动

```
引脚连接:

  STM32          HC-SR04
  ┌──────┐      ┌──────┐
  │ GPIO ┼─────→│ TRIG │  (触发: ≥10μs 高脉冲)
  │ GPIO ┼─────←│ ECHO │  (回波: 脉宽 = 往返时间)
  │ 5V   ┼─────→│ VCC  │  (推荐用 5V, 3.3V 可能不稳定)
  │ GND  ┼─────→│ GND  │
  └──────┘      └──────┘
```

```c
// ===== 定时器输入捕获方式 (精度最高) =====
#include "hcsr04.h"

#define TRIG_PORT  GPIOB
#define TRIG_PIN   GPIO_PIN_0
#define ECHO_PORT  GPIOB
#define ECHO_PIN   GPIO_PIN_1

static volatile uint32_t capture_rise = 0;
static volatile uint32_t capture_fall = 0;
static volatile uint8_t  capture_done  = 0;

// TIM 输入捕获中断 (上升沿→下降沿)
void TIM2_IRQHandler(void) {
    if (TIM2->SR & TIM_SR_CC1IF) {
        if (GPIOB->IDR & GPIO_IDR_ID1) {
            // 上升沿: 记录起始时刻
            capture_rise = TIM2->CCR1;
            // 改为下降沿捕获
            TIM2->CCER |= TIM_CCER_CC1P;
        } else {
            // 下降沿: 记录结束时刻
            capture_fall = TIM2->CCR1;
            capture_done = 1;
            // 改回上升沿
            TIM2->CCER &= ~TIM_CCER_CC1P;
        }
    }
}

void HC_SR04_Init(void) {
    // TRIG: GPIO 输出
    // ECHO: TIM2 CH1 (PA0 或 PB1) 输入捕获, 预分频 72MHz/72=1MHz (1μs 分辨率)
}

float HC_SR04_Measure(void) {
    // 1. 发送 10μs 触发脉冲
    HAL_GPIO_WritePin(TRIG_PORT, TRIG_PIN, GPIO_PIN_SET);
    delay_us(10);
    HAL_GPIO_WritePin(TRIG_PORT, TRIG_PIN, GPIO_PIN_RESET);

    // 2. 等待回波 (超时 30ms ≈ 500cm)
    uint32_t timeout = 30000;
    capture_done = 0;
    while (!capture_done && --timeout);

    if (timeout == 0) return -1.0f;  // 超时 (超出量程或无障碍物)

    // 3. 计算距离
    uint32_t pulse_width = capture_fall - capture_rise;
    // 距离(cm) = 脉宽(μs) / 58.3 / 2 ... 不对, /58.3 已经是往返了
    // 1cm = 58.3μs 往返 = 29.15μs 单程
    float distance_cm = pulse_width / 58.3f;

    return distance_cm;
}
```

```c
// ===== 简化版: GPIO 中断 + 微秒定时器 =====
// 适用: 精度要求不高的场景 (如避障)

float HC_SR04_Measure_Simple(void) {
    // 触发 10μs
    TRIG_HIGH(); delay_us(10); TRIG_LOW();

    // 等待 ECHO 高电平
    uint32_t timeout = 30000;
    while (!ECHO_READ() && --timeout);
    if (timeout == 0) return -1;

    // 计时高电平持续时间
    uint32_t start = micros();
    timeout = 30000;
    while (ECHO_READ() && --timeout);
    uint32_t pulse = micros() - start;
    if (timeout == 0) return -1;

    return pulse / 58.3f;
}
```

---

## 3. JSN-SR04T 防水型驱动

JSN-SR04T 与 HC-SR04 时序兼容，但工作模式可配。

```c
// JSN-SR04T 模式配置 (通过 TRIG 上电时的电平)
// - TRIG 悬空 (或拉低): 普通模式 (与 HC-SR04 兼容)
// - TRIG 拉高再上电: 串口模式 (通过 UART 读取距离)

// 串口模式使用:
void JSN_SR04T_UART_Mode(void) {
    // 模块每 100ms 自动发送一帧: 0xFF 0xHH 0xTT 0xSU
    // 距离 = (0xHH << 8) | 0xTT  (mm)
    // 0xSU = 校验和 (前 3 字节之和的低字节)

    uint8_t frame[4];
    // UART IDLE 中断接收 4 字节...
    if (frame[0] == 0xFF &&
        ((frame[0] + frame[1] + frame[2]) & 0xFF) == frame[3]) {
        uint16_t distance_mm = (frame[1] << 8) | frame[2];
    }
}
```

---

## 4. 多传感器阵列

多个超声波传感器同时工作存在串扰问题。

```c
// 解决方案: 分时轮流触发
#define NUM_SENSORS 4

typedef struct {
    GPIO_TypeDef *trig_port; uint16_t trig_pin;
    GPIO_TypeDef *echo_port; uint16_t echo_pin;
    float distance;
} Ultrasonic_t;

Ultrasonic_t sensors[NUM_SENSORS];

void MultiSensor_Update(void) {
    for (int i = 0; i < NUM_SENSORS; i++) {
        sensors[i].distance = Measure_Single(&sensors[i]);
        HAL_Delay(50);  // 间隔 50ms (等上一个回波完全消失)
    }
    // 4 个传感器一次更新约 200ms
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | ECHO 一直高 (距离为 0) | 发射探头直接耦合到接收探头 | 增加两探头间隔 (≥10mm) |
| 2 | 测距偶尔跳变到很大值 | 回波被误触发 / 环境噪声 | 连续测量取中值; 加 RC 滤波 |
| 3 | 量程不到标称值的一半 | 供电不足 (HC-SR04 需 ≥4.5V) | 5V 供电; 加 100μF 电解电容 |
| 4 | 多个传感器同时用时互相干扰 | 各自超声波串扰 | 分时触发 (≥50ms 间隔) |
| 5 | 无法测量软质物体 (窗帘/泡沫) | 超声波被吸收 | 超声波不适用于吸声材料; 改用红外/激光 |
| 6 | 温度变化导致精度下降 | 声速随温度变化 | 加入温度传感器, 补偿声速: `v = 331.3 + 0.606×T` |
| 7 | 3.3V MCU 无法触发 HC-SR04 | 3.3V 低于 TRIG 的 VIH | 加三极管/MOSFET 电平转换 |

---

## 6. 参考文档

1. HC-SR04 模组说明: https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf
2. JSN-SR04T 数据手册 (防水型超声波模组)
3. 声速与温度关系: ISO 9613-1 (大气声吸收标准)
4. "Ultrasonic Distance Measurement" — TI Application Report SLAA136
