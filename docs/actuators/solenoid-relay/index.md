# 电磁阀与继电器驱动

> **文档说明**：本文档基于继电器/电磁阀驱动电路设计规范及嵌入式工业控制实战经验整理。

---

## 目录

1. [继电器驱动](#1-继电器驱动)
2. [电磁阀驱动](#2-电磁阀驱动)
3. [感性负载保护](#3-感性负载保护)
4. [常见问题](#4-常见问题)

---

## 1. 继电器驱动

继电器是通过低电压/小电流控制高电压/大电流的电气开关。

```
继电器驱动电路 (NPN 三极管):

  MCU GPIO ──[1kΩ]──┤├─── GND
                     │ (NPN, 如 2N2222 / S8050)
  VCC ────[续流二极管]─────── 继电器线圈 ────┤C
         (1N4148, 反接)                     │E
                                            GND

  GPIO 高 → 三极管导通 → 线圈通电 → 触点吸合
  GPIO 低 → 三极管截止 → 续流二极管泄放 → 触点断开
```

```c
// 继电器控制 (GPIO 驱动)
#define RELAY_PORT  GPIOA
#define RELAY_PIN   GPIO_PIN_4

void Relay_Init(void) {
    GPIO_InitTypeDef gpio = {0};
    gpio.Mode = GPIO_MODE_OUTPUT_PP;
    gpio.Pin  = RELAY_PIN;
    gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(RELAY_PORT, &gpio);
}

void Relay_On(void)  { HAL_GPIO_WritePin(RELAY_PORT, RELAY_PIN, GPIO_PIN_SET); }
void Relay_Off(void) { HAL_GPIO_WritePin(RELAY_PORT, RELAY_PIN, GPIO_PIN_RESET); }
```

### 继电器选型参数

| 参数 | 说明 | 示例 |
|------|------|------|
| 线圈电压 | 驱动电压 | 5V / 12V / 24V |
| 触点形式 | 常开/常闭/转换 | SPST(单刀单掷), SPDT(单刀双掷) |
| 触点容量 | 最大开关能力 | 10A @ 250VAC |
| 线圈电流 | 驱动功耗 | ~70mA @ 5V (SRD-05VDC) |

### 固态继电器 (SSR)

```
SSR 与机械继电器对比:

| 特性 | 机械继电器 | SSR |
|------|----------|-----|
| 开关速度 | 慢 (~10ms) | 快 (<1ms) |
| 寿命 | 有限 (10万-100万次) | 无限 (无磨损) |
| 噪音 | 有 (咔嗒声) | 无 |
| 漏电流 | 无 | 有 (~mA) |
| 电压降 | 极小 | ~1V |
| 适用场景 | 通用 | 频繁开关/静音 |

SSR 驱动: 3-32VDC 输入 → 直接 MCU GPIO + 限流电阻 (~300Ω)
```

---

## 2. 电磁阀驱动

电磁阀通过电磁线圈驱动阀芯动作，实现流体 (气/液) 通断控制。

```
电磁阀驱动电路 (MOSFET 低边驱动):

  MCU GPIO ──[100Ω]──┤G  N-MOSFET (IRFZ44N / AOD4184)
                      └─S── GND
  VCC ────[续流二极管]─────── 电磁阀线圈 ────┤D
         (1N4007 / TVS)                    (漏极)

  GPIO PWM → 可调节占空比控制电磁阀开度 (比例阀)
```

```c
// 电磁阀 PWM 控制 (TIM 输出 PWM)
void Solenoid_SetPWM(uint16_t duty) {
    // 注意: 电磁阀启动时需要 100% 占空比克服静摩擦, 然后降到保持电流
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, duty);
}
```

### 峰值保持 (Peak & Hold)

```
电磁阀电流控制:

  I
  │  ┌────┐
  │  │Peak│──────┐
  │  │100%│ Hold │
  │  └────┘ 30%  └──────────
  └────────────────────────→ t
     ←5ms→ ←─── 保持阶段 ──→
            (PWM 30-50% 占空比)

  启动: 100% 占空比 5ms (峰值电流)
  保持: 30-50% 占空比 (有效值 = 维持电流)
```

```c
void Solenoid_Activate(void) {
    // 1. 峰值阶段: 全开 5ms
    Solenoid_SetPWM(999);  // 100%
    HAL_Delay(5);

    // 2. 保持阶段: 降占空比
    Solenoid_SetPWM(300);  // 30%

    // 好处: 功耗降低 ~70%, 线圈不发热
}
```

---

## 3. 感性负载保护

::: danger 感性负载必须加续流 (Flyback) 保护
继电器/电磁阀线圈断电时，电感产生反向高压 (L×di/dt)，可高达数百伏，瞬间击穿驱动管。
:::

```
续流二极管选型:

  普通: 1N4148 (100V/200mA, 小继电器)
  中等: 1N4007 (1000V/1A, 中功率电磁阀)
  快速恢复: FR107 (用于高频 PWM, 普通二极管恢复慢)
  TVS 管: 与二极管并联, 快速泄放大能量
```

```c
// 续流二极管接法:
// 二极管阴极 → VCC
// 二极管阳极 → MOSFET 漏极 (也是线圈另一端)
//
// 原理: 断电时电感继续拉电流, 二极管提供续流通路,
//       将电压钳位在 VCC + 0.7V, 保护 MOSFET
```

### 触点消弧

```c
// 继电器触点保护 (触点断开时产生电弧, 烧蚀触点):
// 1. RC 吸收 (Snubber): 0.1μF + 100Ω 串联, 并联在触点上
// 2. 压敏电阻 (MOV): 并联在负载两端 (AC 应用)
// 3. 输出过零检测 (SSR 用, 在交流零点通断)

// 直流感性负载: 续流二极管 + TVS 最佳组合
// ┌─────[二极管]─────┐
// │                  │
// VCC──┬──[TVS]──┬── [MOSFET D极]
//      │         │
//      └─[负载]──┘
```

---

## 4. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 继电器不吸合 | 三极管基极驱动电流不够 | 检查基极电阻 (1kΩ→680Ω); 确认 HFE 够大 |
| 2 | MCU 在继电器断开时复位 | 反向高压通过 GPIO 耦合 | 加续流二极管; 磁珠 + 电容隔离电源 |
| 3 | 继电器触点粘连 (一直导通) | 电弧导致焊接/接触电阻增大 | 加 RC 吸收回路; 降额使用 (电流 ×0.5) |
| 4 | 电磁阀严重发热 | 长时间 100% 占空比 | 使用 Peak & Hold 降低保持电流 |
| 5 | MOSFET 烧毁 (D-S 短路) | 续流二极管失效或响应慢 | 换快速恢复二极管; 检查 TVS 参数 |
| 6 | SSR 关不断 (负载仍有电) | SSR 漏电流 (mA 级) | 并联泄放电阻; 加大负载功率 |
| 7 | 电磁阀动作缓慢 | PWM 频率太低 → 电流波动大 | PWM 频率 ≥ 500Hz (推荐 1-5kHz) |

---

## 5. 参考文档

1. "Relay Selection Guide" — OMRON / TE Connectivity
2. "MOSFET Driver Design for Solenoids" — TI Application Report SLVA714
3. "RC Snubber Circuit Design" — NXP AN11160
4. "Solenoid Control with Peak-and-Hold" — PIC Microcontroller Application Notes
