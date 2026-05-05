# 无刷直流电机 (BLDC) 与 FOC

> **文档说明**：本文档基于 BLDC 电机理论、SimpleFOC 开源库及嵌入式电机控制实战经验整理。

---

## 目录

1. [BLDC 基础](#1-bldc-基础)
2. [六步换相 (方波驱动)](#2-六步换相-方波驱动)
3. [FOC 矢量控制入门](#3-foc-矢量控制入门)
4. [SimpleFOC 实战](#4-simplefoc-实战)
5. [常见问题](#5-常见问题)

---

## 1. BLDC 基础

BLDC (Brushless DC) 用电子换相代替机械换向，效率更高、寿命更长、噪音更低。

```
BLDC vs 有刷直流:

| 特性 | 有刷 (Brushed) | 无刷 (BLDC) |
|------|---------------|-------------|
| 换向方式 | 碳刷 + 换向器 | 电子 (MOSFET) |
| 效率 | ~75% | ~90% |
| 寿命 | 有限 (碳刷磨损) | 长 (仅轴承) |
| 噪音 | 高 (电火花) | 低 |
| 控制复杂度 | 低 (PWM 即可) | 高 (需知道转子位置) |
| 成本 | 低 | 高 (电机+电调) |

BLDC 定子绕组类型:
  梯形波反电动势 (BLDC) → 六步换相 (方波)
  正弦波反电动势 (PMSM) → FOC (正弦波)
```

### 转子位置检测

| 方法 | 优点 | 缺点 |
|------|------|------|
| 霍尔传感器 | 简单可靠 | 分辨低 (60°), 需要 3 根线 |
| 编码器 | 高精度 | 贵, 占空间 |
| 反电动势 (BEMF) | 无传感器 | 静止/低速不可用 |
| 高频注入 (HFI) | 零速可用 | 算法复杂, 噪音 |
| 磁编码器 (AS5600) | 低成本、高精度 | 需要 I2C 读取 |

---

## 2. 六步换相 (方波驱动)

```
六步换相顺序:

  Phase:  A+ B-    A+ C-    B+ C-    B+ A-    C+ A-    C+ B-
           │        │        │        │        │        │
  转子:  ─→ ↑ ─→ ─→ ↗ ─→ ─→ → ─→ ─→ ↘ ─→ ─→ ↓ ─→ ─→ ↙ ─→
           └──────────── 360° 电气角度 ────────────┘

  每一步: 60° 电气角度
  6 步 = 360° 电气角度 = 1/N 机械圈 (N = 极对数)
```

```c
// 六步换相表 (根据霍尔传感器状态)
// HALL: U/V/W, 3-bit (HA, HB, HC)

typedef struct {
    uint8_t ah, al;  // A 相上管、下管
    uint8_t bh, bl;  // B 相
    uint8_t ch, cl;  // C 相
} SixStepState_t;

// 换相表: hall_code → {AH, AL, BH, BL, CH, CL}
const SixStepState_t commutation_table[8] = {
    // hall=0, 1: 无效状态
    [2] = {0,0, 1,0, 0,1},  // 001 → B+, C-
    [3] = {1,0, 0,0, 0,1},  // 010 → A+, C-
    [4] = {1,0, 0,1, 0,0},  // 011 → A+, B-
    [5] = {0,0, 0,1, 1,0},  // 100 → C+, B-
    [6] = {0,1, 0,0, 1,0},  // 101 → C+, A-
    [2] = {0,1, 1,0, 0,0},  // 110 → B+, A-
};

uint8_t hall_code;

// 霍尔变化中断
void EXTI_IRQHandler(void) {
    hall_code = (HAL_GPIO_ReadPin(HALL_U_Port, HALL_U_Pin) << 0)
              | (HAL_GPIO_ReadPin(HALL_V_Port, HALL_V_Pin) << 1)
              | (HAL_GPIO_ReadPin(HALL_W_Port, HALL_W_Pin) << 2);

    SixStepState_t s = commutation_table[hall_code];

    // 更新 6 路 PWM 输出 (使用高级定时器互补 PWM)
    TIM1->CCER = (s.ah << 0) | (s.al << 2)    // CH1: A 相
               | (s.bh << 4) | (s.bl << 6)    // CH2: B 相
               | (s.ch << 8) | (s.cl << 10);  // CH3: C 相
}
```

::: danger 六步换相注意
- 霍尔状态变化间隔决定转速: `RPM = 60 / (6×P×Δt)` (P=极对数)
- 换相时刻错误会导致抖动或反转
- 需要刹车/过流保护逻辑
:::

---

## 3. FOC 矢量控制入门

FOC (Field Oriented Control) 本质是将三相交流电机等效为直流电机控制，实现转矩和磁场独立调节。

```
FOC 控制框图:

  ┌──┐   ┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌────┐   ┌───┐
  │Id│→→(+)(-)→PI→│逆 │→│SVPWM│→│逆变器│→│BLDC│───┘
  └──┘  ↑│   │  │Park│ └───┘   └────┘   └──┬─┘
  ┌──┐  ││   │  │变换 │                    │
  │Iq│→→││   │  └───┘                    │
  └──┘  ││   │     ↑                     │
       ││   │  ┌──┴──┐                  │
       ││   └──│Park │                  │
       ││      │变换 │                  │
       ││      └──┬──┘                  │
       ││         ↑                     │
       ││      ┌──┴──┐   ┌───┐         │
       │└──────│Clarke│←──│Ia,Ib│←──────┘
       │       │变换 │   └───┘    (电流采样)
       │       └─────┘
       │
    角度反馈 (编码器/霍尔/观测器)

  核心: Id=0 控制 (最简单): 令直轴电流=0, 交轴电流=转矩
```

### Clarke 和 Park 变换

```c
// Clarke 变换: Ia, Ib, Ic → Iα, Iβ
// 假设 Ia + Ib + Ic = 0 (三相星型)
void Clarke_Transform(float Ia, float Ib, float *Ialpha, float *Ibeta) {
    *Ialpha = Ia;
    *Ibeta  = (Ia + 2.0f * Ib) / 1.7320508f;  // 1/sqrt(3)
}

// Park 变换: Iα, Iβ → Id, Iq
void Park_Transform(float Ialpha, float Ibeta, float theta,
                    float *Id, float *Iq) {
    float cos_t = arm_cos_f32(theta);
    float sin_t = arm_sin_f32(theta);
    *Id =  Ialpha * cos_t + Ibeta * sin_t;
    *Iq = -Ialpha * sin_t + Ibeta * cos_t;
}

// 逆 Park 变换: Vd, Vq → Vα, Vβ
void InvPark_Transform(float Vd, float Vq, float theta,
                       float *Valpha, float *Vbeta) {
    float cos_t = arm_cos_f32(theta);
    float sin_t = arm_sin_f32(theta);
    *Valpha = Vd * cos_t - Vq * sin_t;
    *Vbeta  = Vd * sin_t + Vq * cos_t;
}

// SVPWM: Vα, Vβ → 三相占空比
// 参考 TI / ST 电机库的 SVPWM 实现
```

### 电流环 PI

```c
// FOC 电流环 (Id / Iq 独立 PI 控制)
typedef struct {
    float Kp, Ki;
    float integral;
    float output_limit;
} PI_t;

float PI_Update(PI_t *pi, float error, float dt) {
    pi->integral += error * dt;

    // 积分限幅
    if (pi->integral > pi->output_limit) pi->integral = pi->output_limit;
    if (pi->integral < -pi->output_limit) pi->integral = -pi->output_limit;

    float output = pi->Kp * error + pi->Ki * pi->integral;

    if (output > pi->output_limit) output = pi->output_limit;
    if (output < -pi->output_limit) output = -pi->output_limit;

    return output;
}
```

---

## 4. SimpleFOC 实战

SimpleFOC 是 Arduino 生态下最流行的 FOC 开源库，支持多种 MCU (ESP32/STM32/Teensy)。

```cpp
// SimpleFOC 核心 API (Arduino 环境)
#include <SimpleFOC.h>

BLDCMotor motor = BLDCMotor(7);          // 7 极对
BLDCDriver3PWM driver = BLDCDriver3PWM(9, 10, 11, 8);  // A, B, C, enable
MagneticSensorI2C sensor = MagneticSensorI2C(AS5600_I2C);

void setup() {
    sensor.init();
    motor.linkSensor(&sensor);

    driver.voltage_power_supply = 12;
    driver.init();
    motor.linkDriver(&driver);

    // 电流环 PI
    motor.PID_current_q.P = 3;
    motor.PID_current_q.I = 300;
    motor.PID_current_d.P = 3;
    motor.PID_current_d.I = 300;

    // 速度环 PI
    motor.PID_velocity.P = 0.2;
    motor.PID_velocity.I = 20;

    motor.controller = MotionControlType::velocity;  // 速度控制
    motor.init();
    motor.initFOC();  // 校准传感器 + 电流检测
}

void loop() {
    motor.loopFOC();       // 执行 FOC 计算
    motor.move(target);    // 设定目标 (速度/位置/转矩)
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | BLDC 转动一卡一卡 (齿槽感) | 六步换相扭矩脉动 | 改用 FOC (正弦驱动) |
| 2 | FOC 电机静止时抖动 | 电流环 PI 增益过大或编码器噪声 | 降低 Kp, 增加 Ki; 检查编码器屏蔽 |
| 3 | 高速时电流失控 | 反电动势接近电源电压, 失去调节能力 | 提高供电电压; 降低期望转速; 弱磁控制 |
| 4 | 电机启动时反转一下 | 无传感器启动算法 (VF 或强拖) 方向不确定 | 用霍尔或编码器; 闭环后用观测器 |
| 5 | MOSFET 烧毁 | 上管/下管直通或过流 | 加死区 (200ns-1μs); 加过流保护 (ADC 监测) |
| 6 | FOC 运算太慢 (M3 跑不动) | 浮点运算 + 多环 PI | 降采样率 (10kHz→5kHz); 用定点数; 换 M4 |

---

## 6. 参考文档

1. SimpleFOC 开源项目: https://docs.simplefoc.com/
2. "Field Oriented Control (FOC) — A Deep Dive" — TI & ST
3. STM32 电机控制 SDK (MCSDK): https://www.st.com/en/embedded-software/x-cube-mcsdk.html
4. "Clarke & Park Transforms on the C2000" — TI Application Report
5. "Fundamentals of BLDC Motor" — Microchip AN885
6. James Mevey "Sensorless Field Oriented Control of PMSM" — Kansas State MSc Thesis
