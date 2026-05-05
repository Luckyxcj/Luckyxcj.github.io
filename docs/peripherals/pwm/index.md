# PWM 脉宽调制

> **文档说明**：本文档基于 STM32 参考手册 TIM 章节及电机控制/电源管理应用经验整理。

---

## 目录

1. [PWM 基础](#1-pwm-基础)
2. [STM32 TIM 输出 PWM](#2-stm32-tim-输出-pwm)
3. [高级 PWM 应用](#3-高级-pwm-应用)
4. [常见问题与排查](#4-常见问题与排查)

---

## 1. PWM 基础

### 1.1 PWM 核心参数

```
PWM 波形:

┌─────────┐         ┌─────────┐
│  ON     │         │  ON     │
│         │  OFF    │         │
└─────────┘         └─────────┘
│←───── 周期 T ────→│

占空比 (Duty Cycle) = T_on / T_period × 100%
分辨率 = 定时器的计数分辨率 (如 16-bit = 65536 级)
频率 = 定时器时钟 / (PSC+1) / (ARR+1)
```

### 1.2 常见应用

| 应用 | 频率 | 占空比范围 | 注意 |
|------|------|----------|------|
| LED 调光 | 100-1000 Hz | 0-100% | 频率太低会闪烁 |
| 舵机控制 | 50 Hz | 5-10% (1-2ms 脉宽) | 标准 RC 舵机 |
| DC 电机调速 | 10-20 kHz | 0-100% | 低频有啸叫声 |
| 无刷电机 (BLDC) | 16-48 kHz | 0-100% | 需高级定时器+死区 |
| 音频输出 | 44.1-96 kHz | 0-100% | 需 DA 滤波 |

---

## 2. STM32 TIM 输出 PWM

### 2.1 基础 PWM 配置

```c
TIM_HandleTypeDef htim3;

void MX_TIM3_PWM_Init(void) {
    TIM_OC_InitTypeDef sConfigOC = {0};

    htim3.Instance = TIM3;
    htim3.Init.Prescaler = 168 - 1;           // PSC: 84MHz / 168 = 500kHz
    htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim3.Init.Period = 5000 - 1;              // ARR: 500kHz / 5000 = 100Hz
    htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    HAL_TIM_PWM_Init(&htim3);

    // CH1 输出: 占空比由 CCR1 控制
    sConfigOC.OCMode = TIM_OCMODE_PWM1;
    sConfigOC.Pulse = 2500;                     // 50% 占空比 = 2500/5000
    sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
    HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_1);

    HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);
}

// 动态修改占空比
void PWM_SetDutyCycle(uint16_t duty) {
    // duty: 0 ~ (htim3.Init.Period+1)
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, duty);
}
```

### 2.2 PWM1 vs PWM2

```
PWM1 模式: CNT < CCR → 输出有效电平, CNT >= CCR → 输出无效电平
PWM2 模式: CNT < CCR → 输出无效电平, CNT >= CCR → 输出有效电平

在向上计数模式 (极性=高) 中:
  PWM1: ┌────────┐            (占空比 = CCR/ARR)
        │ Active │_____
        └────────┘
  PWM2:      ┌────────┐       (占空比 = 1 - CCR/ARR)
        _____│ Active │
             └────────┘
```

---

## 3. 高级 PWM 应用

### 3.1 互补 PWM + 死区 (电机控制)

```c
// 高级定时器 (TIM1/TIM8) 支持互补输出 + 死区插入
void MX_TIM1_PWM_Init(void) {
    TIM_BreakDeadTimeConfig(&htim1, &sBreakDeadTime);

    sBreakDeadTime.OffStateRunMode = TIM_OSSR_ENABLE;
    sBreakDeadTime.OffStateIDLEMode = TIM_OSSI_ENABLE;
    sBreakDeadTime.LockLevel = TIM_LOCKLEVEL_OFF;
    sBreakDeadTime.DeadTime = 100;  // 100 × (1/168MHz) ≈ 595ns 死区时间
    sBreakDeadTime.BreakState = TIM_BREAK_ENABLE;
    sBreakDeadTime.BreakPolarity = TIM_BREAKPOLARITY_HIGH;
    sBreakDeadTime.AutomaticOutput = TIM_AUTOMATICOUTPUT_ENABLE;
    HAL_TIMEx_ConfigBreakDeadTime(&htim1, &sBreakDeadTime);

    // CH1 + CH1N 互补输出
    HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_1);
}
```

### 3.2 舵机控制 (50Hz, 1-2ms 脉宽)

```c
// 舵机控制: 周期 20ms (50Hz), 脉宽 0.5-2.5ms
// ARR = 20000 (20ms @ 1us 分辨率)
// 0°   →  CCR = 500   (0.5ms)
// 90°  →  CCR = 1500  (1.5ms)
// 180° →  CCR = 2500  (2.5ms)

void Servo_SetAngle(uint8_t angle) {
    // 0°-180° 映射到 500-2500
    uint16_t pulse = 500 + (uint32_t)angle * 2000 / 180;
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, pulse);
}
```

---

## 4. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | PWM 引脚无输出 | TIM GPIO 未配置 AF 模式 | CubeMX 中确认选择 PWM Output |
| 2 | 频率不对 | PSC 或 ARR 计算错误 | 用示波器实际测量；公式: f = TIM_CLK / (PSC+1) / (ARR+1) |
| 3 | LED 调光到低占空比时闪烁 | 频率太低 + 占空比太小 | LED PWM 频率 ≥ 200Hz |
| 4 | DC 电机有高频啸叫声 | PWM 频率在人耳听觉范围内 (< 16kHz) | 提高到 16-20kHz |
| 5 | 互补输出的 CH1 和 CH1N 同时导通 | 死区时间不够 (MOSFET 开关有延迟) | 最小死区由 MOSFET 决定 (通常是几百 ns) |

---

## 5. 参考文档

1. RM0090: STM32F4xx — TIM 章节
2. ST AN4013: STM32 定时器 PWM 应用
3. "PWM 死区设计" — ST Application Note
