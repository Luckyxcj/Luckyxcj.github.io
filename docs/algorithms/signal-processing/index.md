# 信号处理 (FFT / DSP)

> **文档说明**：本文档基于 CMSIS-DSP 库文档、dspGuru FFT 指南及嵌入式频谱分析实战经验整理。

---

## 目录

1. [信号处理基础](#1-信号处理基础)
2. [CMSIS-DSP FFT 实战](#2-cmsis-dsp-fft-实战)
3. [窗函数选择](#3-窗函数选择)
4. [定点 DSP 技巧](#4-定点-dsp-技巧)
5. [常见问题](#5-常见问题)

---

## 1. 信号处理基础

### 采样定理 (Nyquist-Shannon)

```
采样频率 fs ≥ 2 × 信号最高频率 fmax

例如: 分析 500Hz 振动信号 → fs ≥ 1000Hz
实际工程中通常取 fs = 2.56 × fmax (加余量)

FFT 参数关系:
  N = FFT 点数 (通常为 2 的幂: 256, 512, 1024, 2048, 4096)
  fs = 采样频率 (Hz)
  Δf = 频率分辨率 = fs / N
  T = 采样时长 = N / fs

  例如: fs=1000Hz, N=1024 → Δf=0.977Hz, T=1.024秒
```

```
信号处理流水线:

  模拟信号 → ADC → 窗口(N点) → FFT → 幅度/相位谱 → 应用处理
              │                │
              └── 采样率 fs     └── 窗函数 (防频谱泄漏)
```

### 常用运算指标

| 运算类型 | CMSIS 函数 | 说明 |
|---------|-----------|------|
| FFT (float) | `arm_rfft_fast_f32` | 实输入 FFT |
| FFT (Q15) | `arm_rfft_q15` | 定点 16-bit FFT |
| FFT (Q31) | `arm_rfft_q31` | 定点 32-bit FFT |
| 幅度谱 | `arm_cmplx_mag_f32` | 复数值 → 幅度 |
| 最大值索引 | `arm_max_f32` | 找频谱峰值 |
| 均值 | `arm_mean_f32` | 直流分量 |
| 滤波器 | `arm_biquad_cascade_df1_f32` | IIR 滤波 |

---

## 2. CMSIS-DSP FFT 实战

```c
// 使用 CMSIS-DSP 进行 FFT 频谱分析
#include "arm_math.h"

#define FFT_SIZE  1024
#define FS        1000.0f  // 采样率 1000 Hz

// FFT 实例
arm_rfft_fast_instance_f32 fft_inst;
static float32_t fft_input[FFT_SIZE];
static float32_t fft_output[FFT_SIZE];       // 实部 + 虚部 交替存放
static float32_t fft_magnitude[FFT_SIZE/2];  // 幅度谱 (只需要前 N/2 点)

void FFT_Init(void) {
    arm_rfft_fast_init_f32(&fft_inst, FFT_SIZE);
}

void FFT_Process(void) {
    // 1. 采集 N 点数据 (ADC DMA 缓冲)
    for (int i = 0; i < FFT_SIZE; i++) {
        fft_input[i] = adc_buffer[i];  // 浮点化 (如有必要减去直流分量)
    }

    // 2. 可选: 加窗 (在时域上乘以窗函数)
    // for (int i = 0; i < FFT_SIZE; i++) {
    //     fft_input[i] *= hamming_window[i];
    // }

    // 3. 执行 FFT (就地运算: input → output)
    arm_rfft_fast_f32(&fft_inst, fft_input, fft_output, 0);

    // 4. 计算幅度谱: mag = sqrt(re^2 + im^2)
    // fft_output 格式: [re0, re1, im1, re2, im2, ..., re_N/2]
    // 注意: DC 和 Nyquist bin 只有实部
    fft_magnitude[0] = fabsf(fft_output[0]);  // DC
    for (int i = 1; i < FFT_SIZE/2; i++) {
        float re = fft_output[2*i];
        float im = fft_output[2*i + 1];
        fft_magnitude[i] = sqrtf(re*re + im*im);
    }

    // 5. 找频谱峰值
    uint32_t max_index;
    float32_t max_value;
    arm_max_f32(&fft_magnitude[1], FFT_SIZE/2 - 1, &max_value, &max_index);
    max_index++;  // 跳过 DC

    float freq = max_index * FS / FFT_SIZE;
    // freq = 峰值对应的频率 (Hz)

    // 6. 计算 THD (总谐波失真, 可选)
    // THD = sqrt(sum(V2^2 + V3^2 + ...)) / V1 * 100%
}
```

### FFT 结果解读

```
FFT 输出格式 (arm_rfft_fast_f32):

  索引:    [0]    [1]   [2]    [3]   [4]    [5]   ...  [2*(N/2-1)] [2*(N/2-1)+1]
  内容:    DC     re1   im1    re2   im2    re3   ...    re(N/2-1)    im(N/2-1)

  对应的频率:
  索引 0:   0 Hz (直流)
  索引 1:   Δf
  索引 2:   2×Δf
  ...
  索引 N/2: fs/2 (Nyquist, 只有实部)

  幅度谱: 只取 0 到 N/2
  注意: 幅度需要归一化: mag / (N/2) = 实际振幅 (对于 AC 分量)
                        mag / N     = 实际振幅 (对于 DC)
```

---

## 3. 窗函数选择

不加窗等于加矩形窗，在非整周期采样时会产生**频谱泄漏**。

```
频谱泄漏示意 (未加窗):

  理想频谱:     │
               │ ██
               │ ██
               └─┴────────

  实际频谱 (泄漏):
               │    ██
               │  ██████
               │ ████████
               └─┴────────
                (能量扩散到邻近 bins)
```

| 窗函数 | 主瓣宽度 | 旁瓣抑制 | 适用场景 |
|--------|---------|---------|---------|
| 矩形 (Rectangular) | 窄 | -13 dB | 整周期采样时 |
| 汉宁 (Hanning) | 宽 | -32 dB | 通用频谱分析 |
| 汉明 (Hamming) | 宽 | -43 dB | 相近频率分辨 |
| 布莱克曼 (Blackman) | 很宽 | -58 dB | 高动态范围 |
| 平顶 (Flat Top) | 最宽 | -44 dB | 精确幅度测量 |

```c
// 生成 Hanning 窗 (CMSIS-DSP 提供标准窗函数, 但也可手动生成)
// w[n] = 0.5 * (1 - cos(2π·n / (N-1)))
void Generate_Hanning(float *window, int N) {
    for (int n = 0; n < N; n++) {
        window[n] = 0.5f * (1.0f - cosf(2.0f * M_PI * n / (N - 1)));
    }
}
```

::: tip 窗函数选择快速指南
- **只需找频率** → Hanning (最常用)
- **需要测精确幅度** → Flat Top
- **两峰频率很近** → Hamming
- **信噪比极低** → Blackman
:::

---

## 4. 定点 DSP 技巧

```c
// 4.1 Q 格式选择
// Q15: 范围 ±1, 精度 1/32768, 适用于 FFT 输入在 ±1 内
// Q31: 范围 ±1, 精度 1/2^31, 适用于高分辨率信号

// 4.2 定点 FFT 使用
arm_rfft_instance_q15 fft_q15_inst;
q15_t fft_q15_input[FFT_SIZE];
q15_t fft_q15_output[FFT_SIZE];

arm_rfft_init_q15(&fft_q15_inst, FFT_SIZE, 0, 1);  // ifftFlag=0, doBitReverse=1
arm_rfft_q15(&fft_q15_inst, fft_q15_input, fft_q15_output);

// 4.3 防止定点溢出
// FFT 每级蝶形运算会使数据放大，CMSIS-DSP 内部有移位保护
// 但输出幅度需要手动缩放恢复:
// Q15 FFT: 总缩放 = 1/N (非 1/sqrt(N)!)
// 输出幅度 = fft_output[i] / N (Q15 下)

// 4.4 使用查找表加速三角函数
// STM32F1 无 FPU, sin/cos 非常慢
// 方案 1: 预生成 sin 查找表 (1024 点, Q15 格式)
const int16_t sin_table[1024] = { /* 预计算 */ };
// 查表: sin(x) = sin_table[(uint16_t)(x / (2π) * 1024) & 1023]

// 方案 2: 使用 CMSIS-DSP 快速数学函数
// arm_cos_f32(x) / arm_sin_f32(x) — 使用多项式近似 + 查表
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 频谱中有不存在的峰值 | 频谱泄漏 (未加窗) | 加 Hanning 窗 |
| 2 | 频率分辨不够 (两峰分不开) | N 太小 | 增大 N (1024→4096) 或 增加采样时长 |
| 3 | 定点 FFT 结果全 0 | 输入幅度太小 (Q15 量化后为 0) | 放大幅度(需防止溢出)或用 Q31 |
| 4 | FFT 输出在某些 bin 异常大 | 输入直流偏置 (DC offset) | FFT 前减去均值 (去直流) |
| 5 | M0/M3 做 1024 点 FFT 太慢 | 软浮点 + 大点数 | 降点数 256; 用 Q15 定点 FFT |
| 6 | 幅度值不准确 | 窗函数改变了幅度 | 用幅度修正因子 (Hanning: ×2.0) 或 Flat Top 窗 |
| 7 | 频谱峰值频率偏移 | 实际频率落在两个 bin 之间 (栅栏效应) | 插值法 (3 点抛物线插值) |

---

## 6. 参考文档

1. CMSIS-DSP 文档: https://arm-software.github.io/CMSIS-DSP/latest/
2. "The Scientist & Engineer's Guide to DSP" — Steven W. Smith: https://www.dspguide.com/
3. "Understanding Digital Signal Processing" — Richard G. Lyons
4. dspGuru FFT 常见问题: https://www.dspguru.com/dsp/faqs/fft/
5. FFT 窗函数对比: https://en.wikipedia.org/wiki/Window_function
