# 数字滤波算法

> **文档说明**：本文档基于 DSP 理论、CMSIS-DSP 库及嵌入式传感器滤波实战经验整理，涵盖 8 种数字滤波方法的原理、实现与选型。

---

## 目录

1. [数字滤波基础与全景图](#1-数字滤波基础与全景图)
2. [移动平均滤波器 (Moving Average)](#2-移动平均滤波器-moving-average)
3. [中值滤波器 (Median Filter)](#3-中值滤波器-median-filter)
4. [一阶低通 IIR (指数平滑)](#4-一阶低通-iir-指数平滑)
5. [高阶 IIR 滤波器 (Butterworth / Chebyshev)](#5-高阶-iir-滤波器-butterworth--chebyshev)
6. [FIR 滤波器](#6-fir-滤波器)
7. [陷波滤波器 (Notch Filter)](#7-陷波滤波器-notch-filter)
8. [带通与高通滤波器](#8-带通与高通滤波器)
9. [定点数滤波实现](#9-定点数滤波实现)
10. [业务场景选型指南](#10-业务场景选型指南)
11. [常见问题](#11-常见问题)

---

## 1. 数字滤波基础与全景图

### 1.1 为什么需要数字滤波

嵌入式系统的 ADC 采集几乎总是伴随噪声：电源纹波、电磁干扰、机械振动耦合、ADC 量化噪声。数字滤波器在不增加硬件成本的前提下，用算法分离信号与噪声。

```
传感器原始信号 → [数字滤波器] → 干净信号

噪声类型:
  ┌──────────────────────────────────────────────────┐
  │ 白噪声 (宽带):              ██  ██  █  ███ █ ██ │  ← ADC 量化噪声、热噪声
  │ 工频干扰 (50Hz ± 谐波):      │    │    │    │   │  ← 电源耦合
  │ 低频漂移 (1/f 噪声):      ╱──────╲──────╱─────   │  ← 温度漂移、基准漂移
  │ 脉冲噪声 (偶发尖峰):        ▏     █     ▏       │  ← ESD、电机启动
  │ 振动耦合 (机械频段 10-500Hz): ▏ ██ ▏  █ ▏ ██ ▏  │  ← 电机/引擎振动
  └──────────────────────────────────────────────────┘
```

### 1.2 八大滤波方法全景对比

```
时域效果对比 (阶跃信号 + 噪声):

  原始含噪信号:  ──╮   ╭──╯  ╰──╮  ╭─╮╭╮╭───╮──╯──╮─────
                    ╰───╯     ╰──╯ ╰╯╰╯╰╯   ╰──╯

  移动平均 (SMA): ──╮     ╭─────╮     ╭──────╮     ╭───
                    ╰─────╯     ╰─────╯      ╰─────╯
                    平滑但有明显延迟

  中值滤波:        ──╮      ╭──────╯      ╰──────╮─────
                    ╰──────╯                ╰─────╯
                    去除尖峰、保留边沿

  一阶 IIR 低通:   ──╮   ╭────╯  ╰────╮  ╭────╯──╮────
                    ╰───╯              ╰──╯       ╰────
                    平滑自然、响应较快

  高阶 IIR (Butter):──╮  ╭───╯ ╰───╮ ╭───╯─╮──╯─╮───
                    ╰──╯           ╰─╯     ╰    ╰─
                    极平滑、有一定振铃

  FIR (线性相位):   ──╮  ╭───╯  ╰──╮  ╭──╯──╮──╯──╮──
                    ╰──╯           ╰──╯     ╰     ╰──
                    延迟可精确控制、无相位失真
```

### 1.3 频域特性对比

```
幅度响应 |H(f)|:

  低通 (Lowpass)          高通 (Highpass)          带通 (Bandpass)
  │████▄                    │         ▄████         │    ████▄
  │    ▀▄                   │       ▄▀             │   ▄▀  ▀▄
  │      ▀▄                 │     ▄▀               │  ▄▀    ▀▄
  │        ▀█████████       │████▀                 │██▀      ▀██████
  └──────────────→ f        └──────────────→ f      └────────────────→ f

  带阻/陷波 (Notch)        全通 (Allpass)          梳状 (Comb)
  │████▄    ▄████           │████████████           │█▄█▄█▄█▄█▄█▄
  │    ▀▄  ▄▀               │                        │
  │     ▀▄▄▀                │                       │
  └──────────────→ f        └──────────────→ f      └────────────────→ f
```

### 1.4 核心指标速查

| 指标 | 含义 | 嵌入式约束 |
|------|------|-----------|
| 截止频率 fc | 衰减 -3dB 的频率点 | dc 分量的漂移 → fc 0.1-1Hz；振动信号 → fc 50-500Hz |
| 阶数 / 抽头数 | 滤波器的复杂度 | M0/M3 用 1-2 阶 IIR 或 32 阶 FIR；M4/M7 可用 128 阶 |
| 群延迟 | 各频率成分通过滤波器的时间差 | 控制环内延迟 < 采样周期的 10% |
| 过渡带宽 | 通带 → 阻带的频率宽度 | 窄过渡带需要高阶滤波器 |
| 阻带衰减 | 阻带信号被抑制多少 dB | 工频干扰需 ≥ 40dB 抑制 |

---

## 2. 移动平均滤波器 (Moving Average)

### 2.1 原理

移动平均是最简单的低通滤波器，取最近 N 个样本的算术平均。相当于**时域的矩形窗卷积**。

```
滑动窗口示意 (N=4):

  数据流: x₀  x₁  x₂  x₃  x₄  x₅  x₆  x₇  x₈ ...
           │   │   │   │
    时刻3: └─┬─┴─┬─┴─┬─┘  → y₃ = (x₀+x₁+x₂+x₃)/4
             │   │   │   │
    时刻4:   └─┬─┴─┬─┴─┬─┘  → y₄ = (x₁+x₂+x₃+x₄)/4
               │   │   │   │
    时刻5:     └─┬─┴─┬─┴─┬─┘  → y₅ = (x₂+x₃+x₄+x₅)/4
```

### 2.2 简单移动平均 (SMA)

```c
// === 简单移动平均 (循环缓冲区) ===
// 优点: 实现极简、RAM 固定
// 缺点: 边沿延迟 = N/2 样本, 首尾值不稳定

#define SMA_WINDOW 16

typedef struct {
    float buffer[SMA_WINDOW];
    float sum;
    uint8_t index;
    uint8_t count;
} SMA_Filter_t;

float SMA_Update(SMA_Filter_t *f, float input) {
    // 减去最旧值，加上新值
    f->sum -= f->buffer[f->index];
    f->buffer[f->index] = input;
    f->sum += input;

    f->index++;
    if (f->index >= SMA_WINDOW) f->index = 0;
    if (f->count < SMA_WINDOW) f->count++;

    return f->sum / (float)f->count;
}
```

### 2.3 指数加权移动平均 (EWMA) — 一阶 IIR

EWMA 就是 [第 4 节](#4-一阶低通-iir-指数平滑) 的一阶 IIR 低通滤波器。它是移动平均的"无限窗口"版本。

### 2.4 适用场景

```
✅ 适用:
  - 周期性噪声去除 (窗口 = 信号周期)
  - ADC 过采样后降噪 (过采样 + 平均 = 提高 ENOB)
  - 系统启动时快速稳定

❌ 不适用:
  - 需要保留阶跃边沿的场景 (延迟大)
  - 去除脉冲噪声 (一个尖峰污染 N 个输出)
```

---

## 3. 中值滤波器 (Median Filter)

### 3.1 原理

中值滤波器取滑动窗口内的**中位数**（非均值），是去除脉冲噪声（椒盐噪声）的首选。

```
中值滤波示意 (N=5):

  输入: [3.2, 2.9, 3.1, 99.5, 3.0]
         排序: [2.9, 3.0, 3.1, 3.2, 99.5]
         中位数 = 3.1  ← 99.5 (尖峰) 被完全剔除

  对比 SMA:
         均值 = (3.2+2.9+3.1+99.5+3.0)/5 = 22.34  ← 尖峰严重污染结果
```

### 3.2 高效实现 (滑动窗口 + 链表排序)

```c
// === 中值滤波器 (排序法, N ≤ 9 时足够快) ===
// 对于 N > 9, 推荐使用 medfilt1 或直方图法

#define MEDIAN_WINDOW 5

typedef struct {
    float buffer[MEDIAN_WINDOW];
    uint8_t index;
    uint8_t count;
} MedianFilter_t;

// 插入排序 (小 N 下最快)
static void insert_sort(float *arr, int n) {
    for (int i = 1; i < n; i++) {
        float key = arr[i];
        int j = i - 1;
        while (j >= 0 && arr[j] > key) {
            arr[j + 1] = arr[j];
            j--;
        }
        arr[j + 1] = key;
    }
}

float Median_Update(MedianFilter_t *f, float input) {
    // 循环写入
    f->buffer[f->index] = input;
    f->index++;
    if (f->index >= MEDIAN_WINDOW) f->index = 0;
    if (f->count < MEDIAN_WINDOW) f->count++;

    if (f->count < MEDIAN_WINDOW) return input;  // 缓冲未满

    // 复制 + 排序 → 取中位
    float sorted[MEDIAN_WINDOW];
    memcpy(sorted, f->buffer, sizeof(sorted));
    insert_sort(sorted, MEDIAN_WINDOW);

    return sorted[MEDIAN_WINDOW / 2];  // 中位数
}
```

```c
// === 针对 ADC 整数数据的高效中值 ===
// N=3 的极简中值 (速度快, 适合 ISR 中调用)
int16_t Median3(int16_t a, int16_t b, int16_t c) {
    if (a > b) { int16_t t = a; a = b; b = t; }
    if (b > c) { int16_t t = b; b = c; c = t; }
    if (a > b) { int16_t t = a; a = b; b = t; }
    return b;  // 中间值
}

// N=5 无排序中值 (用比较网络, 适合无 FPU 的 M0)
int16_t Median5(int16_t a, int16_t b, int16_t c, int16_t d, int16_t e) {
    // 5 元素排序网络 (9 次比较)
    // 步骤省略... 返回第 3 大的值
    // 详见: https://en.wikipedia.org/wiki/Sorting_network
}
```

### 3.3 阶数选择

```
N=3:  对单点尖峰有效, 延迟 1 点
N=5:  对连续 2 点尖峰有效, 延迟 2 点 (最常用)
N=7:  对大尖峰有效, 延迟 3 点
N=9+: 延迟过大, 建议分段或使用自适应中值
```

### 3.4 适用场景

```
✅ 适用:
  - 去除偶发尖峰噪声 (ESD、电机火花、开关动作)
  - 超声波测距值平滑 (偶尔有回波干扰)
  - 红外传感器 (偶发的日光干扰)
  - 按键去抖 (数字信号的中值)

❌ 不适用:
  - 高斯白噪声 (中值滤波不如均值滤波)
  - 高频信号 (中值滤波会破坏信号结构)
  - 长窗口 → 实时性差
```

---

## 4. 一阶低通 IIR (指数平滑)

### 4.1 差分方程与频响

```
一阶 IIR 低通:  y[n] = α·x[n] + (1-α)·y[n-1]

  α = 2π·fc·dt  (当 fc << fs 时，小角度近似)
  精确: α = 1 - exp(-2π·fc·dt)

  频率响应 (α = 0.1, fs = 1000Hz → fc ≈ 16Hz):
  增益
  1.0 ┤█████▄
  0.7 ┤     ▀▄        ← -3dB @ 16Hz
  0.5 ┤       ▀▄
  0.1 ┤         ▀▄
  0.0 ┤           ▀█████████
      └──┬───┬───┬───┬──────→ f (Hz)
         10  16  50  100 500
```

### 4.2 完整实现

```c
// 一阶 IIR 低通: y[n] = α×x[n] + (1-α)×y[n-1]
// α = dt / (RC + dt), RC = 1/(2π×fc)
// 适用于: 实时传感器数据平滑、PID D 项滤波

typedef struct {
    float alpha;
    float output;
} IIR1_t;

void IIR1_Init(IIR1_t *f, float fc, float fs) {
    // 精确 alpha: 1 - exp(-2π·fc/fs)
    f->alpha = 1.0f - expf(-6.2831853f * fc / fs);
    f->output = 0;
}

float IIR1_Update(IIR1_t *f, float input) {
    f->output = f->alpha * input + (1.0f - f->alpha) * f->output;
    return f->output;
}

// 常用 α 值 (fs=1000Hz):
// fc=10Hz  → α = 1-exp(-2π×10/1000)  ≈ 0.061
// fc=50Hz  → α = 1-exp(-2π×50/1000)  ≈ 0.270
// fc=100Hz → α = 1-exp(-2π×100/1000) ≈ 0.467
// fc=200Hz → α = 1-exp(-2π×200/1000) ≈ 0.715
```

### 4.3 响应特性 (阶跃输入)

```
阶跃响应 (α 变化):

  输入: 0 ─────────────────── 1 ─────────────────
  输出:
    α=0.9  ─────╱────────────────────────  (快, 噪声大)
              ╱
    α=0.5  ─────╲───────╲───────╲───────  (中)
              ╲
    α=0.1  ─────╲─────────────╲───────╲──  (慢, 很平滑)
              ╲

  达到稳态 63% 需要的时间:  τ = 1/α 个采样周期
  达到稳态 95% 需要的时间:  ~3τ 个采样周期
  达到稳态 99% 需要的时间:  ~5τ 个采样周期
```

### 4.4 级联多级一阶 IIR

```c
// 两级一阶 IIR 级联 (实现更强的阻带衰减)
// 等效于二阶 IIR, 但计算简单、无系数设计困难

typedef struct {
    IIR1_t stage1;
    IIR1_t stage2;
} IIR1_Cascade_t;

float IIR1_Cascade_Update(IIR1_Cascade_t *f, float input) {
    float y1 = IIR1_Update(&f->stage1, input);
    return IIR1_Update(&f->stage2, y1);
}
// 两级 α=0.1 → 阻带衰减 = -40dB/dec (等同二阶)
// 比单个二阶 IIR 更不容易振荡
```

---

## 5. 高阶 IIR 滤波器 (Butterworth / Chebyshev)

### 5.1 滤波器类型对比

```
低通滤波器选型 (相同阶数下):

  Butterworth (最平坦):
  1.0 ┤█▄_______   ← 通带内幅度最平坦
  0.0 ┤____▀▀▀▀▀▀

  Chebyshev Type I (通带纹波, 陡峭过渡):
  1.0 ┤██▄▄▄______  ← 通带有纹波, 阻带衰减更快
  0.0 ┤________▀▀▀

  Chebyshev Type II (阻带纹波):
  1.0 ┤██▄▄▄__▄▄▄▄  ← 阻带有纹波, 通带平坦
  0.0 ┤

  Elliptic (椭圆, 最陡峭):
  1.0 ┤█▄█▄_______  ← 通带阻带都有纹波, 过渡带最窄
  0.0 ┤_____▄█▄█▄█
```

| 类型 | 通带平度 | 过渡带 | 相位线性度 | 嵌入式推荐 |
|------|---------|--------|-----------|-----------|
| Butterworth | 最平坦 | 中 | 中 | ★★★★★ 首选 |
| Chebyshev I | 有纹波 | 窄 | 差 | ★★★ 快速衰减时 |
| Chebyshev II | 平坦 | 窄 | 差 | ★★ 不常用 |
| Elliptic | 有纹波 | 最窄 | 最差 | ★ 极少用 |
| Bessel | 平坦 | 宽 | 最好 | ★★★★ 相位敏感场合 |

### 5.2 二阶 Butterworth 实现

```c
// 二阶 Butterworth 低通 (fc=50Hz, fs=1000Hz)
// 使用 CMSIS-DSP 库
#include "arm_math.h"

#define NUM_SECTIONS 1  // 2 阶 = 1 个二阶节 (biquad)

float32_t iir_coeffs[5 * NUM_SECTIONS];   // b0,b1,b2,a1,a2
float32_t iir_state[4 * NUM_SECTIONS];
arm_biquad_casd_df1_inst_f32 iir_inst;

void IIR2_Init(void) {
    // 系数由 Python scipy 生成:
    // from scipy import signal
    // b, a = signal.butter(2, 50/500, 'low')
    // print(b, a)
    // → b = [0.02008, 0.04016, 0.02008]
    // → a = [1.00000, -1.56102, 0.64135]

    float32_t coeffs[5] = {
         0.02008f,  0.04016f,  0.02008f,  // b0, b1, b2
        -1.56102f,  0.64135f              // a1, a2 (CMSIS 取正)
    };
    // 注意: CMSIS biquad 的 a1,a2 符号与 scipy/H(z) 公式相反
    // scipy 的 H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)
    // CMSIS 用负 a1 存储

    memcpy(iir_coeffs, coeffs, sizeof(coeffs));

    arm_biquad_cascade_df1_init_f32(&iir_inst, NUM_SECTIONS,
                                     iir_coeffs, iir_state);
}

float IIR2_Update(float input) {
    float output;
    arm_biquad_cascade_df1_f32(&iir_inst, &input, &output, 1);
    return output;
}
```

### 5.3 用 Python 设计系数

```python
# 生成 CMSIS-DSP 兼容的 biquad 系数
from scipy import signal
import numpy as np

fs = 1000      # 采样率
fc = 50        # 截止频率
order = 4      # 阶数

# Butterworth 低通
sos = signal.butter(order, fc/(fs/2), btype='low', output='sos')
# sos 是 (n_sections, 6) 的矩阵, 每行: [b0,b1,b2, 1,a1,a2]

for i, section in enumerate(sos):
    b0, b1, b2, _, a1, a2 = section
    print(f"// Section {i}:")
    print(f"  {b0:.8f}f, {b1:.8f}f, {b2:.8f}f, ")
    print(f"  {-a1:.8f}f, {-a2:.8f}f,")  # CMSIS 用负号

# 生成 FIR 系数 (窗函数法)
taps = signal.firwin(51, fc/(fs/2), window='hamming')
print("const float fir_coeffs[] = {")
for i in range(0, len(taps), 8):
    line = ", ".join(f"{taps[j]:.8f}f" for j in range(i, min(i+8, len(taps))))
    print(f"    {line},")
print("};")
```

---

## 6. FIR 滤波器

### 6.1 FIR vs IIR 深度对比

```
相位响应对比:

  IIR (非线性相位):
  输入脉冲:  |▇|         ← 单点
  输出:      |▇|_/‾\      ← 不同频率到达时间不同 → 信号畸变

  FIR (线性相位):
  输入脉冲:  |▇|
  输出:      |▇| (延迟 D 点, 各频率延迟一致)
  延迟 D = (N_taps - 1) / 2

这为什么重要? 在波形必须保持形状时:
  - 心电信号 (ECG) → 必须线性相位
  - 音频处理       → 人耳对相位敏感
  - 振动分析       → 相位失真 = 频谱错误
```

### 6.2 CMSIS-DSP FIR 实现

```c
// FIR 低通滤波器 (51 阶, fs=1000Hz, fc=100Hz)
#define FIR_NUM_TAPS 51

float32_t fir_coeffs[FIR_NUM_TAPS];
float32_t fir_state[FIR_NUM_TAPS + 256 - 1];  // blockSize + taps - 1
arm_fir_instance_f32 fir_inst;

void FIR_Init(void) {
    // 系数由 scipy.signal.firwin() 生成
    const float32_t coeffs[FIR_NUM_TAPS] = {
        // 对称系数 (线性相位的保证)
        -0.0003f, -0.0015f,  0.0023f,  0.0071f,  0.0013f,
        // ... 共 51 个系数 ...
    };

    memcpy(fir_coeffs, coeffs, sizeof(coeffs));
    arm_fir_init_f32(&fir_inst, FIR_NUM_TAPS,
                     fir_coeffs, fir_state, 256);
}

float FIR_Update(float input) {
    float output;
    arm_fir_f32(&fir_inst, &input, &output, 1);
    return output;
}
```

### 6.3 自适应 FIR (LMS 最小均方)

```c
// LMS 自适应滤波器 — 用于系统辨识 / 回波消除 / 主动降噪
// 原理: 不断调整 FIR 系数使误差 e[n]=d[n]-y[n] 最小化

#define LMS_TAPS 32
#define LMS_MU    0.01f   // 步长 (太大→发散, 太小→收敛慢)

typedef struct {
    float w[LMS_TAPS];     // 自适应系数
    float x[LMS_TAPS];     // 输入缓冲区
    uint8_t index;
} LMS_Filter_t;

float LMS_Update(LMS_Filter_t *f, float x, float d) {
    // 1. 写入输入缓冲区
    f->x[f->index] = x;

    // 2. 计算滤波输出 y = w·x
    float y = 0;
    for (int i = 0; i < LMS_TAPS; i++) {
        int idx = (f->index - i + LMS_TAPS) % LMS_TAPS;
        y += f->w[i] * f->x[idx];
    }

    // 3. 误差
    float err = d - y;

    // 4. 更新系数: w[i] += μ·err·x[i]
    for (int i = 0; i < LMS_TAPS; i++) {
        int idx = (f->index - i + LMS_TAPS) % LMS_TAPS;
        f->w[i] += LMS_MU * err * f->x[idx];
    }

    f->index = (f->index + 1) % LMS_TAPS;
    return y;
}
// 应用: 噪声参考麦克风 → LMS → 估计噪声 → 从主信号中扣除
```

---

## 7. 陷波滤波器 (Notch Filter)

### 7.1 为什么需要陷波

50Hz/60Hz 工频干扰是嵌入式系统第一大噪声源。低通滤波器可以滤除它，但会导致 >50Hz 的有用信号也被衰减。陷波滤波器**仅滤除特定频率**。

```
陷波器的频率响应:

  增益
  1.0 ┤████████████▄   ▄█████████████
  0.0 ┤             ▀▄▄▀
      └──────────────┬────────────→ f
                   50Hz

  只衰减 50Hz ± 几Hz, 其他频率保留
```

### 7.2 双二阶陷波器 (Biquad Notch)

```c
// 双二阶陷波器 (直接型 II), 中心频率 fc, 品质因数 Q
// Q 越大 → 陷波越窄 → 对相邻频率影响越小
// Q 越小 → 陷波越宽 → 对工频变化 (49.5-50.5Hz) 有容忍
// Q 推荐: 10~30 (窄陷波) 或 2~5 (宽陷波)

typedef struct {
    float b0, b1, b2;    // 前馈系数
    float a1, a2;        // 反馈系数
    float x1, x2, y1, y2; // 状态
} NotchFilter_t;

void Notch_Init(NotchFilter_t *f, float fc, float fs, float Q) {
    float omega = 2.0f * 3.14159265f * fc / fs;
    float cos_omega = cosf(omega);
    float alpha = sinf(omega) / (2.0f * Q);

    float a0 = 1.0f + alpha;  // b0 = 1/a0

    f->b0 = 1.0f / a0;
    f->b1 = (-2.0f * cos_omega) / a0;
    f->b2 = 1.0f / a0;
    f->a1 = (-2.0f * cos_omega) / a0;   // CMSIS 取反
    f->a2 = (1.0f - alpha) / a0;
}

float Notch_Update(NotchFilter_t *f, float input) {
    // 直接型 II 差分方程
    float output = f->b0 * input + f->b1 * f->x1 + f->b2 * f->x2
                                 - f->a1 * f->y1 - f->a2 * f->y2;

    // 更新状态 (注意延时链)
    f->x2 = f->x1; f->x1 = input;
    f->y2 = f->y1; f->y1 = output;

    return output;
}

// 使用示例: 50Hz 陷波, fs=1000Hz, Q=10
// Notch_Init(&notch, 50.0f, 1000.0f, 10.0f);
```

### 7.3 级联多个陷波器

```c
// 同时去除 50Hz 基频 + 100Hz 二次谐波
NotchFilter_t notch_50Hz, notch_100Hz;

void Notch_Dual_Init(void) {
    Notch_Init(&notch_50Hz,  50.0f, 1000.0f, 15.0f);
    Notch_Init(&notch_100Hz, 100.0f, 1000.0f, 15.0f);
}

float Notch_Dual_Update(float input) {
    float y = Notch_Update(&notch_50Hz, input);
    return Notch_Update(&notch_100Hz, y);
}
```

---

## 8. 带通与高通滤波器

### 8.1 带通滤波器 (Bandpass)

从信号中提取特定频段。振动分析中最常用：提取轴承故障特征频率、电机转速频率。

```c
// 带通 = 高通 + 低通 级联
// 例: 从加速度计提取 10~500Hz 振动频段

typedef struct {
    IIR1_t highpass;  // fc=10Hz 高通 (去除重力直流分量)
    IIR1_t lowpass;   // fc=500Hz 低通 (抗混叠)
} BandpassFilter_t;

void Bandpass_Init(BandpassFilter_t *f, float fc_low, float fc_high, float fs) {
    // 高通: 用一阶高通 = (1 - 一阶低通)
    // 等效差分方程: y[n] = (1-α/2)·x[n] - (1-α/2)·x[n-1] + (1-α)·y[n-1]
    IIR1_Init(&f->highpass, fc_low, fs);
    IIR1_Init(&f->lowpass, fc_high, fs);
}

float Bandpass_Update(BandpassFilter_t *f, float input) {
    float y = IIR1_Update(&f->lowpass, input);   // 先低通 (抗混叠)
    // 高通: y_hp = 输入 - 低通(输入)   (补滤波器)
    // 此处简化处理, 正式应使用二阶带通
    return y;
}

// 更正规的做法: Python 设计带通 biquad 系数
// b, a = signal.butter(2, [10/125, 500/125], btype='band')
```

### 8.2 高通滤波器

去除直流分量 (DC offset) 和极低频漂移。

```c
// 一阶高通: y[n] = β·x[n] - β·x[n-1] + β·y[n-1]
// 其中 β = exp(-2π·fc/fs), 截止频率 fc

typedef struct {
    float beta;
    float x_prev;
    float y_prev;
} HighPass1_t;

void HighPass1_Init(HighPass1_t *f, float fc, float fs) {
    f->beta = expf(-6.2831853f * fc / fs);
    f->x_prev = 0;
    f->y_prev = 0;
}

float HighPass1_Update(HighPass1_t *f, float input) {
    // y = β * (y_prev + x - x_prev)
    float output = f->beta * (f->y_prev + input - f->x_prev);
    f->x_prev = input;
    f->y_prev = output;
    return output;
}
// 典型用途:
// - 加速度计信号去重力分量 (fc=0.1Hz)
// - ECG 信号去基线漂移 (fc=0.5Hz)
// - 音频信号去 DC 偏移 (fc=10Hz)
```

### 8.3 微分器 (D 项替代)

```c
// IIR 高通在 fc 很低时近似微分器
// PID D 项 = Kd × de/dt, 直接差分放大噪声
// 替代方案: 用一阶高通 (截止频率 10-50Hz) 近似微分 + 滤波

void PID_Derivative_Filtered(PID_t *pid, float measurement, float dt) {
    // 方案 1: 测量值的低通滤波
    static IIR1_t d_filter;
    float filtered_meas = IIR1_Update(&d_filter, measurement);
    float derivative = -(filtered_meas - pid->prev_measurement) / dt;

    // 方案 2: 微分项本身用低通滤波 (更常用)
    pid->derivative = IIR1_Update(&d_filter, -(measurement - pid->prev_measurement) / dt);
}
```

---

## 9. 定点数滤波实现

```c
// === Q15 定点 IIR (适用于 Cortex-M0/M3 无 FPU) ===
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

// === Q31 定点 FIR (更高精度) ===
// Q31: 范围 ±1, 精度 1/2^31
// 使用 CMSIS-DSP: arm_fir_q31 函数
// 或使用 arm_fir_fast_q31 (简化版, 更快)

// === 浮点系数 → Q15 定点系数转换 ===
void FloatToQ15(float *float_coeffs, int16_t *q15_coeffs, int N) {
    for (int i = 0; i < N; i++) {
        float val = float_coeffs[i];
        // 限幅到 Q15 范围
        if (val > 1.0f) val = 1.0f;
        if (val < -1.0f) val = -1.0f;
        q15_coeffs[i] = (int16_t)(val * Q15_SCALE);
    }
}
// 注意: Q15 系数必须在 ±1 范围内
// 如果你的系数 >1 (如低通 α 可以 >1 吗? 不能, α ∈ [0,1])
// 归一化: 将所有 b 系数 ÷ max(|b|), 输入 x 也相应缩放
```

---

## 10. 业务场景选型指南

### 10.1 选型决策树

```
你要解决什么噪声?

  ┌── 高频白噪声 (ADC 量化噪声、热噪声)
  │   ├─ 需要边沿快速响应? → 一阶 IIR 低通 (α=0.1-0.5)
  │   ├─ 需要最平滑? → 二阶 Butterworth (fc=信号带宽)
  │   └─ 可以接受延迟? → 移动平均 (窗口=工频周期)
  │
  ├── 偶发尖峰 (ESD、电机火花、开关动作)
  │   → 中值滤波 (N=5 首选)
  │
  ├── 50Hz/60Hz 工频干扰
  │   ├─ 需要保留 >50Hz 的有用信号? → 陷波滤波器 (Q=10-30)
  │   └─ 不需要 >50Hz 信号? → 低通 fc=20-30Hz
  │
  ├── 低频漂移 (温度漂移、传感器零漂)
  │   → 高通滤波 (fc=0.1-0.5Hz)
  │
  ├── 周期性机械振动 (特定频率)
  │   ├─ 提取频段分析? → 带通滤波器
  │   └─ 抑制振动? → 陷波滤波器 (针对振动频率)
  │
  ├── 多传感器融合中某个传感器暂时异常
  │   → 中值滤波 + 协方差检测 (结合卡尔曼滤波)
  │
  └── 需要保持波形形状 (ECG/音频/振动分析)
      → FIR 线性相位 (阶数 ≥ fs/fc × 2)
```

### 10.2 场景 → 方案速查表

| 业务场景 | 推荐滤波方案 | 参数建议 | 备选方案 |
|---------|------------|---------|---------|
| **温度传感器平滑** (DS18B20, NTC) | 一阶 IIR 低通 | α=0.05-0.2 | 移动平均 N=8-16 |
| **ADC 电压/电流采样** | 中值 (N=3) + 一阶 IIR | N=3, α=0.1 | 过采样+平均 |
| **称重传感器 (HX711)** | 移动平均 (N=16) + 一阶 IIR | α=0.02-0.05 | N=32 平均 |
| **超声波测距** (HC-SR04) | 中值 (N=5) + 一阶 IIR | N=5, α=0.3 | 中值单独使用 |
| **姿态角 (Roll/Pitch)** | 一阶 IIR 互补滤波 | α=0.98 (陀螺仪权重) | Mahony/Madgwick |
| **IMU 加速度计 (高频振动)** | 二阶 Butterworth LP fc=40Hz | 2-4 阶 | FIR 64 阶 |
| **ECG 心电信号** | FIR 线性相位 + 陷波 (50Hz) | 51 阶, Q=30 | 二阶 Bessel |
| **电机电流 (FOC 采样)** | 一阶 IIR + 中值 (N=3) | α=0.3-0.5 | 移动平均 N=4 |
| **PID D 项 (微分)** | 一阶 IIR 低通 (fc=10-50Hz) | α=0.1-0.3 | 级联两级 IIR |
| **编码器速度计算** | 移动平均 (N=4-8) | N=4-8 | 一阶 IIR (α=0.5) |
| **音频信号 (MEMS 麦克风)** | FIR 高通 (fc=20Hz) + 低通 (fc=20kHz) | 64 阶 | IIR 4 阶 Butterworth |
| **震动分析 (FFT 前)** | FIR 带通 (10-500Hz) | 51 阶 | IIR 带通 |
| **气压计高度 (MS5611)** | 一阶 IIR 低通 | α=0.02 (慢) ~ 0.1 (快) | 卡尔曼 |
| **GPS 速度滤波** | 一阶 IIR 低通 | α=0.1-0.2 | 移动平均 N=5 |
| **电池电压监测** | 移动平均 (N=16) | N=16 | 一阶 IIR (α=0.05) |
| **力传感器 (碰撞检测)** | 中值 (N=3-5) + 高通 (fc=0.5Hz) | - | - |
| **CAN/LIN 总线信号质量** | 不需要软件滤波 | 硬件终端电阻匹配 | - |
| **PWM 占空比检测 (输入捕获)** | 移动平均 (N=4) | N=4 | 一阶 IIR (α=0.3) |

### 10.3 组合滤波策略

```
嵌入式传感器滤波的标准流水线:

  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
  │ 中值  │ → │ 低通  │ → │ 陷波  │ → │ 高通  │ → 输出
  │ N=5  │    │IIR α │    │50Hz  │    │fc=0.1│
  └──────┘    └──────┘    └──────┘    └──────┘
   去尖峰      平滑        去工频       去漂移

  每级滤波器的目的不同、互补:
  - 中值先去掉脉冲尖峰 (避免尖峰污染后续 IIR 状态)
  - 低通平滑白噪声
  - 陷波专门针对 50Hz (如果低通 fc<50Hz 则可以省略)
  - 高通去除长期漂移 (仅用于某些需要零中心的信号)

  计算量估算 (M0 @ 48MHz):
  中值 N=5:    ~50 周期
  一阶 IIR:    ~30 周期
  陷波 Biquad: ~80 周期
  总计:        ~160 周期 ≈ 3.3μs @ 48MHz → 几乎无开销
```

### 10.4 频率规划指南

```
根据应用确定滤波参数:

  采样率 fs 的选择:
  ┌─────────────────────────────────────────────┐
  │ 控制环路: fs = 10-50 × 控制带宽              │
  │ 传感器监测: fs = 2-10 × 信号最高频率          │
  │ 频谱分析 (FFT): fs = 2.56 × 最高关注频率      │
  │ 音频: fs = 8-48 kHz (看音质需求)             │
  │ 电力线分析: fs = 64-256 × 50Hz (正周期采样)   │
  └─────────────────────────────────────────────┘

  截止频率 fc 的选择:
  低通: fc = 信号带宽 × 1.5 ~ 3
  高通: fc = 需要去除的低频 × 0.5 ~ 1
  陷波: fc = 干扰频率 (50.00 ± 0.01 Hz)

  常见 fc 参考:
  - 温度传感器: fc = 0.1-1 Hz (温度变化极慢)
  - IMU 加速度计: fc = 20-50 Hz (去除振动)
  - 电机电流: fc = 100-500 Hz (电流变化快)
  - PID D 项: fc = 10-30 Hz (去微分噪声)
  - 电池电压: fc = 0.05-0.5 Hz (变化非常慢)
```

---

## 11. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | IIR 滤波器输出越来越大 (发散) | 系数精度不够或极点超出单位圆 | 检查系数设计；用级联一阶 IIR 代替高阶 |
| 2 | 滤波后相位失真 (IIR) | IIR 天然非线性相位 | 换 FIR 线性相位；或使用前向-后向滤波 (filtfilt, 仅离线) |
| 3 | 定点滤波器输出精度不够 | Q15 量化误差累积 | 升级到 Q31；或在关键累加处用 int64_t |
| 4 | 滤波延迟太大 | FIR 阶数过高 / IIR 阶跃响应慢 | FIR 降阶或换 IIR；IIR 增大 α |
| 5 | 中值滤波后信号走样 | N 太大 → 削平真实尖峰 | N 不超过 7；结合阈值判断 (偏离 >3σ 才滤除) |
| 6 | 陷波器消除了附近的信号 | Q 值太高 → 陷波太窄 → 频率抖动时漏过 | Q 值 5-15 之间；或在陷波前加 PLL 跟踪工频 |
| 7 | 滤波后数据有直流偏置 | 滤波器初始状态不为 0 | 初始化时用前几个样本填充状态缓冲 |
| 8 | 浮点计算占用太高 (M0/M3) | 软浮点每条指令数百周期 | 使用 Q15 定点；或 CMSIS-DSP 定点函数 |
| 9 | 信号边沿被抹平 | 低通 fc 太低或 α 太小 | 适度提高 fc；或用双速率滤波 (边沿检测 → 暂关滤波) |
| 10 | 级联多级滤波后信号幅度衰减 | 各级增益未补偿 | 检查每级 DC gain；陷波/高通在 dc 增益 <1 |

---

## 12. 参考文档

1. CMSIS-DSP Documentation: https://arm-software.github.io/CMSIS-DSP/latest/
2. "The Scientist & Engineer's Guide to DSP" — Steven W. Smith: https://www.dspguide.com/
3. scipy.signal 设计工具: https://docs.scipy.org/doc/scipy/reference/signal.html
4. "Understanding Digital Signal Processing" — Richard G. Lyons
5. IIR Biquad 系数计算器: https://www.earlevel.com/main/2016/09/29/iir-filter-design/
6. "Digital Filter Design for Embedded Systems" — Tim Wescott (Wescott Design Services)
7. dspGuru FAQ: https://dspguru.com/dsp/faqs/
8. "Fixed Point IIR Filter Implementation" — TI Application Report SPRA509
9. "A Practical Guide to Median Filtering" — IEEE Signal Processing Magazine
