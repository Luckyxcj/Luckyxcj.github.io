# PID 控制算法

> **文档说明**：本文档基于经典控制理论和嵌入式 PID 实现经验，涵盖标准/增量式 PID、参数整定和抗积分饱和。

---

## 目录

1. [PID 基础](#1-pid-基础)
2. [标准位置式 PID](#2-标准位置式-pid)
3. [增量式 PID](#3-增量式-pid)
4. [抗积分饱和与实用改进](#4-抗积分饱和与实用改进)
5. [参数整定方法](#5-参数整定方法)
6. [常见问题与排查](#6-常见问题与排查)
7. [参考文档](#7-参考文档)

---

## 1. PID 基础

PID (Proportional-Integral-Derivative) 是最广泛使用的反馈控制器。

```
PID 控制器框图:

                  ┌─────────┐
r(t) → (+) → e(t) →│ PID     │→ u(t) → 被控对象 → y(t)
        ↑          └─────────┘              │
        │                                   │
        └──────────── 负反馈 ────────────────┘

e(t) = r(t) - y(t)    (误差 = 设定值 - 实际值)

P 项: Kp × e(t)       → 比例: 对当前误差做出反应
I 项: Ki × ∫e(t)·dt  → 积分: 消除稳态误差 (积累历史误差)
D 项: Kd × de(t)/dt   → 微分: 预测未来趋势 (抑制超调)
```

---

## 2. 标准位置式 PID

```c
// 位置式 PID (计算输出绝对值)
typedef struct {
    float Kp, Ki, Kd;       // 增益
    float setpoint;          // 设定值
    float integral;          // 积分累加器
    float prev_error;        // 上一次误差 (微分用)
    float integral_limit;    // 积分限幅
    float output_limit;      // 输出限幅
} PID_t;

void PID_Init(PID_t *pid, float Kp, float Ki, float Kd,
              float i_limit, float out_limit) {
    pid->Kp = Kp; pid->Ki = Ki; pid->Kd = Kd;
    pid->integral = 0; pid->prev_error = 0;
    pid->integral_limit = i_limit;
    pid->output_limit = out_limit;
}

float PID_Compute(PID_t *pid, float measurement, float dt) {
    // 1. 计算误差
    float error = pid->setpoint - measurement;

    // 2. 积分项 (带限幅)
    pid->integral += error * dt;
    if (pid->integral > pid->integral_limit)
        pid->integral = pid->integral_limit;
    else if (pid->integral < -pid->integral_limit)
        pid->integral = -pid->integral_limit;

    // 3. 微分项 (对测量值微分，减少设定值跳变引起的微分冲击)
    float derivative = -(measurement - pid->prev_measurement) / dt;
    pid->prev_error = error;

    // 4. 计算输出
    float output = pid->Kp * error
                 + pid->Ki * pid->integral
                 + pid->Kd * derivative;

    // 5. 输出限幅
    if (output > pid->output_limit) output = pid->output_limit;
    if (output < -pid->output_limit) output = -pid->output_limit;

    return output;
}
```

---

## 3. 增量式 PID

```c
// 增量式 PID (只计算输出的变化量)
// 优点: 无积分饱和、输出平滑、从手动到自动切换无冲击
float PID_Compute_Incremental(PID_t *pid, float measurement) {
    float error = pid->setpoint - measurement;

    // Δu = Kp×(e_k - e_{k-1}) + Ki×e_k×dt + Kd×(e_k - 2e_{k-1} + e_{k-2})
    float delta = pid->Kp * (error - pid->prev_error)
                + pid->Ki * error * pid->dt
                + pid->Kd * (error - 2.0f * pid->prev_error + pid->prev_prev_error);

    pid->prev_prev_error = pid->prev_error;
    pid->prev_error = error;
    pid->output += delta;

    // 输出限幅
    if (pid->output > pid->output_limit) pid->output = pid->output_limit;
    if (pid->output < -pid->output_limit) pid->output = -pid->output_limit;

    return pid->output;
}
```

---

## 4. 抗积分饱和与实用改进

### 4.1 积分分离

当误差很大时暂停积分，防止积分项过度积累：

```c
#define ERROR_THRESHOLD 10.0f

if (fabsf(error) < ERROR_THRESHOLD) {
    pid->integral += error * dt;  // 只在误差小时积分
}
```

### 4.2 微分先行

对测量值而非误差进行微分，避免设定值跳变时微分冲击：

```c
float derivative = (pid->prev_measurement - measurement) / dt;
pid->prev_measurement = measurement;
```

### 4.3 死区控制

当误差很小时不输出，避免微小波动引起执行器抖动：

```c
#define DEADBAND 0.5f
if (fabsf(error) < DEADBAND) {
    return 0;  // 死区内不输出
}
```

---

## 5. 参数整定方法

### 5.1 Ziegler-Nichols 法

```
步骤:
1. Ki=0, Kd=0
2. 逐步增大 Kp, 直到系统开始等幅振荡
3. 记录此时的 Kp_critical 和振荡周期 T_critical
4. 根据公式计算:

控制类型     Kp              Ki             Kd
  P         0.5×Kp_crit      -              -
  PI        0.45×Kp_crit    0.54×Kp_crit/T_crit   -
  PID       0.6×Kp_crit     1.2×Kp_crit/T_crit    0.075×Kp_crit×T_crit
```

### 5.2 经验法 (调参顺序)

```
P 项: 先只加 P, 增大直到有快速响应但有少许超调
I 项: 再增加 I, 消除稳态误差 (I 不要太大会导致振荡)
D 项: 最后增加 D, 减少超调和振荡 (D 对噪声敏感)
```

---

## 6. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 输出持续振荡 | P 太大或 I 太大或二者组合不当 | 降低 P 或 I |
| 2 | 响应太慢 | P 太小 | 增大 P |
| 3 | 有稳态误差 | I 太小或没有 I 项 | 增加 I 增益 |
| 4 | 积分饱和 (输出一直最大) | 误差长时间不消除，积分累加过大 | 加积分限幅；或使用增量式 PID |
| 5 | 微分项噪声放大 | D 对高频噪声敏感 | 加低通滤波 (滤波系数 0.1-0.3) |

---

## 7. 参考文档

1. "PID Control System Analysis and Design" — Li, Ang & Chong
2. Åström & Hägglund, "PID Controllers: Theory, Design, and Tuning"
3. Ziegler-Nichols Tuning Rules — 1942 年原始论文
4. "Signal Sampling, Filtering, and PID Control" — Brett Beauregard blog
