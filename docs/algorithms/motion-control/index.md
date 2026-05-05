# 运动控制算法

> **文档说明**：本文档基于工业运动控制理论、嵌入式步进/伺服电机驱动实践经验整理。

---

## 目录

1. [运动控制基础](#1-运动控制基础)
2. [梯形加减速曲线](#2-梯形加减速曲线)
3. [S 曲线加减速](#3-s-曲线加减速)
4. [电子齿轮与追剪](#4-电子齿轮与追剪)
5. [常见问题](#5-常见问题)

---

## 1. 运动控制基础

运动控制的核心是在给定约束（最大速度、加速度、Jerk）下，生成平滑的位置/速度曲线。

```
速度曲线类型:

  梯形曲线:             S 形曲线:
  v                     v
  │    ┌─────┐          │    ╭─────╮
  │   ╱       ╲         │   ╱       ╲
  │  ╱         ╲        │  ╱         ╲
  │ ╱           ╲       │ ╱           ╲
  └┴─────────────→ t    └┴─────────────→ t
   T1  T2  T3            起 匀 减 停
   加速 匀速 减速            (Jerk 连续)
```

| 曲线 | 优点 | 缺点 | 适用 |
|------|------|------|------|
| 梯形 | 实现简单、计算快 | 启动/结束有冲击 (Jerk → ∞) | 低刚度负载、低速 |
| S 形 | 冲击小、平滑 | 计算量大、耗时略长 | CNC、高精定位 |
| sin² | 无冲击、无振动 | 计算复杂 | 柔性机构、相机定位 |

---

## 2. 梯形加减速曲线

```c
// 梯形速度规划器
// 输入: 目标位置、最大速度、加速度
// 输出: 每周期 (dt) 的位置增量

typedef enum {
    PHASE_ACCEL,    // 加速
    PHASE_CONST,    // 匀速
    PHASE_DECEL     // 减速
} ProfilePhase_t;

typedef struct {
    int32_t target_pos;       // 目标位置 (步)
    int32_t current_pos;      // 当前位置
    float   current_vel;      // 当前速度 (步/秒)
    float   max_vel;          // 最大速度
    float   accel;            // 加速度 (步/秒²)
    float   decel_start;      // 开始减速的位置
    ProfilePhase_t phase;
} TrapezoidalPlanner_t;

void Trapezoidal_Init(TrapezoidalPlanner_t *tp, int32_t target,
                       float max_vel, float accel) {
    tp->target_pos = target;
    tp->current_pos = 0;
    tp->current_vel = 0;
    tp->max_vel = max_vel;
    tp->accel = accel;
    tp->phase = PHASE_ACCEL;

    // 计算减速距离: d = v² / (2a)
    float decel_dist = (max_vel * max_vel) / (2.0f * accel);
    tp->decel_start = target - decel_dist;
    if (tp->decel_start < 0) {
        // 行程太短，达不到最大速度 → 三角形曲线
        tp->decel_start = target / 2;
        tp->max_vel = sqrtf(accel * tp->decel_start);
    }
}

// 每 dt 调用一次, 返回位置增量 (用于更新 PWM/脉冲输出)
int32_t Trapezoidal_Update(TrapezoidalPlanner_t *tp, float dt) {
    switch (tp->phase) {
    case PHASE_ACCEL:
        tp->current_vel += tp->accel * dt;
        if (tp->current_vel >= tp->max_vel) {
            tp->current_vel = tp->max_vel;
            tp->phase = PHASE_CONST;
        }
        if (tp->current_pos >= tp->decel_start) {
            tp->phase = PHASE_DECEL;
        }
        break;

    case PHASE_CONST:
        if (tp->current_pos >= tp->decel_start) {
            tp->phase = PHASE_DECEL;
        }
        break;

    case PHASE_DECEL:
        tp->current_vel -= tp->accel * dt;
        if (tp->current_vel <= 0) {
            tp->current_vel = 0;
        }
        break;
    }

    int32_t delta = (int32_t)(tp->current_vel * dt);
    tp->current_pos += delta;

    // 接近目标时的微调 (避免过冲)
    if (tp->current_pos >= tp->target_pos) {
        tp->current_vel = 0;
        tp->phase = PHASE_DECEL;
        return tp->target_pos - (tp->current_pos - delta);
    }

    return delta;
}
```

### Bresenham 直线插补

```c
// 多轴同步: 使用 Bresenham 算法确保两轴同时到达
void LinearInterpolation(int32_t dx, int32_t dy) {
    int32_t steps = abs(dx) > abs(dy) ? abs(dx) : abs(dy);
    int32_t err_x = 0, err_y = 0;

    for (int32_t i = 0; i < steps; i++) {
        err_x += abs(dx);  // 累加
        err_y += abs(dy);

        if (err_x >= steps) {
            StepX(dx > 0 ? 1 : -1);
            err_x -= steps;
        }
        if (err_y >= steps) {
            StepY(dy > 0 ? 1 : -1);
            err_y -= steps;
        }
    }
}
```

---

## 3. S 曲线加减速

S 曲线在梯形曲线基础上增加了 Jerk (加加速度) 约束，使加速度连续变化。

```
S 曲线七段式规划:

  a (加速度)
  │
  │  ╱‾‾‾‾╲            ╱‾‾‾‾╲
  │ ╱      ╲          ╱      ╲
  │╱        ╲────────╱        ╲─────
  └─────────────────────────────→ t
   加加 匀加 减加  匀速  加减 匀减 减减
```

```c
// S 曲线简化实现 (sin² 平滑, 单段计算)
// 归一化 S 曲线 (0→1 的平滑过渡)
float SCurve_Profile(float t, float T) {
    // t: 当前时间, T: 总时间
    if (t >= T) return 1.0f;
    if (t <= 0) return 0.0f;

    // sin² 平滑: P(t) = (t/T) - sin(2π·t/T) / (2π)
    float ratio = t / T;
    return ratio - sinf(2.0f * M_PI * ratio) / (2.0f * M_PI);
}

// 使用 S 曲线进行步进电机位置控制
float SCurve_Position(float t, float T, float total_steps) {
    return total_steps * SCurve_Profile(t, T);
}

// 定时器中断中 (如 20kHz):
void TIM_ISR(void) {
    static float t = 0;
    float pos = SCurve_Position(t, move_time, target_steps);
    int32_t step_now = (int32_t)pos;
    int32_t delta = step_now - last_step;
    // 发出 delta 个脉冲
    last_step = step_now;
    t += 0.00005f;  // 50μs
    if (t >= move_time) t = 0;  // 运动完成
}
```

---

## 4. 电子齿轮与追剪

### 电子齿轮 (Electronic Gearing)

主轴编码器脉冲 → 从轴按比例跟随运动，替代机械齿轮。

```c
// 电子齿轮跟随
// 主轴每 1 个脉冲 → 从轴移动 ratio 个脉冲
typedef struct {
    int32_t master_accum;   // 主轴累积脉冲
    int32_t slave_accum;    // 从轴累积脉冲
    float   gear_ratio;     // 齿轮比 (从轴/主轴)
} ElectronicGear_t;

void ElectronicGear_Update(int32_t master_delta) {
    static ElectronicGear_t eg;

    eg.master_accum += master_delta;
    int32_t slave_target = (int32_t)(eg.master_accum * eg.gear_ratio);
    int32_t slave_delta = slave_target - eg.slave_accum;
    eg.slave_accum += slave_delta;

    // 输出 slave_delta 个脉冲到从轴驱动器
    StepMotor(SLAVE_AXIS, slave_delta);
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 步进电机启动时堵转 | 启动频率太高 (加速度过大) | 降低加速度或初始频率 |
| 2 | 定位完成后有残余振动 | 停止时无减振处理 | 加停止阻尼 (末端降速); 或使用 S 曲线 |
| 3 | 高速时丢步 | 脉冲频率超过电机最大响应频率 | 检查手册; 升电压; 降低期望速度 |
| 4 | 梯形曲线末端过冲 | dt 离散化导致位置超限 | 在接近目标时用距离递减代替速度控制 |
| 5 | 多轴不同步 (一轴先到) | 插补算法不对 | 使用 Bresenham 或 DDA 插补 |
| 6 | S 曲线计算占用太多 CPU | 浮点 sin/cos 开销大 | 使用查表法 (S 曲线预计算); 降低 ISR 频率 |
| 7 | 编码器反馈不符预期 | 编码器方向反或齿轮比误差 | 确认 A/B 相序; 校准齿轮比 |

---

## 6. 参考文档

1. "Trajectory Planning for Automatic Machines and Robots" — Biagiotti & Melchiorri
2. "Bresenham's Line Algorithm" — J. Bresenham (1965)
3. Trinamic Motion Control Application Notes: https://www.trinamic.com/technology/
4. "步进电机加减速控制" — 野火/正点原子嵌入式教程
5. LinuxCNC Trajectory Planner 文档
