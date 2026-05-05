# 卡尔曼滤波

> **文档说明**：本文档基于 Kalman 1960 经典论文、Simon D. Levy 嵌入式实现及实际传感器融合项目经验整理。

---

## 目录

1. [卡尔曼滤波基础](#1-卡尔曼滤波基础)
2. [一维卡尔曼滤波器](#2-一维卡尔曼滤波器)
3. [多维卡尔曼滤波器](#3-多维卡尔曼滤波器)
4. [嵌入式优化技巧](#4-嵌入式优化技巧)
5. [常见问题](#5-常见问题)

---

## 1. 卡尔曼滤波基础

卡尔曼滤波是一种**递归的最优状态估计算法**，根据含噪声的测量序列估计系统状态。与低通滤波不同，它使用系统动态模型预测 + 测量校正相结合。

```
卡尔曼滤波器工作流程 (两步递归):

  ┌──────────────┐         ┌──────────────┐
  │ 1. 预测 (Predict)│      │ 2. 更新 (Update) │
  │                │      │                │
  │ x = F·x + B·u │ ───→ │ K = P·Hᵀ/(H·P·Hᵀ+R)│
  │ P = F·P·Fᵀ + Q│      │ x = x + K(z-H·x) │
  │                │      │ P = (I-K·H)P    │
  └──────────────┘      ←┘──────────────┘
                            (有测量值时)

  符号说明:
    x : 状态向量          F : 状态转移矩阵
    P : 协方差矩阵        Q : 过程噪声矩阵
    z : 测量值            H : 测量矩阵
    K : 卡尔曼增益         R : 测量噪声矩阵
```

| 对比 | 低通滤波 | 卡尔曼滤波 |
|------|---------|-----------|
| 需要模型 | 无 | 需要系统动力学模型 |
| 延迟 | 有 (相位延迟) | 无 (零相位滞后) |
| 噪声抑制 | 中 | 优 (已知噪声特性时) |
| 计算量 | 极小 | 中等 |
| 适应性 | 固定截止频率 | 自适应增益 |
| 典型场景 | 传感器平滑 | 传感器融合、状态估计 |

---

## 2. 一维卡尔曼滤波器

```c
// 一维卡尔曼滤波器 — 最简单、最常用的嵌入式形式
// 适用: 单个传感器滤波 (如温度传感器、ADC 读数)

typedef struct {
    float x;      // 状态估计值
    float p;      // 估计协方差
    float q;      // 过程噪声 (模型信任度)
    float r;      // 测量噪声 (传感器信任度)
    float k;      // 卡尔曼增益 (计算中间值)
} Kalman1D_t;

void Kalman1D_Init(Kalman1D_t *kf, float init_x, float q, float r) {
    kf->x = init_x;
    kf->p = 1.0f;    // 初始协方差 (不太重要, 会快速收敛)
    kf->q = q;
    kf->r = r;
    kf->k = 0;
}

float Kalman1D_Update(Kalman1D_t *kf, float measurement) {
    // Step 1: 预测
    // x = x (假设状态不变, 适用于静态或缓慢变化的信号)
    kf->p = kf->p + kf->q;

    // Step 2: 更新
    kf->k = kf->p / (kf->p + kf->r);         // 卡尔曼增益
    kf->x = kf->x + kf->k * (measurement - kf->x);  // 状态更新
    kf->p = (1.0f - kf->k) * kf->p;           // 协方差更新

    return kf->x;
}

// 使用示例:
// Kalman1D_t temp_kf;
// Kalman1D_Init(&temp_kf, 25.0f, 0.01f, 1.0f);  // Q 小 = 信任模型, R 大 = 不信任传感器
// float filtered = Kalman1D_Update(&temp_kf, adc_reading);

// 调参指南:
// Q 小 (0.001-0.1): 希望输出平滑、信模型 → 响应慢
// Q 大 (0.1-10):   允许快速响应 → 滤波效果弱
// R 小 (0.1-1.0):  信传感器 → 响应快、噪声大
// R 大 (10-100):   不信任传感器 → 平滑但滞后
```

### 带动态模型的一维卡尔曼

```c
// 如果系统有已知的动态模型 (如匀速运动)
typedef struct {
    float x, v;   // 位置 + 速度
    float p_xx, p_xv, p_vv;
    float q_pos, q_vel;
    float r;
    float dt;
} Kalman1D_Dynamic_t;

float Kalman1D_Dynamic_Update(Kalman1D_Dynamic_t *kf, float measurement) {
    // 预测: x = x + v*dt, v = v
    kf->x += kf->v * kf->dt;

    kf->p_xx += kf->dt * (2*kf->p_xv + kf->dt*kf->p_vv) + kf->q_pos;
    kf->p_xv += kf->dt * kf->p_vv;
    kf->p_vv += kf->q_vel;

    // 更新 (只观测位置)
    float s = kf->p_xx + kf->r;
    float kx = kf->p_xx / s;
    float kv = kf->p_xv / s;

    float residual = measurement - kf->x;
    kf->x += kx * residual;
    kf->v += kv * residual;

    kf->p_xx -= kx * kf->p_xx;
    kf->p_xv -= kx * kf->p_xv;
    kf->p_vv -= kv * kf->p_xv;

    return kf->x;
}
```

---

## 3. 多维卡尔曼滤波器

```c
// 2 状态 (位置 + 速度) 完整矩阵形式
// 使用 CMSIS-DSP 矩阵运算 (arm_mat_mult_f32 等)

#include "arm_math.h"

#define STATE_DIM  2
#define MEAS_DIM   1

typedef struct {
    float32_t X[STATE_DIM];               // 状态 [位置, 速度]
    float32_t P[STATE_DIM * STATE_DIM];   // 协方差 2×2
    float32_t F[STATE_DIM * STATE_DIM];   // 状态转移 2×2
    float32_t H[MEAS_DIM * STATE_DIM];    // 测量矩阵 1×2
    float32_t Q[STATE_DIM * STATE_DIM];   // 过程噪声 2×2
    float32_t R[MEAS_DIM * MEAS_DIM];     // 测量噪声 1×1
    float32_t dt;
} Kalman2D_t;

void Kalman2D_Init(Kalman2D_t *kf, float dt, float q_pos, float q_vel, float r) {
    kf->dt = dt;

    // F = [1  dt]
    //     [0   1]
    kf->F[0] = 1; kf->F[1] = dt;
    kf->F[2] = 0; kf->F[3] = 1;

    // H = [1  0]   (只测量位置)
    kf->H[0] = 1; kf->H[1] = 0;

    // Q = [q_pos  0   ]
    //     [0      q_vel]
    kf->Q[0] = q_pos; kf->Q[1] = 0;
    kf->Q[2] = 0;     kf->Q[3] = q_vel;

    // R = [r]
    kf->R[0] = r;

    // P = I (初始不确定性)
    kf->P[0] = 1; kf->P[1] = 0;
    kf->P[2] = 0; kf->P[3] = 1;

    kf->X[0] = 0; kf->X[1] = 0;
}

float Kalman2D_Update(Kalman2D_t *kf, float measurement) {
    arm_matrix_instance_f32 X, P, F, H, Q, R, temp1, temp2, K;

    // ... 使用 CMSIS-DSP 矩阵运算实现预测 + 更新 ...
    // 实际项目中更推荐展开计算 (见下文优化) 而非调用矩阵库

    return kf->X[0];
}
```

---

## 4. 嵌入式优化技巧

::: danger 嵌入式卡尔曼注意事项
完整的多维矩阵形式在 Cortex-M0/M3 上计算量很大。6 轴 EKF (四元数 4 + 陀螺零偏 3) 涉及 7×7 矩阵运算，M4 上约需 2-3ms。
:::

```c
// 技巧 1: 展开矩阵乘法 (避免 CMSIS-DSP 库开销)
// 2×2 展开后的预测步骤:
void Kalman2D_Predict_Unrolled(Kalman2D_t *kf) {
    // P = F·P·Fᵀ + Q, 手动展开 2×2
    float p00 = kf->P[0] + kf->dt * (kf->P[2] + kf->P[1] + kf->dt * kf->P[3]);
    float p01 = kf->P[1] + kf->dt * kf->P[3];
    float p11 = kf->P[3];

    kf->P[0] = p00 + kf->Q[0];
    kf->P[1] = p01;
    kf->P[2] = p01;
    kf->P[3] = p11 + kf->Q[3];

    kf->X[0] += kf->X[1] * kf->dt;  // x = x + v*dt
}

// 技巧 2: 使用对称性 (P 始终对称, 只存上三角)
// P 从 4 个 float 减到 3 个, 所有运算减少 25%

// 技巧 3: 固定点 (Q 格式) 实现
// 协方差矩阵使用 Q16.16 定点数, 避免浮点
// 注意: 需要仔细跟踪小数点, 防止溢出

// 技巧 4: 协方差上限
// 长时间运行 P 可能因数值误差发散或趋于 0
kf->p = fmaxf(kf->p, 1e-6f);   // 下限, 防止增益卡死
kf->p = fminf(kf->p, 1000.0f); // 上限, 防止溢出
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 滤波后信号严重滞后 | Q 太小 (太信模型) | 增大 Q (如从 0.001 → 0.1) |
| 2 | 滤波后噪声仍大 | R 太小 (太信传感器) | 增大 R |
| 3 | 增益 K 收敛到 0 (滤波死锁) | P 因数值问题趋零 | 加 P 下限 `fmaxf(P, 1e-6)` |
| 4 | 协方差矩阵变非对称/负定 | 数值舍入误差累积 | 强制对称: `P=(P+Pᵀ)/2`；用 Joseph 形式更新 |
| 5 | 状态发散 (估计值无限大) | Q 太大 或 模型不稳定 | 检查 F 矩阵特征值; 降低 Q |
| 6 | 内存不足 (多维 KF) | 多维矩阵占用大量 RAM | 展开矩阵运算; 只用上三角; 降维 |

---

## 6. 参考文档

1. R. E. Kalman, "A New Approach to Linear Filtering and Prediction Problems" (1960)
2. "An Introduction to the Kalman Filter" — G. Welch, G. Bishop (UNC Chapel Hill)
3. "Kalman and Bayesian Filters in Python" — Roger Labbe: https://github.com/rlabbe/Kalman-and-Bayesian-Filters-in-Python
4. "Embedded Kalman Filter" — Simon D. Levy (GitHub)
5. ST SensorTile Kalman 例程
