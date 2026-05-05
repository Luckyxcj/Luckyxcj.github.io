# 数字滤波算法 (IIR / FIR)

> **文档说明**：本文档基于 DSP 理论及嵌入式 CMSIS-DSP 库使用经验整理。

---

## 目录

1. [数字滤波基础](#1-数字滤波基础)
2. [IIR 滤波器设计与实现](#2-iir-滤波器设计与实现)
3. [FIR 滤波器设计与实现](#3-fir-滤波器设计与实现)
4. [定点数滤波实现](#4-定点数滤波实现)
5. [常见问题](#5-常见问题)

---

## 1. 数字滤波基础

| 特性 | IIR | FIR |
|------|-----|-----|
| 相位 | 非线性 | 可线性相位 |
| 阶数 (同样衰减) | 低 (4-8 阶) | 高 (32-128 阶) |
| 稳定性 | 可能不稳定（极点） | 始终稳定 |
| 计算量 | 小 | 大 |
| 适用场景 | 传感器实时滤波、PID D 项 | 信号去噪、精确相位 |

---

## 2. IIR 滤波器设计与实现

### 2.1 一阶低通 IIR (最常用)

```c
// 一阶 IIR 低通: y[n] = α×x[n] + (1-α)×y[n-1]
// α = dt / (RC + dt), RC = 1/(2π×fc)
// 适用于: 实时传感器数据平滑

float LowPassFilter_Update(float input, float alpha) {
    static float prev_output = 0;
    float output = alpha * input + (1.0f - alpha) * prev_output;
    prev_output = output;
    return output;
}

// 常用 α 值 (dt=1ms):
// fc=10Hz  → α = 2π×10×0.001 ≈ 0.063
// fc=50Hz  → α ≈ 0.31
// fc=100Hz → α ≈ 0.56
```

### 2.2 二阶 IIR (Butterworth)

```c
// 二阶 Butterworth 低通 (fc=20Hz, fs=1000Hz)
// 使用 CMSIS-DSP 库
#include "arm_math.h"

#define NUM_SECTIONS 1  // 2 阶 = 1 个二阶节 (biquad)

float32_t iir_coeffs[5 * NUM_SECTIONS];  // b0,b1,b2,a1,a2
float32_t iir_state[4 * NUM_SECTIONS];
arm_biquad_casd_df1_inst_f32 iir_inst;

void IIR_Init(void) {
    // 系数由 MATLAB/Python/在线工具计算
    // 例如 scipy.signal.butter(2, 20/500, 'low')
    float32_t coeffs[5] = {0.0036, 0.0072, 0.0036, -1.8222, 0.8367};
    memcpy(iir_coeffs, coeffs, sizeof(coeffs));

    arm_biquad_cascade_df1_init_f32(&iir_inst, NUM_SECTIONS,
                                     iir_coeffs, iir_state);
}

float IIR_Update(float input) {
    float output;
    arm_biquad_cascade_df1_f32(&iir_inst, &input, &output, 1);
    return output;
}
```

---

## 3. FIR 滤波器设计与实现

```c
// FIR 低通滤波器 (51 阶, fs=1000Hz, fc=100Hz)
// 使用 CMSIS-DSP 库
#define FIR_NUM_TAPS 51

float32_t fir_coeffs[FIR_NUM_TAPS];     // 由 scipy 生成
float32_t fir_state[FIR_NUM_TAPS + 256 - 1];  // 状态缓冲区
arm_fir_instance_f32 fir_inst;

void FIR_Init(void) {
    // 用 Python: scipy.signal.firwin(51, 100/500, window='hamming')
    // 系数示例 (截图):
    // [-0.0003, -0.0015, ... 共 51 个系数 ...]
    arm_fir_init_f32(&fir_inst, FIR_NUM_TAPS,
                     fir_coeffs, fir_state, 256);
}

float FIR_Update(float input) {
    float output;
    arm_fir_f32(&fir_inst, &input, &output, 1);
    return output;
}
```

---

## 4. 定点数滤波实现

```c
// 定点 Q15 格式 IIR (适用于无 FPU 的 MCU: F1, F0)
// Q15: 范围 ±1, 精度 1/32768

#define Q15_SCALE 32768

typedef struct {
    int16_t coeff_b0, coeff_b1, coeff_b2, coeff_a1, coeff_a2;
    int16_t state_x1, state_x2, state_y1, state_y2;
} Biquad_Q15_t;

int16_t Biquad_Q15_Update(Biquad_Q15_t *f, int16_t x) {
    int32_t acc;

    // y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2
    acc = (int32_t)f->coeff_b0 * x
        + (int32_t)f->coeff_b1 * f->state_x1
        + (int32_t)f->coeff_b2 * f->state_x2
        - (int32_t)f->coeff_a1 * f->state_y1
        - (int32_t)f->coeff_a2 * f->state_y2;

    int16_t y = (int16_t)(acc >> 15);  // Q15 右移恢复

    // 更新状态
    f->state_x2 = f->state_x1; f->state_x1 = x;
    f->state_y2 = f->state_y1; f->state_y1 = y;

    return y;
}
```

---

## 5. 常见问题

| # | 问题 | 解决方法 |
|---|------|---------|
| 1 | IIR 滤波器输出越来越大 (发散) | 系数精度不够或极点超出单位圆；检查系数设计 |
| 2 | 滤波后相位失真 (IIR) | 使用 FIR 或前向-后向滤波 (offline) |
| 3 | 定点滤波器精度不够 | 使用 Q31 格式或改用浮点 |
| 4 | 滤波延迟太大 | 减小滤波器阶数 (FIR) 或选择更高截止频率 |

---

## 6. 参考文档

1. CMSIS-DSP Documentation: https://arm-software.github.io/CMSIS-DSP/
2. "The Scientist & Engineer's Guide to DSP" — Steven W. Smith
3. scipy.signal 滤波器设计工具: https://docs.scipy.org/doc/scipy/reference/signal.html
