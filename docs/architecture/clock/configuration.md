# 时钟配置实战

> **文档说明**：本文档基于 STM32 各系列参考手册中时钟配置 (RCC) 章节的工程实践总结。

---

## 目录

1. [时钟配置基础流程](#1-时钟配置基础流程)
2. [各系列典型配置代码](#2-各系列典型配置代码)
3. [PLL 参数计算器](#3-pll-参数计算器)
4. [时钟切换与动态调频](#4-时钟切换与动态调频)
5. [外设时钟使能与总线架构](#5-外设时钟使能与总线架构)
6. [常见配置错误与排查](#6-常见配置错误与排查)

---

## 1. 时钟配置基础流程

```
上电 → HSI (内部 16MHz) 启动
    → SystemInit() 复位时钟控制寄存器为默认值
    → SystemClock_Config() 配置目标频率
       ├─ 1. 使能 HSE (外部高速晶振) 并等待就绪
       ├─ 2. 配置 Flash 等待周期（根据目标主频）
       ├─ 3. 配置 PLL 参数 (M/N/P/Q)
       ├─ 4. 使能 PLL 并等待锁定
       ├─ 5. 配置 AHB/APB1/APB2 总线的预分频器
       └─ 6. 切换系统时钟源到 PLL
    → 外设时钟配置
```

::: danger 时钟配置顺序不可颠倒
必须先配置 Flash 等待周期再提高主频！如果主频已经升到 168MHz 而 Flash 等待周期还是 0，CPU 会在第一次 Flash 取指时 HardFault。这是新手最常见的时钟配置事故。
:::

---

## 2. 各系列典型配置代码

### 2.1 STM32F1 系列 (最高 72MHz)

```c
// STM32F103 时钟配置: 8MHz 晶振 → 72MHz
void SystemClock_Config(void) {
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    // 1. HSE 配置
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
    osc.HSEState = RCC_HSE_ON;
    osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;  // F1: HSE 不分频
    HAL_RCC_OscConfig(&osc);

    // 2. PLL = HSE × 9 = 8 × 9 = 72MHz
    osc.OscillatorType = RCC_OSCILLATORTYPE_PLL;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
    osc.PLL.PLLMUL = RCC_PLL_MUL9;  // F1 的倍频系数 (2-16)
    HAL_RCC_OscConfig(&osc);

    // 3. 总线分频: AHB=72MHz, APB1=36MHz, APB2=72MHz
    clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                  | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;    // AHB = 72MHz
    clk.APB1CLKDivider = RCC_HCLK_DIV2;     // APB1 = 36MHz (F1 最大 36MHz)
    clk.APB2CLKDivider = RCC_HCLK_DIV1;     // APB2 = 72MHz
    HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2);  // Flash: 2 wait states
}
```

### 2.2 STM32F4 系列 (最高 168MHz)

```c
// STM32F407 时钟配置: 8MHz 晶振 → 168MHz
void SystemClock_Config(void) {
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    // 1. HSE 配置
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
    osc.HSEState = RCC_HSE_ON;
    HAL_RCC_OscConfig(&osc);

    // 2. PLL = HSE / M * N / P
    //    M=8, N=336, P=2 → PLLCLK = 8/8 * 336 / 2 = 168MHz
    osc.OscillatorType = RCC_OSCILLATORTYPE_PLL;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
    osc.PLL.PLLM = 8;
    osc.PLL.PLLN = 336;
    osc.PLL.PLLP = RCC_PLLP_DIV2;  // 主 PLL 输出 = 336/2 = 168MHz
    osc.PLL.PLLQ = 7;               // USB/SDIO 时钟 = 336/7 = 48MHz
    HAL_RCC_OscConfig(&osc);

    // 3. 总线分频
    clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                  | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;    // AHB = 168MHz
    clk.APB1CLKDivider = RCC_HCLK_DIV4;     // APB1 = 42MHz (最大 42MHz)
    clk.APB2CLKDivider = RCC_HCLK_DIV2;     // APB2 = 84MHz (最大 84MHz)

    HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_5);  // 168MHz 需要 5 WS
}
```

### 2.3 STM32G4 系列 (Cordic + Filter 加速器)

```c
// STM32G474 时钟配置: 8MHz 晶振 → 170MHz
// G4 系列特点：CORDIC 和 FMAC 使用独立的 SYSCLK，需要注意
void SystemClock_Config(void) {
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
    osc.HSEState = RCC_HSE_ON;
    HAL_RCC_OscConfig(&osc);

    // PLL: 8/2 * 85 / 2 = 170MHz
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
    osc.PLL.PLLM = RCC_PLLM_DIV2;   // 8/2 = 4MHz 输入 VCO
    osc.PLL.PLLN = 85;               // VCO = 4 * 85 = 340MHz
    osc.PLL.PLLP = RCC_PLLP_DIV2;   // PLLP = 340/2 = 170MHz (系统时钟)
    osc.PLL.PLLQ = RCC_PLLQ_DIV4;   // PLLQ = 340/4 = 85MHz (ADC 等)
    osc.PLL.PLLR = RCC_PLLR_DIV2;   // PLLR = 340/2 = 170MHz
    HAL_RCC_OscConfig(&osc);

    clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                  | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;   // AHB = 170MHz
    clk.APB1CLKDivider = RCC_HCLK_DIV1;    // APB1 = 170MHz (G4 APB1 支持更高频率)
    clk.APB2CLKDivider = RCC_HCLK_DIV1;    // APB2 = 170MHz
    HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_4);  // 170MHz 需要 4 WS
}
```

### 2.4 STM32H7 系列 (双域时钟, 最高 480MHz)

```c
// STM32H743 时钟配置: 25MHz 晶振 → 480MHz
// H7 有双域时钟: CD (Core Domain) + SRD (SmartRun Domain)
// 关键：CPU/AXI 由 PLL1 提供, 外设由 PLL2/PLL3 提供
void SystemClock_Config(void) {
    RCC_OscInitTypeDef osc = {0};
    RCC_ClkInitTypeDef clk = {0};

    // 1. HSE = 25MHz
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
    osc.HSEState = RCC_HSE_ON;
    HAL_RCC_OscConfig(&osc);

    // 2. PLL1 (供给 CPU/AXI): 25/5 * 96 / 1 = 480MHz
    osc.OscillatorType = RCC_OSCILLATORTYPE_PLL;
    osc.PLL.PLLState = RCC_PLL_ON;
    osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
    osc.PLL.PLLM = 5;       // VCO 输入 = 25/5 = 5MHz
    osc.PLL.PLLN = 96;       // VCO = 5 * 96 = 480MHz
    osc.PLL.PLLP = 1;        // 不分频
    osc.PLL.PLLQ = 4;        // 480/4 = 120MHz
    osc.PLL.PLLR = 1;        // 480/1 = 480MHz (sys_ck)
    osc.PLL.PLLRGE = RCC_PLL1VCIRANGE_2;  // VCO 输入范围 4-8MHz
    osc.PLL.PLLVCOSEL = RCC_PLL1VCOWIDE;  // VCO 输出范围 192-836MHz
    osc.PLL.PLLFRACN = 0;    // 整数模式
    HAL_RCC_OscConfig(&osc);

    // 3. 总线分频 (H7 的总线配置更复杂)
    clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                  | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2
                  | RCC_CLOCKTYPE_D1PCLK1 | RCC_CLOCKTYPE_D3PCLK1;
    clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLL1;
    clk.AHBCLKDivider = RCC_SYSCLK_DIV1;   // 480MHz
    clk.APB3CLKDivider = RCC_APB3_DIV2;    // D1 APB3 = 240MHz
    clk.APB1CLKDivider = RCC_APB1_DIV2;    // D2 APB1 = 240MHz
    clk.APB2CLKDivider = RCC_APB2_DIV2;    // D2 APB2 = 240MHz
    clk.APB4CLKDivider = RCC_APB4_DIV2;    // D3 APB4 = 240MHz
    HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_4);
}
```

---

## 3. PLL 参数计算器

### 3.1 PLL 核心公式（F4/G4/L4 系列）

```
PLLCLK = HSE / PLLM * PLLN / PLLP

其中：
  PLLM: 2-63, VCO 输入分频器 (目标：VCO 输入 = 1-2MHz, F4 推荐 2MHz)
  PLLN: 50-432 (F4), 8-86 (G4), VCO 倍频系数 (VCO 输出 = 100-432MHz (F4))
  PLLP: 2/4/6/8, 主系统时钟输出分频器
  PLLQ: 2-15, USB/SDIO 时钟分频 (需得到 48MHz)
```

### 3.2 常用频率速查表 (以 8MHz HSE 为例)

| 目标频率 | 系列 | PLLM | PLLN | PLLP | PLLQ | VCO |
|----------|------|------|------|------|------|-----|
| 168 MHz | F4 | 8 | 336 | /2 | /7 | 336 |
| 180 MHz | F4 | 8 | 360 | /2 | /7 | 360 |
| 72 MHz | F1 | - | ×9 | - | - | 72 |
| 170 MHz | G4 | 2 | 85 | /2 | /4 | 340 |
| 80 MHz | L4 | 8 | 160 | /2 | /6 | 160 |
| 480 MHz | H7 | 5 | 96 | /1 | /4 | 480 |

::: tip PLL 参数验证原则
1. HSE/PLLM 必须在 VCO 输入范围内 (通常 1-2MHz, G4/H7 更宽)
2. VCO = HSE/PLLM * PLLN 必须在 VCO 输出范围内 (F4: 100-432MHz, H7: 192-836MHz)
3. USB 需要 48MHz: 确保 PLLQ 分频后得到 48MHz (VCO/PLLQ = 48)
:::

---

## 4. 时钟切换与动态调频

### 4.1 运行中切换系统时钟

```c
// 运行时从 PLL 切换到 HSI (例如低功耗前)
void SwitchTo_HSI(void) {
    // 1. 配置 AHB/APB 分频器，防止切换时总线频率超限
    // （例如 PLL=168MHz 时 APB1=42MHz，切换到 HSI=16MHz 后 APB1=16MHz 没问题）

    // 2. 选择 HSI 为系统时钟
    RCC->CFGR &= ~RCC_CFGR_SW;
    RCC->CFGR |= RCC_CFGR_SW_HSI;

    // 3. 等待切换完成
    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_HSI);

    // 4. (可选) 关闭 PLL 以省电
    RCC->CR &= ~RCC_CR_PLLON;
}

// 运行时从 HSI 切换回 PLL
void SwitchTo_PLL(void) {
    // 1. 重新使能 PLL
    RCC->CR |= RCC_CR_PLLON;
    while (!(RCC->CR & RCC_CR_PLLRDY));

    // 2. 配置 Flash 延迟（根据目标主频）
    FLASH->ACR = (FLASH->ACR & ~FLASH_ACR_LATENCY) | FLASH_ACR_LATENCY_5WS;

    // 3. 切换系统时钟到 PLL
    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_PLL;
    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL);
}
```

---

## 5. 外设时钟使能与总线架构

### 5.1 总线架构图 (F4 系列)

```
                          ┌────────────────────┐
    8MHz HSE ──→ PLL ────→│ SYSCLK (168MHz)    │
                          │    │               │
                          │    ├─ AHB (168MHz) ───→ Flash, DMA, GPIO
                          │    │                    FSMC, ETH
                          │    │                    ┌──→ 定时器 (×2 if APB≠1)
                          │    ├─ APB2 (84MHz) ────┤──→ USART1, SPI1
                          │    │                    └──→ ADC (可到 36MHz)
                          │    │                    ┌──→ 定时器 (×2 if APB≠1)
                          │    └─ APB1 (42MHz) ────┤──→ USART2-3, I2C, SPI2-3
                          │                         └──→ DAC, PWR
                          └────────────────────┘
```

::: warning APB 定时器时钟倍频规则
如果 APBx 预分频器 = 1，定时器时钟 = APBx 时钟
如果 APBx 预分频器 ≠ 1，定时器时钟 = **2 × APBx 时钟**

例如 APB1=42MHz (分频=4)，则 APB1 上的定时器 (TIM2-7) 时钟 = 84MHz。
这是为了在降低 APB1 频率的同时不给定时器限速。
:::

### 5.2 外设时钟使能函数

```c
// 外设时钟使能与关闭 (HAL 宏)
__HAL_RCC_GPIOA_CLK_ENABLE();     // GPIOA 时钟
__HAL_RCC_USART1_CLK_ENABLE();    // USART1 (APB2)
__HAL_RCC_USART2_CLK_ENABLE();    // USART2 (APB1)
__HAL_RCC_TIM1_CLK_ENABLE();      // TIM1 (APB2)
__HAL_RCC_TIM2_CLK_ENABLE();      // TIM2 (APB1)

// 关闭不用的外设时钟可节省功耗
__HAL_RCC_USART1_CLK_SLEEP_ENABLE();  // Sleep 模式下自动关闭 USART1 时钟

// 外设复位 (重新初始化前使用)
__HAL_RCC_USART1_FORCE_RESET();
__HAL_RCC_USART1_RELEASE_RESET();
```

---

## 6. 常见配置错误与排查

### 6.1 时钟配置检查清单

| # | 检查项 | 正确值 | 错误后果 |
|---|--------|--------|---------|
| 1 | Flash Latency 匹配目标主频 | F4@168MHz → WS=5 | HardFault |
| 2 | HSE 晶振频率匹配实际焊接 | 通常 8MHz 或 25MHz | 所有频率偏移 |
| 3 | HSE 晶振负载电容正确 | 根据晶振 datasheet | 晶振不起振 |
| 4 | PLL VCO 输入在有效范围内 | F4: 1-2MHz | PLL 无法锁定 |
| 5 | PLL VCO 输出在有效范围内 | F4: 100-432MHz | 时钟不稳定 |
| 6 | APB1 ≤ 最大许可频率 | F4: 42MHz, G4: 170MHz | 外设工作异常 |
| 7 | APB2 ≤ 最大许可频率 | F4: 84MHz, G4: 170MHz | 外设工作异常 |
| 8 | USB 时钟 = 48MHz | 检查 PLLQ 分频 | USB 枚举失败 |

### 6.2 典型故障

**问题1：晶振不起振**

```
症状：HAL_RCC_OscConfig() 在等待 HSE 就绪时死循环
原因：
  ├─ 晶振引脚与地之间没有加负载电容 (通常 10-22pF)
  ├─ 晶振物理损坏或焊接不良
  ├─ PCB 走线过长 (>20mm)
  └─ 晶振频率不匹配 (买了 16MHz 的焊上去了但代码配置的 8MHz)

排查：
  1. 用示波器探头 x10 档位测 OSC_IN 引脚 (不要用 x1 档, 会破坏振荡条件)
  2. 检查 PCB 上晶振的负载电容是否正确焊接
  3. 用 CubeMX 打开配置，确认 HSE 频率设置与实际焊接的晶振匹配
```

**问题2：PLL 无法锁定**

```
症状：HAL_RCC_OscConfig() 在等待 PLL 就绪时死循环
原因：PLL 参数违反了电气规范 (VCO 输入或输出频率超限)
排查：
  1. 打印或单步调试确认 PLLM、PLLN、PLLP、PLLQ 的值
  2. 计算 VCO 输入频率 = HSE/PLLM, 必须在 datasheet 规定的范围内
  3. 计算 VCO 输出频率 = VCO输入 * PLLN, 也必须在规定范围内
```

**问题3：配置后 MCU 只按 HSI 16MHz 运行**

```
症状：SYSCLK 频率没有切换到 PLL, 程序运行但速度慢
原因：SystemClock_Config() 未被调用或者在调用 HAL_RCC_ClockConfig() 前就返回了
排查：
  1. 检查 main() 中是否调用了 SystemClock_Config()
  2. 检查 HAL_RCC_ClockConfig() 的返回值
  3. 用 MCO 引脚输出 SYSCLK 到示波器实际测量频率
```

---

## 7. 参考文档

1. RM0008: STM32F1xx 参考手册 — 时钟 (RCC) 章节
2. RM0090: STM32F4xx 参考手册 — 复位和时钟控制 (RCC)
3. RM0440: STM32G4xx 参考手册 — RCC 章节
4. RM0433/RM0455: STM32H7x3/x5 参考手册 — RCC 章节 (双域时钟)
5. AN2867: 振荡器设计指南 (ST 应用笔记)
6. STM32CubeMX 用户手册 — 时钟配置章节
