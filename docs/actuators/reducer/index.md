# 减速器选型计算

> **文档说明**：本文档基于减速器设计手册、机器人关节传动选型及实践经验整理。

---

## 目录

1. [减速器基础](#1-减速器基础)
2. [选型计算流程](#2-选型计算流程)
3. [减速器类型详解](#3-减速器类型详解)
4. [背隙与刚度](#4-背隙与刚度)
5. [常见问题](#5-常见问题)

---

## 1. 减速器基础

减速器降低转速、增大转矩，是电机和执行机构之间的关键传动元件。

```
为什么需要减速器:

  电机 (高速低扭)         减速器         负载 (低速高扭)
  ┌──────────┐        ┌──────────┐      ┌──────────┐
  │  10000 RPM │──→   │  100:1   │──→   │  100 RPM  │
  │  0.3 N·m   │       │          │      │  ~27 N·m  │
  └──────────┘        └──────────┘      └──────────┘
                       (η=90%)

  输出转速 = 电机转速 / 减速比
  输出转矩 = 电机转矩 × 减速比 × 效率
```

| 类型 | 减速比范围 | 效率 | 背隙 | 应用 |
|------|----------|------|------|------|
| 直齿轮 | 3:1 ~ 60:1 | ~70% | 大 (10-30 arcmin) | 普通传动 |
| 行星齿轮 | 3:1 ~ 100:1 | ~90% | 小 (3-8 arcmin) | 伺服/机器人 |
| 谐波减速器 | 50:1 ~ 160:1 | ~70% | 极小 (<1 arcmin) | 机器人关节 |
| RV 减速器 | 30:1 ~ 200:1 | ~85% | 极小 (<1 arcmin) | 工业机器人基座 |
| 蜗轮蜗杆 | 10:1 ~ 60:1 | ~40-60% | 大 | 自锁/重载 |
| 摆线针轮 | 30:1 ~ 100:1 | ~90% | 小 | 高扭矩精密 |

---

## 2. 选型计算流程

```
选型步骤:

  1. 确定负载需求
     ├─ 最大输出转矩 T_out (N·m)
     ├─ 最大输出转速 n_out (RPM)
     ├─ 惯量比 J_load/J_motor ≤ 5~10
     └─ 精度要求 (背隙 arcmin)

  2. 预选减速比
     i = n_motor / n_out
     同时满足: i ≥ T_out / (T_motor × η)

  3. 校核
     ├─ 额定转矩 ≥ 负载转矩
     ├─ 峰值转矩 ≥ 最大冲击转矩
     ├─ 输入转速 ≤ 额定输入转速
     └─ 惯量匹配 (避免谐振)

  4. 考虑环境因素
     ├─ 工作温度
     ├─ 防护等级 (IP)
     └─ 安装方式 (法兰/轴/底座)
```

### 惯量匹配

```
惯量比 = 负载惯量 (折算到电机轴) / 电机转子惯量

  负载折算: J_load_motor = J_load / i²

  推荐惯量比:
    - 一般伺服: ≤ 10:1
    - 高精度伺服: ≤ 5:1
    - 步进电机: ≤ 2:1 (开环)

  惯量比过大 → 系统振荡、难以调节
```

```c
// 减速器选型计算代码
typedef struct {
    float motor_power;       // W
    float motor_speed;       // RPM
    float motor_torque;      // N·m (额定)
    float motor_peak_torque; // N·m (峰值)
    float motor_inertia;     // kg·cm² (转子惯量)
} MotorSpec_t;

typedef struct {
    float load_torque;       // N·m (连续)
    float load_peak_torque;  // N·m (峰值)
    float load_speed;        // RPM
    float load_inertia;      // kg·cm² (负载惯量)
} LoadSpec_t;

typedef struct {
    float ratio;
    float efficiency;
    float rated_torque;
    float peak_torque;
    float max_input_speed;
    float backlash;          // arcmin
    float inertia;           // kg·cm² (减速器自身惯量)
} ReducerSpec_t;

uint8_t Reducer_Select(MotorSpec_t *m, LoadSpec_t *l,
                        ReducerSpec_t *r, ReducerSpec_t *result) {
    // 1. 初算减速比
    float ratio_ideal = m->motor_speed / l->load_speed;
    float ratio_torque = l->load_torque / (m->motor_torque * 0.85f);

    // 2. 校核
    if (r->rated_torque < l->load_torque) return 1;
    if (r->peak_torque < l->load_peak_torque) return 2;
    if (m->motor_speed > r->max_input_speed) return 3;

    // 3. 惯量匹配
    float load_inertia_ref = l->load_inertia / (r->ratio * r->ratio);
    float inertia_ratio = load_inertia_ref / m->motor_inertia;
    if (inertia_ratio > 10) return 4;

    *result = *r;
    return 0;
}
```

---

## 3. 减速器类型详解

### 行星减速器

```
行星减速器结构:

      ┌─┐ ┌─┐
    ┌─┤⊙├─┤⊙├─┐  ← 行星轮 (3 个, 均布)
    │ └─┘ └─┘ │
    │ 太阳轮    │
    └──────────┘
    ┌──────────┐
    │   外齿圈   │
    └──────────┘

  优点: 高精度、高刚性、高效率
  代表: Alpha, Neugart, Apex Dynamics, Shimpo
```

### 谐波减速器

```
谐波减速器三元件:

  ┌────────────┐
  │    波发生器  │ ← 椭圆凸轮 + 薄壁轴承 (输入)
  │ ┌──┐ ┌──┐ │
  │ │⊙ │ │⊙ │ │
  │ └──┘ └──┘ │
  └─────────┬──┘
        ┌───┴───┐
        │   柔轮  │ ← 薄壁弹性件, 带外齿 (输出)
        └───┬───┘
        ┌───┴───┐
        │   刚轮  │ ← 刚性内齿圈 (固定)
        └───────┘

  优点: 零背隙、轻量、极高减速比
  代表: Harmonic Drive, LeaderDrive (绿的谐波)
```

---

## 4. 背隙与刚度

```
背隙 (Backlash):

  输入轴→自由转动一个小角度 →→→→→→出力
                        ↑
                        └── 背隙角度 (arcmin)

  1 arcmin = 1/60 度

  影响:
  - 1 arcmin @ 1m 臂长 → ~0.29mm 末端误差
  - 换向时产生冲击
  - 影响定位精度

扭转刚度 (Torsional Stiffness):

  K = ΔT / Δθ  (N·m/arcmin)

  刚度越低 → 负载变化引起更大角变形 → 精度下降、振动
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 行星减速器噪音大 | 齿隙过大或润滑不良 | 换高精度等级 (如 3 arcmin→1 arcmin) |
| 2 | 谐波减速器随使用时间背隙增大 | 柔轮疲劳磨损 | 检查运行时间 (额定寿命 ~10000h); 定期更换 |
| 3 | 小负载时电机过热 | 减速器效率低 (如蜗轮蜗杆仅 40%) | 换行星或摆线减速器 (>85%) |
| 4 | 负载侧振动/谐振 | 惯量比过大 | 用更大惯量电机; 降低加速斜坡 |
| 5 | 减速器漏油 | 密封圈老化 / 安装不当 | 定期更换密封件; 确认安装方向 |
| 6 | 计算减速比时忽略效率 | 理论转矩不够 → 选型偏小 | 始终乘效率系数: T_out = T_motor × i × 0.85 |

---

## 6. 参考文档

1. "Precision Gearheads Selection Guide" — Neugart / Alpha Gear
2. "Harmonic Drive Engineering Guide": https://www.harmonicdrive.net/support/technical-documentation
3. "Servo Motor/Reducer Sizing" — Mitsubishi / Panasonic / Yaskawa 选型手册
4. 谐波减速器国标: GB/T 30819-2014
5. "Gear Design and Application" — Nicholas P. Chironis
