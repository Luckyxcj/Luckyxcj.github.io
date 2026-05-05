# GPIO 高级应用

> **文档说明**：本文档涵盖 GPIO 高级功能，包括中断去抖、位带操作、并行输出优化及低功耗模式下的引脚处理。

---

## 目录

1. [GPIO 中断与 EXTI](#1-gpio-中断与-exti)
2. [位带操作 (Bit-Banding)](#2-位带操作-bit-banding)
3. [并行 GPIO 输出优化](#3-并行-gpio-输出优化)
4. [低功耗下的 GPIO 处理](#4-低功耗下的-gpio-处理)
5. [5V 容忍与电平问题](#5-5v-容忍与电平问题)
6. [参考文档](#6-参考文档)

---

## 1. GPIO 中断与 EXTI

```c
// EXTI 配置: PA0 作为外部中断引脚 (下降沿触发)
void EXTI_PA0_Init(void) {
    __HAL_RCC_GPIOA_CLK_ENABLE();

    GPIO_InitTypeDef gpio = {0};
    gpio.Pin = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_FALLING;  // 下降沿触发中断
    gpio.Pull = GPIO_PULLUP;           // 内部上拉 (默认高, 下降沿 = 按键按下)
    HAL_GPIO_Init(GPIOA, &gpio);

    HAL_NVIC_SetPriority(EXTI0_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

void EXTI0_IRQHandler(void) {
    HAL_GPIO_EXTI_IRQHandler(GPIO_PIN_0);  // HAL 通用处理
}

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
    if (GPIO_Pin == GPIO_PIN_0) {
        // PA0 中断事件处理
    }
}

// 注意: EXTI 线映射关系:
// EXTI0  → PA0, PB0, PC0, ... (任选一个)
// EXTI1  → PA1, PB1, PC1, ...
// EXTI5-9  → 共享 EXTI9_5_IRQn
// EXTI10-15 → 共享 EXTI15_10_IRQn
```

---

## 2. 位带操作 (Bit-Banding)

Cortex-M3/M4 支持位带 (bit-banding)，将 SRAM 和外设寄存器中的每一个 bit 映射到独立的 32-bit 地址。

```c
// 位带操作宏 (单 bit 原子操作)
#define BITBAND_SRAM(addr, bit)  (0x22000000 + (((uint32_t)(addr) & 0xFFFFF) * 32) + (bit * 4))
#define BITBAND_PERIPH(addr, bit) (0x42000000 + (((uint32_t)(addr) & 0xFFFFF) * 32) + (bit * 4))

// 使用示例
#define PA5_OUT  (*(volatile uint32_t *)BITBAND_PERIPH(&GPIOA->ODR, 5))
#define LED_ON() (PA5_OUT = 1)
#define LED_OFF() (PA5_OUT = 0)
#define LED_TOGGLE() (PA5_OUT ^= 1)

// 位带操作的优势:
// 1. 真正的原子位操作 (不会因中断而被打断)
// 2. 单条指令完成 (比 BSRR 更直观)
```

---

## 3. 并行 GPIO 输出优化

```c
// 向 GPIO 端口同时写入 16-bit 数据
// 场景: 驱动 8080 接口的 LCD 或并行 DAC
void GPIO_Port_Write16(uint16_t data) {
    // 方法1: 直接写 ODR (需要确保其他位不受影响)
    // GPIOA->ODR = (GPIOA->ODR & 0xFFFF0000) | data;

    // 方法2: 用 BSRR 组合 (如果数据线不连续)
    // 更快，因为是原子操作
    GPIOA->BSRR = (data & 0xFFFF)           // 置位 '1' 位
                | ((~data & 0xFFFF) << 16); // 复位 '0' 位
}
```

---

## 4. 低功耗下的 GPIO 处理

```c
// 进入 STOP/STANDBY 之前的 GPIO 配置
void GPIO_LowPower_Config(void) {
    // 将所有未使用的 GPIO 设为 Analog (功耗最低)
    // 正在使用的 GPIO 根据外部电路合理设置

    // 输出引脚: 根据外部负载确定最佳状态
    // 外部上拉 → 输出高 (省去上拉电阻的电流)
    // 外部下拉 → 输出低
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET);  // LED off (高 = 关)

    // 通信引脚: 设为 Analog 或保持固定电平
    // I2C 引脚: 设为 Analog (由外部上拉决定电平)
    for (int i = 6; i <= 9; i++) {
        // PA6-PA9 → Analog
    }
}

// 不要忘记: 在 STOP 模式下, 如果 I2C/SPI 引脚保留在 AF 模式,
// 内部电路可能仍在消耗电流 (即使时钟停止了)
```

---

## 5. 5V 容忍与电平问题

### 5.1 STM32 的 5V 容忍脚

```
FT (Five-volt Tolerant) 引脚: 可以耐受 5V 输入 (在推挽输出模式时最大 3.3V)
  ├─ 适用于: 输入模式、开漏输出模式 (外部上拉到 5V)
  └─ 几乎所有 STM32 F4/G4/H7 的 GPIO 都是 FT

TTa (3.3V Tolerant, Analog): 只能耐受 3.3V (含模拟功能)
  ├─ 适用于: ADC 输入
  └─ 不能接 5V 信号!
```

```c
// 3.3V MCU + 5V 传感器的 I2C 通信 (最简方案: 利用 FT + 开漏)
// 硬件: I2C SDA/SCL 通过 4.7kΩ 上拉到 5V
// 软件: 配置为开漏输出，不使能内部上拉

// 注意: 虽然 FT 引脚输入可以耐受 5V，但输出高电平时 (关闭 P-MOS)，
// 引脚电平由外部上拉决定，即 5V。这在输入端是安全的。

// 但如果引脚配置为推挽输出高 (3.3V) → 始终只有 3.3V → 5V 器件可能无法识别
// 所以和 5V 器件通信必须用开漏!
```

---

## 6. 参考文档

1. RM0090: STM32F4xx 参考手册 — GPIO 和 EXTI 章节
2. AN4899: STM32G0 GPIO — 包括 5V 容忍性详细说明
3. ARM Cortex-M4 TRM — Bit-banding 章节
4. "GPIO 最佳实践" — ST Community
