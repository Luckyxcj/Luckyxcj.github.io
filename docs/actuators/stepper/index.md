# 步进电机驱动

> **文档说明**：本文档基于 Trinamic TMC2209/TMC5160 数据手册及步进电机驱动实战经验整理。

---

## 目录

1. [步进电机基础](#1-步进电机基础)
2. [常用驱动芯片对比](#2-常用驱动芯片对比)
3. [TMC2209 静音驱动实战](#3-tmc2209-静音驱动实战)
4. [TMC5160 大功率方案](#4-tmc5160-大功率方案)
5. [常见问题](#5-常见问题)

---

## 1. 步进电机基础

步进电机将电脉冲信号转换为角位移，每输入一个脉冲就转动一个固定的角度（步距角）。

```
步进电机类型:

  ┌─────────────────────────────────────────────────┐
  │  PM (永磁式)        VR (变磁阻式)     Hybrid (混合式)│
  │  低扭矩、廉价        低精度           高扭矩、主流   │
  │  玩具/钟表           旧式打印机        3D打印/CNC    │
  └─────────────────────────────────────────────────┘

  NEMA 规格尺寸:
  NEMA 8:  20×20mm  → 小型 3D 打印
  NEMA 17: 42×42mm  → 3D 打印主力 (Ender-3, Prusa)
  NEMA 23: 57×57mm  → CNC 主轴 / 雕刻机
  NEMA 34: 86×86mm  → 大型 CNC / 工业
```

| 驱动方式 | 扭矩 | 振动 | 效率 | 实现 |
|---------|------|------|------|------|
| 整步 (Full Step) | 100% | 大 | 低 | 最简单 |
| 半步 (Half Step) | ~70% | 中 | 中 | 简单 |
| 微步 (Microstep) | ~50-70% | 极小 | 高 | 需专用 IC |
| 电压模式 | 低 | 中 | 低 | L298N + PWM |
| 恒流斩波 | 高 | 中 | 高 | A4988/DRV8825 |
| 静音斩波 (StealthChop) | 高 | 极低 | 最高 | TMC2209/TMC5160 |

---

## 2. 常用驱动芯片对比

| 芯片 | 电压 | 最大电流 | 微步 | 静音 | 接口 | 特点 |
|------|------|---------|------|------|------|------|
| A4988 | 8-35V | 2A | 1/16 | 无 | DIR+STEP | 最经典, 噪声大 |
| DRV8825 | 8.2-45V | 2.5A | 1/32 | 无 | DIR+STEP | 比 A4988 电流大 |
| TMC2208 | 5-36V | 1.4A | 1/256 | StealthChop2 | DIR+STEP/UART | 3D 打印主流 |
| TMC2209 | 5-29V | 2A | 1/256 | StealthChop2 | DIR+STEP/UART | TMC2208 升级版 |
| TMC5160 | 8-60V | 10A | 1/256 | StealthChop2 | SPI+DIR+STEP | 6 点斜坡规划器 (内置) |
| TMC2130 | 5-46V | 2A | 1/256 | StealthChop | SPI | SPI 配置, 诊断丰富 |

---

## 3. TMC2209 静音驱动实战

TMC2209 是 3D 打印最常用的静音驱动，支持 UART 单线配置。

```
TMC2209 引脚连接 (UART 模式):

  STM32          TMC2209
  ┌──────┐      ┌──────┐
  │ GPIO ┼─────→│ STEP  │
  │ GPIO ┼─────→│ DIR   │
  │ GPIO ┼─────←│ DIAG  │ (堵转检测输出)
  │ UART TX┼────→│ PDN_UART│ (单线 UART, 半双工)
  └──────┘      └──────┘
```

```c
// TMC2209 UART 读写 (单线半双工协议, 波特率由 fCLK 决定)
#define TMC2209_DEFAULT_MOTOR_ADDR  0x00  // UART 地址

// TMC2209 寄存器
#define TMC2209_GCONF          0x00
#define TMC2209_IHOLD_IRUN     0x10
#define TMC2209_TPOWERDOWN     0x11
#define TMC2209_CHOPCONF       0x6C
#define TMC2209_PWMCONF        0x70
#define TMC2209_DRV_STATUS     0x6F

// 写寄存器 (单线 UART, 需半双工切换方向)
// 数据包格式: [SYNC(0x05)] [ADDR] [REG|W] [DATA...] [CRC]
void TMC2209_WriteReg(uint8_t addr, uint8_t reg, uint32_t data) {
    uint8_t buf[8];

    buf[0] = 0x05;  // SYNC
    buf[1] = addr;  // 从机地址
    buf[2] = reg | 0x80;  // 寄存器地址 (bit7=1 表示写)
    buf[3] = (data >> 24) & 0xFF;
    buf[4] = (data >> 16) & 0xFF;
    buf[5] = (data >> 8) & 0xFF;
    buf[6] = data & 0xFF;
    buf[7] = TMC2209_CalcCRC(buf, 7);  // CRC 校验

    // 发送前: 将 UART TX 切换为推挽输出模式
    RS485_DE_HIGH();  // 使能发送 (半双工)
    HAL_UART_Transmit(&huart_tmc, buf, 8, 10);
    RS485_DE_LOW();   // 释放总线 (接收模式)
}

void TMC2209_Init(void) {
    // 1. 设置电流 (IHOLD=8 (待机), IRUN=20 (运行), IHOLDDELAY=5)
    TMC2209_WriteReg(0x00, TMC2209_IHOLD_IRUN,
                     (5 << 16) | (20 << 8) | (8 << 0));

    // 2. 启用 StealthChop2 (静音模式, 默认启用)
    //    PWMCONF: PWM_AUTOSCALE=1, PWM_GRAD=4, PWM_AMPL=128
    TMC2209_WriteReg(0x00, TMC2209_PWMCONF,
                     (1 << 31) | (4 << 16) | (128 << 0));

    // 3. 设置微步: 在 CHOPCONF 中
    //    MRES=4 → 16 μsteps (MRES: 0=256, 1=128, 2=64, 3=32, 4=16, 5=8, 6=4, 7=2, 8=1)
    TMC2209_WriteReg(0x00, TMC2209_CHOPCONF,
                     (4 << 24) |  // MRES=16 μsteps
                     (0 << 20));  // TOFF=0 (自动)

    // 4. 设置堵转检测阈值 (StallGuard)
    //    TCOOLTHRS = 某个阈值 (来自自动调谐)
    //    当 SG_RESULT < TCOOLTHRS → DIAG 引脚输出信号
    uint32_t gconf = TMC2209_ReadReg(0x00, TMC2209_GCONF);
    gconf |= (1 << 2);  // en_spreadcycle = 0 (StealthChop)
    TMC2209_WriteReg(0x00, TMC2209_GCONF, gconf);
}

// TMC2209 CRC 计算 (多项式 0x07)
static uint8_t TMC2209_CalcCRC(uint8_t *data, uint8_t len) {
    uint8_t crc = 0;
    for (uint8_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x80) crc = (crc << 1) ^ 0x07;
            else           crc = (crc << 1);
        }
    }
    return crc;
}
```

### StealthChop vs SpreadCycle

```
StealthChop: 电压模式 PWM 调制
  - 超静音 (3D 打印几乎无声)
  - 低速扭矩略低
  - 适用: ≤ 500 RPM

SpreadCycle: 恒流斩波 (磁滞控制)
  - 高速扭矩更好
  - 有少许噪声 (但比 A4988 好)
  - 适用: > 500 RPM

CoolStep: 随负载自动调节电流
  - 轻载 → 降电流 (省电、降温)
  - 重载 → 升电流 (防丢步)
```

---

## 4. TMC5160 大功率方案

TMC5160 集成了**六点斜坡运动规划器**，可以自主完成加减速控制，无需 MCU 实时产生脉冲。

```c
// TMC5160 内置运动规划器 (通过 SPI 配置)
// MCU 只需设定目标位置/速度, 芯片内部自动规划梯形/S曲线

#define TMC5160_RAMPMODE      0x20
#define TMC5160_XACTUAL       0x21
#define TMC5160_VACTUAL       0x22
#define TMC5160_VSTART        0x23
#define TMC5160_A1            0x24  // 第一段加速度
#define TMC5160_V1            0x25  // 第一段速度阈值
#define TMC5160_AMAX          0x26  // 最大加速度
#define TMC5160_VMAX          0x27  // 最大速度
#define TMC5160_DMAX          0x28  // 最大减速度
#define TMC5160_XTARGET       0x2B

void TMC5160_MoveTo(int32_t target_pos) {
    // 1. 设置目标位置
    TMC5160_WriteReg(TMC5160_XTARGET, target_pos);

    // 2. 配置速度/加速度参数
    TMC5160_WriteReg(TMC5160_VMAX, 50000);   // 最大速度 (μsteps/s)
    TMC5160_WriteReg(TMC5160_AMAX, 10000);   // 加速度
    TMC5160_WriteReg(TMC5160_DMAX, 10000);   // 减速度

    // 3. 启动定位模式 (RAMPMODE=0 → 梯形定位模式)
    TMC5160_WriteReg(TMC5160_RAMPMODE, 0);

    // 芯片自动完成运动，无需 MCU 干预
    // 查询 XACTUAL 可获取实时位置
}

// 速度模式 (无需目标位置, 连续旋转)
void TMC5160_RotateAtSpeed(int32_t speed) {
    TMC5160_WriteReg(TMC5160_RAMPMODE, 2);  // 速度模式
    TMC5160_WriteReg(TMC5160_VMAX, speed);
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 电机振动但不转 | 一相接线断路或驱动芯片损坏 | 万用表量各相电阻 (正常几 Ω); 更换驱动 |
| 2 | 高速时丢步 | VMAX 过高 / 电流不足 / 供电电压不够 | 降低速度; 增大电流; 提高供电电压 (高压 → 高理论速度) |
| 3 | TMC2209 噪音仍然大 | 芯片在 SpreadCycle 模式 | 确认启用了 StealthChop (GCONF bit2=0) |
| 4 | TMC2209 发热严重 | 电流设置过大 | 量 Vref; IHOLD 不要设太高 (待机电流 30-50% IRUN) |
| 5 | UART CRC 错误 | CRC 多项式不对 (0x07) 或波特率不匹配 | 确认波特率 fCLK/128; 用逻辑分析仪抓包 |
| 6 | TMC5160 规划器不动 | RAMPMODE 未设置正确 | RAMPMODE=0 (定位), =2 (速度), =3 (保持) |
| 7 | 低速时堵转检测误触发 | SG 阈值设得太高 | 运行自动调谐找到合适的 SG_THRS |

---

## 6. 参考文档

1. TMC2209 数据手册: https://www.trinamic.com/products/integrated-circuits/details/tmc2209-la/
2. TMC5160 数据手册: https://www.trinamic.com/products/integrated-circuits/details/tmc5160/
3. Trinamic Application Notes: https://www.trinamic.com/technology/appnotes/
4. "步进电机系统设计" — Avayan (TI)
5. TMC2209 UART 通讯协议参考: Trinamic 官方 Arduino 库
