# GPIO 通用输入输出

> **文档说明**：本文档基于 STM32 参考手册 GPIO 章节及多年嵌入式开发经验整理。

---

## 目录

1. [GPIO 基础概念](#1-gpio-基础概念)
2. [输出模式深度解析](#2-输出模式深度解析)
3. [输入模式与上下拉](#3-输入模式与上下拉)
4. [复用功能 (Alternate Function)](#4-复用功能-alternate-function)
5. [高速 GPIO 与 toggle 性能](#5-高速-gpio-与-toggle-性能)
6. [代码实战](#6-代码实战)
7. [常见问题与排查](#7-常见问题与排查)
8. [参考文档](#8-参考文档)

---

## 1. GPIO 基础概念

### 1.1 GPIO 的八种模式

```
GPIO 模式分类:

输出模式:
├─ 推挽输出 (Push-Pull)    — 可输出高/低电平, 最常用
├─ 开漏输出 (Open-Drain)   — 只能拉低, "高"由外部上拉实现
├─ AF 推挽输出             — 外设功能 (如 USART TX)
└─ AF 开漏输出             — 外设功能 (如 I2C SDA)

输入模式:
├─ 浮空输入 (No Pull)       — 无内部上下拉 (外部电路决定)
├─ 上拉输入 (Pull-Up)       — 默认高电平 (用于按键/空闲高)
├─ 下拉输入 (Pull-Down)     — 默认低电平
└─ 模拟输入 (Analog)        — 用于 ADC/DAC/比较器输入 (关闭施密特触发器)
```

### 1.2 GPIO 内部结构

```
GPIO 内部框图:

VDD ──┬── P-MOS (上管)
      │
IO ───┼── ESD 保护二极管 → VDD (钳位到 VDD+0.7V)
      │                   → VSS (钳位到 VSS-0.7V)
      │
      ├── P-MOS 推挽上管 (由输出数据控制)
      ├── N-MOS 推挽下管 (由输出数据控制)
      │
      ├── 施密特触发器 → 输入数据寄存器 (IDR)
      ├── 上拉电阻 (40kΩ typ) → VDD
      ├── 下拉电阻 (40kΩ typ) → VSS
      │
      └── 模拟开关 → ADC 输入
```

---

## 2. 输出模式深度解析

### 2.1 推挽输出 (Push-Pull)

```c
// 推挽输出配置: GPIO 可以主动输出高电平 (通过 P-MOS) 和低电平 (通过 N-MOS)
GPIO_InitTypeDef gpio = {0};
gpio.Pin = GPIO_PIN_5;
gpio.Mode = GPIO_MODE_OUTPUT_PP;     // 推挽输出
gpio.Pull = GPIO_NOPULL;
gpio.Speed = GPIO_SPEED_FREQ_LOW;    // 普通速度
HAL_GPIO_Init(GPIOA, &gpio);

// 使用
HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);    // 输出高
HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);  // 输出低
HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);                  // 翻转
```

### 2.2 开漏输出 (Open-Drain)

开漏输出只能拉低电平，不能主动拉高。"高"电平需要外部上拉电阻实现。

```
开漏输出的用途:
├─ I2C 总线 (SDA/SCL 必须是开漏)
├─ 1-Wire 总线
├─ 电平转换: 不同电压域之间的通信 (3.3V MCU → 5V 外设)
└─ "线与"逻辑: 多个开漏输出接在一起，任一个拉低则总线为低
```

```c
// 开漏输出配置 (用于 I2C SDA 或 1-Wire)
gpio.Mode = GPIO_MODE_OUTPUT_OD;     // 开漏输出
gpio.Pull = GPIO_PULLUP;             // 内部上拉 (通常还需外部上拉 4.7kΩ)
```

### 2.3 输出速度选择

| 速度 | 最大频率 | 适用场景 |
|------|---------|---------|
| LOW | ~2 MHz | LED、继电器等慢速设备 |
| MEDIUM | ~25 MHz | 普通数字信号 |
| HIGH | ~50 MHz | SPI CLK、高速通信 |
| VERY HIGH | ~100 MHz | 高速并行接口 |

::: tip 输出速度与 EMI
输出速度越高，EMI (电磁干扰) 越大。不是越快越好——给 LED 设置 100MHz 速度没有意义，反而产生高频噪声。**按需选择最慢的速度即可**。
:::

---

## 3. 输入模式与上下拉

### 3.1 按键输入的标准配置

```c
// 按键输入: 外部接地, 内部上拉 (按下时读到 0)
gpio.Mode = GPIO_MODE_INPUT;
gpio.Pull = GPIO_PULLUP;  // 未按下时内部上拉保证高电平
HAL_GPIO_Init(GPIOA, &gpio);

// 读取
if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_RESET) {
    // 按键按下 (读到低)
}

// 按键去抖动 (软件方法)
if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_RESET) {
    HAL_Delay(20);  // 延迟去抖
    if (HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0) == GPIO_PIN_RESET) {
        // 确认按键按下
    }
}
```

### 3.2 浮空输入的陷阱

```c
// ❌ 如果引脚设置为浮空输入且外部没有上下拉
// 则该引脚电平不确定 (由 PCB 上的泄漏电流决定)
// 后果: 输入引脚随机跳变 → 可能误触发中断

// ✅ 正确做法: 不使用的引脚设置为 Analog 模式
gpio.Mode = GPIO_MODE_ANALOG;
gpio.Pull = GPIO_NOPULL;
```

---

## 4. 复用功能 (Alternate Function)

GPIO 引脚可通过 AF 功能连接到外设（USART、SPI、I2C、TIM 等）。

```c
// USART1 TX 配置 (PA9 → AF7)
gpio.Pin = GPIO_PIN_9;
gpio.Mode = GPIO_MODE_AF_PP;        // 复用推挽输出
gpio.Pull = GPIO_NOPULL;
gpio.Speed = GPIO_SPEED_FREQ_HIGH;
gpio.Alternate = GPIO_AF7_USART1;   // 选择 AF7
HAL_GPIO_Init(GPIOA, &gpio);

// 常见 AF 映射速查 (F4 系列):
// AF0: 系统 (SWD, RTC)
// AF1: TIM1/TIM2
// AF2: TIM3-TIM5
// AF4: I2C1-I2C3
// AF5: SPI1-SPI6
// AF7: USART1-USART3
// AF10: OTG_FS
// AF11: ETH
```

---

## 5. 高速 GPIO 与 Toggle 性能

### 5.1 BSRR 寄存器：原子位操作

```c
// ❌ 慢速方法 (读-修改-写, 可能被中断打断)
GPIOA->ODR |= (1 << 5);   // 读 ODR → 修改 → 写回

// ✅ 快速方法 (原子操作, 单周期)
GPIOA->BSRR = (1 << 5);          // PA5 置位 (bit 0-15)
GPIOA->BSRR = (1 << (5 + 16));   // PA5 复位 (bit 16-31)

// BSRR 的优势:
// 1. 原子操作, 不会被中断打断
// 2. 写 0 到不需要修改的位, 不影响其他引脚
// 3. 单周期操作 (比读-修-写快)
```

### 5.2 测量 GPIO 最大 Toggle 速度

```c
// 裸机 GPIO toggle 极限速度 (F4 @168MHz):
// 使用以下循环:
while (1) {
    GPIOB->BSRR = GPIO_PIN_0;           // 2 cycle
    GPIOB->BSRR = GPIO_PIN_0 << 16;     // 2 cycle
}
// → 极限频率 ≈ 168/4 = 42 MHz

// 实际可用 GPIO 输出频率:
// 简单引脚翻转: ~21 MHz (含循环开销)
// DMA 到 GPIO: 理论上可达到总线速度
```

---

## 6. 代码实战

### 6.1 LED 闪烁

```c
void LED_Init(void) {
    __HAL_RCC_GPIOB_CLK_ENABLE();
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin = GPIO_PIN_0 | GPIO_PIN_7 | GPIO_PIN_14;
    gpio.Mode = GPIO_MODE_OUTPUT_PP;
    gpio.Pull = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOB, &gpio);

    // 初始化状态: 全部关
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0 | GPIO_PIN_7 | GPIO_PIN_14, GPIO_PIN_RESET);
}

void LED_Set(uint8_t led_num, uint8_t state) {
    uint16_t pin = (led_num == 1) ? GPIO_PIN_0 :
                   (led_num == 2) ? GPIO_PIN_7 : GPIO_PIN_14;
    HAL_GPIO_WritePin(GPIOB, pin, state ? GPIO_PIN_SET : GPIO_PIN_RESET);
}
```

### 6.2 软件 I2C (Bit-Bang)

```c
// 用 GPIO 模拟 I2C (当硬件 I2C 不可用时)
#define I2C_SCL_PIN   GPIO_PIN_6
#define I2C_SDA_PIN   GPIO_PIN_7
#define I2C_PORT      GPIOB

#define SCL_H()  (I2C_PORT->BSRR = I2C_SCL_PIN)
#define SCL_L()  (I2C_PORT->BSRR = I2C_SCL_PIN << 16)
#define SDA_H()  (I2C_PORT->BSRR = I2C_SDA_PIN)
#define SDA_L()  (I2C_PORT->BSRR = I2C_SDA_PIN << 16)
#define SDA_IN() ((I2C_PORT->IDR & I2C_SDA_PIN) ? 1 : 0)

static void i2c_delay(void) {
    // 对于 100kHz I2C: 每个 bit 周期 10μs
    for (volatile int i = 0; i < 5; i++);  // 调整 N 以匹配目标频率
}

void i2c_start(void) {
    SDA_H(); i2c_delay();
    SCL_H(); i2c_delay();
    SDA_L(); i2c_delay();  // SDA 下降沿当 SCL 高 = START
    SCL_L(); i2c_delay();
}

void i2c_stop(void) {
    SDA_L(); i2c_delay();
    SCL_H(); i2c_delay();
    SDA_H(); i2c_delay();  // SDA 上升沿当 SCL 高 = STOP
}

uint8_t i2c_write_byte(uint8_t data) {
    for (int i = 7; i >= 0; i--) {
        if (data & (1 << i)) SDA_H(); else SDA_L();
        i2c_delay();
        SCL_H(); i2c_delay();
        SCL_L(); i2c_delay();
    }
    // 读 ACK
    SDA_H();  // 释放 SDA
    i2c_delay();
    SCL_H(); i2c_delay();
    uint8_t ack = !SDA_IN();  // 0 = ACK, 1 = NACK
    SCL_L(); i2c_delay();
    return ack;
}
```

---

## 7. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 引脚输出不翻转 | GPIO 时钟未使能 | 检查 `__HAL_RCC_GPIOx_CLK_ENABLE()` |
| 2 | 推挽输出读到错误的输入值 | ODR 值不等于引脚实际电平 (引脚被外部拉低) | 读 IDR (输入数据寄存器) 而非 ODR；或检查外部电路 |
| 3 | AF 模式不工作 | AF 号选错或 GPIO 模式未设为 AF | 查数据手册 Pinout 章节；确认 `gpio.Mode = GPIO_MODE_AF_PP` |
| 4 | 中断脚误触发 | 浮空输入 + PCB 噪声 → 电平随机跳变 | 配置内部上拉/下拉；或外部加上拉/下拉电阻 |
| 5 | 开漏输出一直是高 | 外部上拉电阻忘了焊 | 开漏必须外部上拉 (或使能内部上拉) |
| 6 | STM32 GPIO 驱动能力不足 | GPIO 最大 25mA (每个引脚) | 大电流负载加三极管/MOSFET 驱动 |
| 7 | 高速 GPIO 输出有振铃 | 走线电感 + 负载电容 | 串联 22-50Ω 终端电阻在源端 |

---

## 8. 参考文档

1. RM0090: STM32F4xx 参考手册 — GPIO 章节
2. RM0008: STM32F1xx 参考手册 — GPIO 章节
3. ST AN4899: STM32G0 GPIO 应用笔记
4. "GPIO Output Speed and EMI" — STM32 Application Note
