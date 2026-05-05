# 传感器融合

> **文档说明**：本文档基于 Mahony 互补滤波、Madgwick AHRS、扩展卡尔曼滤波 (EKF) 及相关开源实现整理。

---

## 目录

1. [传感器融合基础](#1-传感器融合基础)
2. [互补滤波器](#2-互补滤波器)
3. [Mahony AHRS 算法详解](#3-mahony-ahrs-算法详解)
4. [Madgwick AHRS 算法](#4-madgwick-ahrs-算法)
5. [EKF 九轴融合](#5-ekf-九轴融合)
6. [常见问题](#6-常见问题)

---

## 1. 传感器融合基础

使用单一传感器估计姿态存在根本性局限，需要融合多种传感器互补优势。

```
传感器特性对比:

           低频          高频       长期稳定性
  加速度计  ████████████  ░░░░░░░░░░  ██████████ (无漂移, 噪声大)
  陀螺仪    ░░░░░░░░░░░░  ██████████  ░░░░░░░░░░ (有漂移, 短期精确)
  磁力计    ████████████  ░░░░░░░░░░  ██████████ (Yaw 绝对参考)

  融合思路:
  陀螺仪 → 高频姿态更新 (积分角速度)
  加速度计 + 磁力计 → 低频漂移校正 (重力/地磁参考)
```

```
融合算法对比:

| 算法 | 计算量 | 精度 | 磁力计支持 | 适用平台 |
|------|--------|------|-----------|---------|
| 互补滤波 | 极小 | 中 | 可选 | M0/M3 |
| Mahony | 小 | 良 | 支持 | M3/M4 |
| Madgwick | 小 | 良 | 支持 | M3/M4 |
| EKF (9轴) | 大 | 优 | 支持 | M4/M7 |
```

---

## 2. 互补滤波器

互补滤波是最简单的传感器融合方式，利用加速度计低频特性 + 陀螺仪高频特性互补。

```
姿态角 = α × (陀螺仪积分角) + (1-α) × (加速度计测量角)

频域特性:
  陀螺仪:    高通 ───────╱
  加速度计:  低通 ╲──────
  融合:      ╲────╱────   (全通)
```

```c
// 最简单的一阶互补滤波 (仅 Roll/Pitch)
#define ALPHA  0.98f  // 陀螺仪权重 (0.9~0.99)

float roll, pitch;

void ComplementaryFilter(float gx, float gy, float gz,
                         float ax, float ay, float az,
                         float dt) {
    // 从加速度计计算角度
    float accel_roll  = atan2f(ay, az);
    float accel_pitch = atan2f(-ax, sqrtf(ay*ay + az*az));

    // 陀螺仪积分 + 加速度计加权
    roll  = ALPHA * (roll + gx * dt) + (1.0f - ALPHA) * accel_roll;
    pitch = ALPHA * (pitch + gy * dt) + (1.0f - ALPHA) * accel_pitch;
}
```

::: danger 互补滤波局限
- 仅在俯仰角 < ±90° 可用 (欧拉角万向锁)
- 无法修正偏航 (Yaw) — 加速度计不提供 Yaw 参考
- 需要磁力计来修正 Yaw
:::

---

## 3. Mahony AHRS 算法详解

Mahony 算法使用**四元数**表示姿态，通过 PI 控制器将加速度计/磁力计测量值与预估值做差，修正陀螺仪角速度。

```
Mahony 算法流程:

  陀螺仪(gx,gy,gz)
      │
      ├──→ [四元数积分] ──→ 姿态四元数(q0,q1,q2,q3)
      │         ↑                    │
      │         │ 修正角速度          │ 预估重力/地磁方向
      │    ┌────┴────┐               ↓
      │    │ PI 控制器 │←── 叉积(误差) ←──┬── 加速度计
      │    └─────────┘                   └── 磁力计 (可选)
      │
      └──→ (原始角速度 + PI 修正) → 四元数更新
```

完整代码参见 [IMU 传感器文档](../../sensors/imu.md#3-姿态解算算法) 中的 Mahony 实现。

### 关键参数调节

```c
// Kp (比例增益): 收敛到加速度计的速度
// 太大 → 加速度计噪声引入姿态
// 太小 → 陀螺仪漂移修正慢
#define Kp  2.0f    // 推荐: 0.5 ~ 5.0

// Ki (积分增益): 补偿陀螺仪常值零偏
// 0 = 不补偿零偏 (多数场景够用)
// >0 = 自动估计并补偿零偏
#define Ki  0.0f    // 推荐: 0 ~ 0.01
```

---

## 4. Madgwick AHRS 算法

Madgwick 算法与 Mahony 类似，但使用**梯度下降法**代替 PI 控制器来最小化误差。

```c
// Madgwick AHRS (仅 IMU, 无磁力计版本)
// 参考: https://github.com/xioTechnologies/Fusion
#define BETA  0.1f  // 梯度下降步长 (对应 Mahony 的 Kp)

void MadgwickAHRSupdate(float gx, float gy, float gz,
                         float ax, float ay, float az,
                         float dt) {
    float q0 = 1, q1 = 0, q2 = 0, q3 = 0;  // 初始四元数
    float recipNorm;
    float s0, s1, s2, s3;
    float qDot1, qDot2, qDot3, qDot4;

    // 归一化加速度计
    recipNorm = 1.0f / sqrtf(ax*ax + ay*ay + az*az);
    ax *= recipNorm; ay *= recipNorm; az *= recipNorm;

    // 梯度下降法计算误差梯度
    // 目标函数: f = [2(q1q3-q0q2)-ax, 2(q0q1+q2q3)-ay, 2(0.5-q1^2-q2^2)-az]
    // 雅可比: J = ∂f/∂q
    float f_1 = 2.0f * (q1*q3 - q0*q2) - ax;
    float f_2 = 2.0f * (q0*q1 + q2*q3) - ay;
    float f_3 = 2.0f * (0.5f - q1*q1 - q2*q2) - az;

    // 梯度 = Jᵀ·f (展开结果):
    s0 = -4.0f*q2*f_1 + 4.0f*q1*f_2;
    s1 =  4.0f*q3*f_1 + 4.0f*q0*f_2 - 8.0f*q1*f_3;
    s2 = -4.0f*q0*f_1 + 4.0f*q3*f_2 - 8.0f*q2*f_3;
    s3 =  4.0f*q1*f_1 + 4.0f*q2*f_2;

    // 归一化梯度
    recipNorm = 1.0f / sqrtf(s0*s0 + s1*s1 + s2*s2 + s3*s3);
    s0 *= recipNorm; s1 *= recipNorm;
    s2 *= recipNorm; s3 *= recipNorm;

    // 四元数导数 = 0.5*q⊗ω - β*∇f/|∇f|
    qDot1 = 0.5f * (-q1*gx - q2*gy - q3*gz) - BETA * s1;
    qDot2 = 0.5f * ( q0*gx + q2*gz - q3*gy) - BETA * s2;
    qDot3 = 0.5f * ( q0*gy - q1*gz + q3*gx) - BETA * s3;
    qDot4 = 0.5f * ( q0*gz + q1*gy - q2*gx) - BETA * s0;

    // 积分
    q0 += qDot1 * dt; q1 += qDot2 * dt;
    q2 += qDot3 * dt; q3 += qDot4 * dt;

    // 归一化
    recipNorm = 1.0f / sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    q0 *= recipNorm; q1 *= recipNorm;
    q2 *= recipNorm; q3 *= recipNorm;
}
```

### Mahony vs Madgwick

| 特性 | Mahony | Madgwick |
|------|--------|----------|
| 误差最小化方法 | PI 控制器 | 梯度下降 |
| 参数 | Kp, Ki (直观) | β (不直观) |
| 计算量 (无磁力计) | ~180 浮点运算 | ~280 浮点运算 |
| 动态响应 | 稍慢 | 较快 |
| 磁场干扰鲁棒 | 好 | 较好 |

---

## 5. EKF 九轴融合

扩展卡尔曼滤波 (EKF) 是精度最高的融合算法，适用于 M4/M7 等高性能 MCU。

```
EKF 九轴融合状态向量 (10 维):
  X = [q0, q1, q2, q3,  bx, by, bz,  mx_bias, my_bias, mz_bias]
        └── 姿态 ──┘  └── 陀螺零偏 ──┘  └── 磁干扰 ─────┘

  过程模型: 四元数运动学 (非线性)
  观测模型:
    - 加速度计: h_acc(q) = C_nb(q) · g  (旋转到机体坐标系的重力)
    - 磁力计:   h_mag(q) = C_nb(q) · m_ref

  线性化 → 雅可比矩阵 → 标准 EKF 更新
```

::: tip 实际选择建议
90% 的 IMU 应用用 Mahony 或 Madgwick 就足够了。仅在以下场景考虑 EKF：
- 高动态 (无人机飞控、赛车)
- 需要在线估计陀螺仪零偏
- 有磁力计且需要抗磁干扰
:::

---

## 6. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 静止时角度仍在漂移 | 陀螺仪零偏未校准 | 启动时静止校准 (取 100 样本求均值) |
| 2 | 快速运动时角度错误 | 加速度计测量了运动加速度 (非重力) | 降低 Kp/β (减少加速度计权重) |
| 3 | Yaw 漂移 (无磁力计) | 加速度计无法修正 Yaw | 加磁力计; 或使用 GPS 双天线 |
| 4 | 有磁力计时 Yaw 跳变 | 铁磁干扰 (电机、金属框架) | 磁力计校准 (椭球拟合); 增加磁干扰检测 |
| 5 | Mahony 浮点运算太慢 (M0/M3) | 软浮点开销大 | 使用定点数 Q15/Q31 实现 |
| 6 | 四元数模长偏离 1 | 数值积分误差 | 每次更新后归一化 |

---

## 7. 参考文档

1. Mahony AHRS 论文: "Nonlinear Complementary Filters on the Special Orthogonal Group" (Mahony et al., 2008)
2. Madgwick AHRS 论文: "An efficient orientation filter for IMU and MARG arrays" (Madgwick, 2010)
3. Mahony 开源实现: https://github.com/xioTechnologies/Mahony-AHRS
4. "Quaternion kinematics for the error-state Kalman filter" — Joan Solà (arXiv:1711.02508)
5. "Sensor Fusion and Object Tracking" — Gustaf Hendeby
