# STM32 系列深度指南

> **文档说明**：本文档基于 STMicroelectronics 官方参考手册 (RM0008, RM0090, RM0433 等)、数据手册及应用笔记 AN2606、AN4661、AN4899 等整理。

---

## 目录

1. [系列命名规则解码](#1-系列命名规则解码)
2. [各系列深度对比](#2-各系列深度对比)
3. [内核与性能测试](#3-内核与性能测试)
4. [外设差异与迁移注意事项](#4-外设差异与迁移注意事项)
5. [选型决策树](#5-选型决策树)
6. [常见问题](#6-常见问题)
7. [参考文档](#7-参考文档)

---

## 1. 系列命名规则解码

以 `STM32F407VGT6` 为例：

```
STM32 F 407 V G T 6
  │   │  │  │ │ │ └── 温度范围: 6=-40~85°C, 7=-40~105°C
  │   │  │  │ │ └──── 封装: T=LQFP, I=UFBGA, Y=WLCSP, H=BGA
  │   │  │  │ └────── Flash 容量: B=128KB, C=256KB, E=512KB, G=1MB, I=2MB
  │   │  │  └──────── 引脚数: V=100pin, R=64pin, Z=144pin, C=48pin
  │   │  └─────────── 子系列: 407=高性能, 405=基础版(无LCD), 401=入门
  │   └────────────── 系列: F=基础, G=主流, H=高性能, L=低功耗, U=超低功耗, WB=无线
  └────────────────── 产品线: STM32
```

### 系列字母含义速查

| 字母 | 含义 | 典型定位 |
|------|------|---------|
| **F** | Foundation (基础) | 经典系列, 成熟稳定 |
| **G** | General-purpose (通用主流) | 新一代主流, 性价比优化 |
| **H** | High-performance (高性能) | Cortex-M7/M33, 运算密集型 |
| **L** | Low-power (低功耗) | 电池供电应用 |
| **U** | Ultra-low-power (超低功耗) | 最新超低功耗技术 |
| **WB** | Wireless BLE | 双核 BLE SoC |
| **WL** | Wireless LoRa | 远距离 LoRa SoC |
| **MP** | Multi-processor (多核应用处理器) | Cortex-A + Cortex-M 异构 |

---

## 2. 各系列深度对比

### 2.1 Cortex-M0/M0+ 入门系列 (F0, G0, L0)

**定位**：替代传统 8/16 位单片机，成本极其敏感。

| 特性 | STM32F0 | STM32G0 | STM32L0 |
|------|---------|---------|---------|
| 内核 | Cortex-M0 | Cortex-M0+ | Cortex-M0+ |
| 主频 | 48 MHz | 64 MHz | 32 MHz |
| Flash | 16-256 KB | 16-512 KB | 16-192 KB |
| SRAM | 4-32 KB | 8-128 KB | 8-20 KB |
| DMA 通道 | 5-7 | 7 | 7 |
| USART | 1-8 | 3-8 | 1-5 |
| I2C | 1-2 | 2-3 | 1-3 |
| SPI | 1-2 | 2-3 | 1-2 |
| ADC | 12-bit, 1 Msps | 12-bit, 2 Msps | 12-bit, 1 Msps |
| USB | 部分有 (Crystal-less 可选) | USB-C PD | 部分有 |
| CAN | 部分型号 | FDCAN×1 | 无 |
| 工作电压 | 2.0-3.6V | 1.7-3.6V | 1.65-3.6V |
| 特色功能 | 低成本 | USB-C PD, 更大 SRAM | EEPROM 真存储 |

**推荐场景**：
- STM32F0: 替代 STM8/AVR, 简单家电
- STM32G0: USB-C 充电器, 传感器节点 (F0 的后继者)
- STM32L0: 纽扣电池设备, EEPROM 替代

**代码示例**: F0/G0 的引脚映射更加灵活，GPIO 几乎可以映射到任意引脚，简化 PCB 布局。

```c
// STM32G0 GPIO 配置示例 (HAL)
// G0 系列几乎所有外设都可以映射到任意 GPIO，这极大简化了 PCB 设计
void GPIO_Init_Example(void) {
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();

    GPIO_InitTypeDef gpio = {0};
    gpio.Mode = GPIO_MODE_AF_PP;
    gpio.Pull = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;

    // USART2_TX on PA2 (AF1)
    gpio.Pin = GPIO_PIN_2;
    gpio.Alternate = GPIO_AF1_USART2;
    HAL_GPIO_Init(GPIOA, &gpio);

    // 注意：G0 系列支持将 USART2_TX 重映射到 PB5，这在 F1 系列中是不可能的
    gpio.Pin = GPIO_PIN_3;
    gpio.Alternate = GPIO_AF0_SPI1;  // SPI1 on PA3
    HAL_GPIO_Init(GPIOA, &gpio);
}
```

### 2.2 Cortex-M3 经典系列 (F1, F2)

| 特性 | STM32F1 | STM32F2 |
|------|---------|---------|
| 内核 | Cortex-M3 | Cortex-M3 |
| 主频 | 72 MHz | 120 MHz |
| Flash 范围 | 16 KB - 1 MB | 128 KB - 1 MB |
| SRAM 范围 | 4 KB - 96 KB | 64 KB - 128 KB |
| 核心优势 | 经典长青、社区最强 | F1 高性能版 |
| 当前定位 | 教学, 简单工业 | 已逐步被 F4 替代 |

```
STM32F1 的价值与限制:

优点：                          缺点：
├─ 社区资源全球最丰富           ├─ 主频 72MHz 已显低
├─ 网友写的例程覆盖所有场景      ├─ ADC 精度受限于内部参考
├─ 淘宝开发板 ¥15 起             ├─ 无 FPU (浮点运算纯软件)
├─ 大量现成项目可直接移植        ├─ SPI 时钟最高 18MHz
└─ 极好的教学芯片                └─ 12-bit ADC 有效位仅约 9-10
```

::: warning F1 系列局限性
F1 的 SPI 最高时钟为 PCLK/2（即 36MHz/2=18MHz），而 F4/G4 可以到 PCLK/2=42MHz 甚至更高。如果你需要驱动高速 SPI 屏或 Flash，F1 不适合。
:::

### 2.3 Cortex-M4F 高性能系列 (F3, F4, G4, L4)

**核心差异**：全部带 FPU+DSP 指令集，但目标应用不同。

| 系列 | 核心定位 | 主频 | 关键特色 |
|------|---------|------|---------|
| **F3** | 混合信号/电机控制 | 72 MHz | 16-bit ADC, 内置运放/比较器 |
| **F4** | 通用高性能 | 84-180 MHz | 均衡的性能/功耗, LCD-TFT 控制器 |
| **G4** | 电机控制/数字电源 (F3 升级) | 170 MHz | CORDIC 协处理器, 滤波加速器, 高精度定时器 |
| **L4** | 低功耗中的高性能 | 80 MHz | 40nm 制程, 极低功耗下的 FPU 支持 |

**F3 vs G4 详细对比（电机控制选型关键）**：

| 电机控制特性 | STM32F303 | STM32G474 |
|-------------|-----------|-----------|
| 高级定时器 | 2 个 (TIM1, TIM8) | 3 个 (HRTIM + TIM1 + TIM8) |
| 高精度 PWM | 标准 | HRTIM 分辨率达 184ps |
| ADC 同步 | 最多 4 路同步 | 最多 5 路同步 |
| 内置运放 | 4 个 | 6 个 |
| 内置比较器 | 7 个 | 7 个 |
| CORDIC | 无 (软件计算) | 硬件 CORDIC |
| FMAC (滤波) | 无 | 有 (数字滤波器加速器) |

```c
// STM32G474 HRTIM 高精度 PWM 配置示例
// HRTIM 可实现 184ps 分辨率，远超传统定时器的几 ns 级别
void HRTIM_SimplePWM_Config(void) {
    HRTIM_TimeBaseCfgTypeDef tb = {0};
    HRTIM_SimplePWMChannelCfgTypeDef pwm_ch = {0};

    // Timer A 工作在连续模式，频率 = 144MHz / 28800 = 5kHz
    tb.Period = 28800;
    tb.RepetitionCounter = 0;
    tb.PrescalerRatio = HRTIM_PRESCALERRATIO_DIV1;
    tb.Mode = HRTIM_MODE_CONTINUOUS;
    HAL_HRTIM_TimeBaseConfig(&hhrtim1, HRTIM_TIMERINDEX_TIMER_A, &tb);

    // PWM 输出配置: 占空比 50%
    pwm_ch.Pulse = 14400;
    pwm_ch.Polarity = HRTIM_OUTPUTPOLARITY_HIGH;
    HAL_HRTIM_SimplePWMChannelConfig(&hhrtim1, HRTIM_TIMERINDEX_TIMER_A,
                                      HRTIM_OUTPUT_TA1, &pwm_ch);
}
```

### 2.4 Cortex-M7 高性能旗舰 (F7, H7)

| 特性 | STM32F7 | STM32H7 |
|------|---------|---------|
| 内核 | Cortex-M7 | Cortex-M7 (双精度 FPU) |
| 主频 | 216 MHz | 480-600 MHz |
| 超标量流水线 | 6 级双发射 | 6 级双发射 |
| L1 Cache | 4KB I + 4KB D | 16KB I + 16KB D |
| Flash 加速 | ART Accelerator | ART + Prefetch |
| 核心优势 | 多媒体处理 | 绝对性能王者 |

**H7 特有的架构亮点**：
- **双精度 FPU**：F7 仅为单精度，H7 支持双精度浮点硬件
- **Chrom-ART (DMA2D)**：硬件 2D 图形加速，适合带屏 HMI
- **JPEG Codec**：硬件 JPEG 编解码
- **MIPI DSI**：直接驱动 MIPI 接口屏幕

```c
// STM32H7 Cache 维护操作（必须做，否则 DMA 会出现数据一致性问题）
// H7 有 L1 Cache，CPU 写入的数据可能在 Cache 中未刷到 SRAM
// DMA 读取的是 SRAM 而不是 Cache，导致读到旧数据

#define TX_BUFFER   ((uint32_t)0x24000000)  // AXI SRAM
#define TX_BUF_SIZE 256

void H7_Cache_Maintenance_Example(void) {
    uint8_t tx_data[TX_BUF_SIZE];

    // 填充发送数据
    for (int i = 0; i < TX_BUF_SIZE; i++) tx_data[i] = i;

    // 【关键】发送前：Clean CPU Cache → SRAM
    // 确保 DMA 能读到最新的数据
    SCB_CleanDCache_by_Addr((uint32_t *)tx_data, TX_BUF_SIZE);

    // 启动 DMA 发送
    HAL_UART_Transmit_DMA(&huart1, tx_data, TX_BUF_SIZE);

    // 接收前：Invalidate CPU Cache ← SRAM
    // 确保 CPU 能读到 DMA 写入的最新数据
    // 通常在 DMA 接收完成中断中执行
    SCB_InvalidateDCache_by_Addr((uint32_t *)rx_buffer, rx_size);
}
```

### 2.5 无线系列 (WB, WL)

| 特性 | STM32WB | STM32WL |
|------|---------|---------|
| 架构 | M4 (app) + M0+ (radio) | M4 (app) + M0+ (radio) |
| 无线协议 | BLE 5.4, Zigbee, Thread | LoRa, (G)FSK, BPSK |
| 主频 | 64 MHz | 48 MHz |
| Flash | 256 KB - 1 MB | 256 KB |
| 应用 | 穿戴、传感器网络 | 远距物联网(数公里) |

---

## 3. 内核与性能测试

### 3.1 CoreMark 跑分对比

| 系列 | 内核 | 主频 | CoreMark | CoreMark/MHz |
|------|------|------|----------|-------------|
| STM32F103 | M3 | 72 MHz | 112 | 1.55 |
| STM32F407 | M4F | 168 MHz | 566 | 3.37 |
| STM32F746 | M7 | 216 MHz | 1082 | 5.01 |
| STM32H743 | M7 | 480 MHz | 2420 | 5.04 |
| STM32G474 | M4F | 170 MHz | 574 | 3.38 |

::: tip CoreMark 的实用性
CoreMark/MHz 可以用来估算你的算法在不同 MCU 上的执行时间。例如，如果你的算法在 F407 上跑需要 100ms，迁移到 H743（480MHz 且 /MHz 高 1.5 倍）后，预计只需要 100ms * (168/480) * (3.37/5.04) ≈ 23ms。
:::

### 3.2 FPU 使用注意事项

所有 Cortex-M4F/M7/M33 系列都支持硬件 FPU，但 **必须在启动代码中手动启用**：

```c
// 启动文件中启用 FPU (startup_stm32f407xx.s 或 system_stm32f4xx.c)
// 方法1: 在 system_stm32f4xx.c 的 SystemInit() 中
void SystemInit(void) {
    // ... 时钟配置 ...

    // FPU 设置
    #if (__FPU_PRESENT == 1) && (__FPU_USED == 1)
    SCB->CPACR |= ((3UL << 10*2) | (3UL << 11*2));  // CP10, CP11 full access
    #endif
}

// 方法2: 编译器选项 -mfloat-abi=hard -mfpu=fpv4-sp-d16 (F4 系列)
//        编译器选项 -mfloat-abi=hard -mfpu=fpv5-d16 (F7 系列)
//        编译器选项 -mfloat-abi=hard -mfpu=fpv5-sp-d16 (H7 单精度)
//        编译器选项 -mfloat-abi=hard -mfpu=fpv5-d16 (H7 双精度)
```

---

## 4. 外设差异与迁移注意事项

### 4.1 F1 → F4 迁移关键差异

| 外设 | STM32F1 | STM32F4 | 迁移注意 |
|------|---------|---------|---------|
| GPIO | 直接操作 IDR/ODR | 同样, 但 ODR 更快 | 硬件兼容 |
| SPI | 最大 PCLK/2 | 最大 PCLK/2 | 注意时钟极性配置差异 |
| I2C | 标准 I2C | 升级版 I2C | F4 I2C 需要额外配置 TIMINGR |
| USART | 标准 | 增加 Oversampling by 8 | 波特率计算略有差异 |
| ADC | 12-bit 单 ADC | 12-bit 3 ADC 交替 | F4 支持三 ADC 交替采样达 7.2Msps |
| DMA | 标准 | 双 DMA 控制器 + 数据流 | FIFO、burst 模式是新增的 |

### 4.2 从标准库迁移到 HAL 库

```
标准库 (Standard Peripheral Library) 已停止维护，所有新项目都应使用 HAL/LL。

迁移策略：
1. 使用 CubeMX 重新生成初始化代码（GPIO, 时钟, 外设配置）
2. 保留应用层逻辑代码，只替换硬件操作部分
3. 标准库的 xxx_Cmd() → HAL_xxx_Start() / __HAL_xxx_ENABLE()
4. 标准库的 xxx_GetFlagStatus() → __HAL_xxx_GET_FLAG() 或 HAL_xxx_GetState()
5. 中断处理函数名有变化，需要在 stm32fxxx_it.c 中更新
```

---

## 5. 选型决策树

```
开始选型
│
├─ 需要无线连接？
│  ├─ BLE → STM32WB / nRF52
│  ├─ LoRa → STM32WL
│  └─ WiFi → ESP32 (非 ST) 或 STM32 + 外部 WiFi 模组
│
├─ 电池供电+超低功耗 + 高性能？
│  ├─ 是 → STM32U5 (最先进低功耗) / STM32L4 (平衡)
│  └─ 否 → 继续
│
├─ 电机控制 / 数字电源？
│  ├─ 高精度 PWM (FOC) → STM32G474 (HRTIM)
│  ├─ 通用电机控制 → STM32F303
│  └─ 简单 PWM → 任意 M4 系列
│
├─ 需要显示/图形？
│  ├─ 复杂 GUI + 大屏 → STM32H7 (DMA2D + JPEG + MIPI DSI)
│  ├─ 简单 TFT 屏 → STM32F4 (LTDC 控制器)
│  └─ 段码/字符 LCD → 任意系列
│
├─ 通用嵌入式应用
│  ├─ 成本极敏感 → STM32G0 / F0
│  ├─ 性价比均衡 → STM32F4 (168MHz) / STM32G4 (170MHz)
│  └─ 计算密集型 → STM32H7
│
└─ 车规级
   ├─ 成本敏感 → STM32A0 (新系列, ASIL-A)
   ├─ 车身控制 → STM32G0 (AEC-Q100)
   └─ 动力/底盘 → SPC58 (PowerPC) 或 S32K3 (Cortex-M7)
```

---

## 6. 常见问题

| # | 问题 | 解答 |
|---|------|------|
| 1 | F1 和 F4 代码能直接互换吗？ | 不能。外设寄存器不同，HAL 库也分版本。需要用 CubeMX 重新生成初始化代码。 |
| 2 | G4 系列能替代 F3 吗？ | 大部分可以。G4 是 F3 的升级版，主频翻倍，HRTIM 精度更高。F3 的低端型号（F301）仍有一定成本优势。 |
| 3 | H7 的 Cache 一定需要维护吗？ | 是。只要用 DMA，就必须 Clean/Invalidate Cache。否则 DMA 和 CPU 看到的数据不一致，这是嵌入式领域最隐蔽的 Bug 之一。 |
| 4 | STM32CubeIDE 免费吗？ | 是。它基于 Eclipse/GCC，无代码限制。商业开发完全免费。 |
| 5 | L4 和 U5 怎么选？ | L4 适合 80MHz 以下、功耗约 100uA/MHz 的场景。U5 是 L4 的下一代，160MHz，功耗约 19uA/MHz，适合对功耗和性能都有高要求的场景。 |
| 6 | 同一个系列不同尾缀的引脚兼容吗？ | **不一定！** 同封装下通常引脚相同，但检查数据手册的 Pinout 章节。一些特殊功能（如 USB、ETH）可能在特定封装上不可用。 |

---

## 7. 参考文档

### 应用笔记 (Application Notes)

| 编号 | 标题 | 链接 |
|------|------|------|
| AN2606 | STM32 系统存储器启动模式 — Bootloader 协议定义 | [PDF](https://www.st.com/resource/en/application_note/an2606-stm32-microcontroller-system-memory-boot-mode-stmicroelectronics.pdf) |
| AN4661 | STM32F7 系列硬件开发入门 | [PDF](https://www.st.com/resource/en/application_note/an4661-getting-started-with-stm32f7-series-mcu-hardware-development-stmicroelectronics.pdf) |
| AN4660 | STM32F4 → F7 迁移指南 (F4/F2/F1 至 F7) | [PDF](https://www.st.com/resource/en/application_note/an4660-migration-of-microcontroller-applications-from-stm32f42xxx-f43xxx-to-stm32f7-series-stmicroelectronics.pdf) |
| AN4899 | STM32G0 系列从 F0 的迁移指南 | [PDF](https://www.st.com/resource/en/application_note/an4899-migration-from-stm32f0-to-stm32g0-microcontrollers-stmicroelectronics.pdf) |
| AN5094 | STM32G4 系列从 F3 的迁移指南 | [PDF](https://www.st.com/resource/en/application_note/an5094-migrating-between-stm32f334303-lines-and-stm32g431xx-g474xx-g491xx-microcontrollers-stmicroelectronics.pdf) |

### 参考手册 (Reference Manuals)

| 编号 | 标题 | 链接 |
|------|------|------|
| RM0008 | STM32F1xx 参考手册 | [PDF](https://www.st.com/resource/en/reference_manual/rm0008-stm32f10xxx-reference-manual-stmicroelectronics.pdf) |
| RM0090 | STM32F4xx 参考手册 | [PDF](https://www.st.com/resource/en/reference_manual/rm0090-stm32f405415-stm32f407417-stm32f427437-and-stm32f429439-advanced-armbased-32bit-mcus-stmicroelectronics.pdf) |
| RM0440 | STM32G4xx 参考手册 | [PDF](https://www.st.com/resource/en/reference_manual/rm0440-stm32g4-series-advanced-armbased-32bit-mcus-stmicroelectronics.pdf) |
| RM0455 | STM32H7A3/B3 参考手册 | [PDF](https://www.st.com/resource/en/reference_manual/rm0455-stm32h7a37b3-and-stm32h7b0-value-line-advanced-armbased-32bit-mcus-stmicroelectronics.pdf) |

### 其他资源

- [STM32 产品选择器 (ST 官网)](https://www.st.com/en/microcontrollers-microprocessors/stm32-32-bit-arm-cortex-mcus.html)
- [Arm Cortex-M 处理器对比](https://developer.arm.com/Processors/Cortex-M)

> **注意**：原文中的 AN4661 实际标题为 STM32F7 硬件开发入门，F4→F7 迁移指南为 AN4660，已在表中补充。AN5093 应为 AN5094，已修正。
