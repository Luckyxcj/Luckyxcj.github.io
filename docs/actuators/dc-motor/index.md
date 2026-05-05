# 直流有刷电机驱动

> **文档说明**：本文档基于 Infineon/TI 电机驱动 IC 数据手册及嵌入式电机控制实战经验整理。

---

## 目录

1. [直流电机基础](#1-直流电机基础)
2. [H 桥驱动原理](#2-h-桥驱动原理)
3. [PWM 调速与 PID 速度控制](#3-pwm-调速与-pid-速度控制)
4. [常用驱动芯片](#4-常用驱动芯片)
5. [常见问题](#5-常见问题)

---

## 1. 直流电机基础

有刷直流电机 (Brushed DC Motor) 是最简单的电机类型，通过换向器和碳刷实现机械换向。

```
直流电机等效电路模型:

      R (电枢电阻)    L (电枢电感)
  ────[====]────[~~~~]─────┐
   +                       │  + 反电动势 E = Ke × ω
  Vin                      M  (与转速成正比)
   -                       │
  ──────────────────────────┘

  稳态: Vin = I×R + Ke×ω
  转矩: T = Kt × I
  转速: ω = (Vin - I×R) / Ke

  关键特性:
  - 启动电流 = Vin / R (极大, 需限流)
  - 转速 ≈ 与电压成正比
  - 堵转时电流最大、转矩最大
```

| 参数 | 典型值 | 说明 |
|------|--------|------|
| 额定电压 | 3V / 6V / 12V / 24V | 工作电压 |
| 空载转速 | 1000~30000 RPM | 无负载时的转速 |
| 堵转电流 | 1A~10A | 停转时的最大电流 |
| 额定转矩 | 0.1~2 N·m | 持续输出转矩 |

---

## 2. H 桥驱动原理

H 桥通过 4 个开关管 (MOSFET) 控制电机转向和速度。

```
H 桥电路:

  VCC
   │
   ├────── Q1 ────┬──── Q3 ────┤
   │              │            │
   │              M (电机)     │
   │              │            │
   ├────── Q2 ────┴──── Q4 ────┤
   │
  GND

  正转: Q1+Q4 导通, Q2+Q3 关断
  反转: Q2+Q3 导通, Q1+Q4 关断
  刹车: Q2+Q4 导通 (下管短路制动)
  滑行: 全部关断 (惯性滑行)
```

```c
// H 桥 PWM 控制 (两路互补 PWM + 两路方向)
// 使用 STM32 定时器输出 4 路 PWM

typedef enum {
    MOTOR_STOP,
    MOTOR_FORWARD,
    MOTOR_REVERSE,
    MOTOR_BRAKE
} MotorDirection_t;

typedef struct {
    TIM_HandleTypeDef *htim;
    uint32_t ch_in1, ch_in2;  // 正转半桥
    uint32_t ch_en1, ch_en2;  // 使能 (或另一侧)
    int16_t  duty;             // -1000 ~ 1000
} DCMotor_t;

void DCMotor_SetSpeed(DCMotor_t *motor, int16_t duty) {
    motor->duty = duty;

    if (duty > 0) {
        // 正转: IN1=PWM, IN2=0
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in1, duty);
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in2, 0);
    } else if (duty < 0) {
        // 反转: IN1=0, IN2=PWM
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in1, 0);
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in2, -duty);
    } else {
        // 刹车: IN1=0, IN2=0 (或都拉高做短路刹车)
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in1, 0);
        __HAL_TIM_SET_COMPARE(motor->htim, motor->ch_in2, 0);
    }
}
```

::: danger H 桥直通 (Shoot-Through) 保护
同一半桥的上管和下管**绝对不能同时导通**，否则 VCC → GND 短路烧毁 MOSFET。
- 使用带死区插入的互补 PWM (死区 500ns~2μs)
- 或使用带硬件互锁的驱动 IC (如 DRV8870/TB6612)
:::

---

## 3. PWM 调速与 PID 速度控制

```c
// 增量式编码器速度计算
typedef struct {
    TIM_HandleTypeDef *htim_enc;
    int32_t  position;    // 累计位置
    float    speed_rpm;   // 当前速度 (RPM)
    uint32_t last_time;
} Encoder_t;

void Encoder_Update(Encoder_t *enc) {
    int16_t delta = (int16_t)__HAL_TIM_GET_COUNTER(enc->htim_enc);
    __HAL_TIM_SET_COUNTER(enc->htim_enc, 0);

    enc->position += delta;

    uint32_t now = HAL_GetTick();
    float dt = (now - enc->last_time) / 1000.0f;
    enc->last_time = now;

    // RPM = (Δ脉冲 / 编码器线数 / dt) * 60
    // 例如: 13 PPR × 4 (4倍频) = 52 脉冲/转
    enc->speed_rpm = (delta / (52.0f * dt)) * 60.0f;
}

// PID 速度闭环 (位置式 PID + 前馈)
float Motor_SpeedControl(float target_rpm, float actual_rpm) {
    static PID_t speed_pid;  // 参见 PID 章节

    float error = target_rpm - actual_rpm;

    // PID 输出 → PWM 占空比
    float output = PID_Compute(&speed_pid, actual_rpm, 0.01f);

    // 限幅
    if (output > 999) output = 999;
    if (output < -999) output = -999;

    return output;  // → DCMotor_SetSpeed()
}
```

---

## 4. 常用驱动芯片

| 芯片 | 电压 | 峰值电流 | 特点 |
|------|------|---------|------|
| L298N | 5-46V | 2A | 双 H 桥, 压降大 (~2.5V) |
| TB6612FNG | 2.5-13.5V | 3.2A | 双 H 桥, 低 RDS(on), 飞控常用 |
| DRV8870 | 6.5-45V | 3.6A | 单 H 桥, 硬件电流检测 |
| L9110S | 2.5-12V | 0.8A | 玩具/小功率电机 |
| BTN7971B | 5.5-28V | 44A | 大功率, 智能功率芯片 |
| TMC6200 | 8-60V | 60A | FOC 用, 集成电流检测 |

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 电机不转但 PWM 有输出 | 驱动 IC 使能脚未使能 / 供电不足 | 检查 nSLEEP(DRV) 或 STBY(TB6612) 引脚 |
| 2 | 芯片严重发热 | L298N 压降 × 电流发热 (线性管) | 改用 MOSFET 型驱动 (TB6612/DRV8870) |
| 3 | 低速时电机抖动 | PWM 频率太低 (听到声音) | PWM 频率升到 >20kHz (人耳听不到) |
| 4 | 电流采样噪声大 | ADC 采样时机与 PWM 不同步 | 在 PWM 中心点采样 (中心对齐模式) |
| 5 | 启动瞬间 MCU 复位 | 电机堵转电流拉低 MCU 电源 | 独立供电; 大电解电容 (1000μF); TVS 保护 |
| 6 | 编码器方向反了 (正转 RPM 为负) | A/B 相接线反了 | 交换 A 相和 B 相 |

---

## 6. 参考文档

1. "Brushed DC Motor Fundamentals" — Microchip AN905
2. TB6612FNG 数据手册 (Toshiba)
3. DRV8870 数据手册 (Texas Instruments)
4. PID 速度闭环参见 [PID 控制算法](../../algorithms/pid/)
5. "Motion Control Basics" — ST Application Notes
