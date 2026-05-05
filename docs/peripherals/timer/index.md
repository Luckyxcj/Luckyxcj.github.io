# 定时器

> **文档说明**：本文档基于 STM32 参考手册 TIM 章节，涵盖基本/通用/高级定时器的区别与使用。

---

## 目录

1. [定时器类型对比](#1-定时器类型对比)
2. [基本定时器配置](#2-基本定时器配置)
3. [编码器模式](#3-编码器模式)
4. [输入捕获 (频率/占空比测量)](#4-输入捕获)
5. [常见问题](#5-常见问题)

---

## 1. 定时器类型对比

| 类型 | 典型型号 | 位数 | 特性 |
|------|---------|------|------|
| **基本** | TIM6, TIM7 | 16-bit | 仅向上计数, 无 I/O 通道 |
| **通用** | TIM2-TIM5 | 16/32-bit | 向上/向下/编码器, 4 个 I/O 通道 |
| **高级** | TIM1, TIM8 | 16-bit | 互补输出 + 死区 + 刹车 |
| **基本 (LPTIM)** | LPTIM1 | 16-bit | 低功耗, 可在 Stop 模式运行 |

---

## 2. 基本定时器配置

```c
// 定时器中断: 每 500ms 触发一次
TIM_HandleTypeDef htim6;

void MX_TIM6_Init(void) {
    htim6.Instance = TIM6;
    // 定时器时钟 = 84MHz (APB1 定时器时钟)
    // PSC=8400-1 → 84MHz/8400 = 10kHz = 0.1ms
    // ARR=5000-1 → 0.1ms × 5000 = 500ms
    htim6.Init.Prescaler = 8400 - 1;
    htim6.Init.Period = 5000 - 1;
    HAL_TIM_Base_Init(&htim6);

    HAL_NVIC_SetPriority(TIM6_DAC_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(TIM6_DAC_IRQn);

    HAL_TIM_Base_Start_IT(&htim6);
}

void TIM6_DAC_IRQHandler(void) {
    HAL_TIM_IRQHandler(&htim6);
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM6) {
        // 每 500ms 执行一次 (如: 翻转 LED)
    }
}
```

---

## 3. 编码器模式

编码器模式用于读取增量编码器 (AB 相编码器) 的位置和方向。

```c
void MX_TIM2_Encoder_Init(void) {
    TIM_Encoder_InitTypeDef sEncoder = {0};

    htim2.Instance = TIM2;
    htim2.Init.Prescaler = 0;
    htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim2.Init.Period = 0xFFFFFFFF;  // 32-bit 全范围 (TIM2/TIM5 是 32-bit)
    htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;

    // 编码器模式: TI1 和 TI2 双边沿都计数 (4倍频)
    sEncoder.EncoderMode = TIM_ENCODERMODE_TI12;
    sEncoder.IC1Polarity = TIM_ICPOLARITY_RISING;
    sEncoder.IC1Selection = TIM_ICSELECTION_DIRECTTI;
    sEncoder.IC2Polarity = TIM_ICPOLARITY_RISING;
    sEncoder.IC2Selection = TIM_ICSELECTION_DIRECTTI;
    HAL_TIM_Encoder_Init(&htim2, &sEncoder);

    HAL_TIM_Encoder_Start(&htim2, TIM_CHANNEL_ALL);
}

// 读取当前位置
int32_t Encoder_GetPosition(void) {
    return (int32_t)__HAL_TIM_GET_COUNTER(&htim2);
}
```

---

## 4. 输入捕获 (频率/占空比测量)

```c
// 测量外部信号的频率和占空比
// CH1 捕获上升沿, CH2 捕获下降沿
void MX_TIM3_InputCapture_Init(void) {
    TIM_IC_InitTypeDef sIC = {0};

    // CH1: 捕获上升沿
    sIC.ICPolarity = TIM_ICPOLARITY_RISING;
    sIC.ICSelection = TIM_ICSELECTION_DIRECTTI;
    sIC.ICPrescaler = TIM_ICPSC_DIV1;
    sIC.ICFilter = 0;
    HAL_TIM_IC_ConfigChannel(&htim3, &sIC, TIM_CHANNEL_1);

    // CH2: 捕获下降沿
    sIC.ICPolarity = TIM_ICPOLARITY_FALLING;
    HAL_TIM_IC_ConfigChannel(&htim3, &sIC, TIM_CHANNEL_2);

    HAL_TIM_IC_Start_IT(&htim3, TIM_CHANNEL_1);
    HAL_TIM_IC_Start_IT(&htim3, TIM_CHANNEL_2);
}

void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    static uint32_t last_rise = 0;

    if (htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
        // CH1 上升沿: 记录
        uint32_t now = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);
        // 频率 = TIM_CLK / (now - last_rise)
        last_rise = now;
    } else if (htim->Channel == HAL_TIM_ACTIVE_CHANNEL_2) {
        // CH2 下降沿: 计算占空比
        uint32_t fall = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_2);
    }
}
```

---

## 5. 常见问题

| # | 问题 | 解决方法 |
|---|------|---------|
| 1 | 定时器中断不触发 | 检查 `HAL_TIM_Base_Start_IT()` 是否调用；NVIC 是否使能 |
| 2 | APB1 定时器时钟到底是多少 | `APB1 != 1 → TIM_CLK = 2×APB1`; `APB1 == 1 → TIM_CLK = APB1` |
| 3 | 32-bit 定时器只有 TIM2 和 TIM5 | 如果编码器需要大范围计数，优先选这两个 |
| 4 | 多路 PWM 输出频率完全一致 | 同一个定时器的所有通道共享 PSC/ARR，无法独立调频 |

---

## 6. 参考文档

1. RM0090: STM32F4xx — TIM 章节
2. ST AN4013: STM32 定时器应用
3. ST AN4776: 编码器模式使用指南
