# ADC / DAC 模数数模转换

> **文档说明**：本文档基于 STM32 参考手册 ADC/DAC 章节及精密测量应用笔记整理。

---

## 目录

1. [ADC 基础概念](#1-adc-基础概念)
2. [STM32 ADC 配置与使用](#2-stm32-adc-配置与使用)
3. [提高 ADC 精度](#3-提高-adc-精度)
4. [DAC 输出配置](#4-dac-输出配置)
5. [常见问题与排查](#5-常见问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. ADC 基础概念

### 1.1 ADC 关键参数

| 参数 | 说明 | STM32 典型值 |
|------|------|-------------|
| 分辨率 | ADC 输出的 bit 数 | 12-bit (0-4095) |
| 采样率 | 每秒采样次数 | F4: 2.4 Msps (单 ADC) / 7.2 Msps (三重交替) |
| INL (积分非线性) | 理想 vs 实际转换曲线的最大偏差 | ±2 LSB (典型) |
| DNL (微分非线性) | 相邻码值的步长偏差 | ±1 LSB (典型) |
| ENOB (有效位数) | 考虑噪声后的实际分辨率 | ~10.5 bit (F4, 实际) |
| 输入阻抗 | ADC 输入的等效电阻 | 取决于采样时间, 典型 < 50kΩ |

```
12-bit ADC 输出公式:

  ADC_output = (V_in / V_ref) × 4095

其中:
  V_ref = VDDA (通常 3.3V), 也可以外接基准源
  ADC_output = 0 ... 4095 (12-bit)
```

---

## 2. STM32 ADC 配置与使用

### 2.1 单通道轮询采集

```c
ADC_HandleTypeDef hadc1;

void MX_ADC1_Init(void) {
    hadc1.Instance = ADC1;
    hadc1.Init.ClockPrescaler = ADC_CLOCK_SYNC_PCLK_DIV4;  // ADC CLK = PCLK2/4
    hadc1.Init.Resolution = ADC_RESOLUTION_12B;               // 12-bit
    hadc1.Init.ScanConvMode = DISABLE;                        // 单通道
    hadc1.Init.ContinuousConvMode = DISABLE;                  // 单次转换
    hadc1.Init.DataAlign = ADC_DATAALIGN_RIGHT;
    hadc1.Init.NbrOfConversion = 1;
    hadc1.Init.EOCSelection = ADC_EOC_SINGLE_CONV;
    HAL_ADC_Init(&hadc1);
}

// 单次采集
uint16_t ADC_Read_Channel(uint32_t channel) {
    ADC_ChannelConfTypeDef sConfig = {0};
    sConfig.Channel = channel;
    sConfig.Rank = 1;
    sConfig.SamplingTime = ADC_SAMPLETIME_480CYCLES;  // 采样时间: 更长时间=更高精度
    HAL_ADC_ConfigChannel(&hadc1, &sConfig);

    HAL_ADC_Start(&hadc1);
    HAL_ADC_PollForConversion(&hadc1, 100);            // 等待转换完成
    return HAL_ADC_GetValue(&hadc1);
}
```

### 2.2 DMA 连续多通道采集

```c
#define ADC_BUF_SIZE  (8 * 2)  // 8 通道, 每个通道 2 次采样用于平均
uint16_t adc_dma_buf[ADC_BUF_SIZE];

void ADC_DMA_Init(void) {
    // ADC 配置为扫描模式 + 连续转换 + DMA
    hadc1.Init.ScanConvMode = ENABLE;
    hadc1.Init.ContinuousConvMode = ENABLE;
    hadc1.Init.NbrOfConversion = 8;
    HAL_ADC_Init(&hadc1);

    // 配置 8 个通道
    uint32_t channels[8] = {
        ADC_CHANNEL_0, ADC_CHANNEL_1, ADC_CHANNEL_2,
        ADC_CHANNEL_3, ADC_CHANNEL_4, ADC_CHANNEL_5,
        ADC_CHANNEL_6, ADC_CHANNEL_7,
    };
    for (int i = 0; i < 8; i++) {
        ADC_ChannelConfTypeDef sConfig = {0};
        sConfig.Channel = channels[i];
        sConfig.Rank = i + 1;
        sConfig.SamplingTime = ADC_SAMPLETIME_144CYCLES;
        HAL_ADC_ConfigChannel(&hadc1, &sConfig);
    }

    // 启动 DMA 连续采集
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_dma_buf, ADC_BUF_SIZE);
}
```

---

## 3. 提高 ADC 精度

### 3.1 硬件层面

```
提高 ADC 精度的十大硬件技巧:

1. 独立的 VREF+ 基准源 (如 REF3033: 3.3V, 50ppm/°C)
2. VDDA 独立供电 (与数字 VDD 分开, 通过磁珠隔离)
3. VREF+/VDDA 加 10μF + 100nF 去耦电容
4. ADC 输入引脚对地加 1nF 电容 (低通滤波)
5. 模拟信号线远离数字/开关信号 (>5mm 间距)
6. 对微弱信号 (<100mV) 用外部运放放大后再进 ADC
7. 使用差分 ADC 模式抑制共模噪声 (部分 STM32 支持)
8. ADC 输入走线下方铺模拟地 (模拟 GND)
9. 无源晶振远离 ADC 输入走线
10. 使用 4 层 PCB (独立的模拟地层)
```

### 3.2 软件层面

```c
// 过采样与平均 (Oversampling and Averaging)
// 原理: 每增加 4 次过采样, ENOB 提高 1 bit
// 4^2=16 次过采样 → +2 bit → 14-bit 等效分辨率

#define OVERSAMPLE_COUNT  64  // 64 次采样 → +3 bit (12→15 bit)

uint16_t ADC_Read_Oversampled(uint32_t channel) {
    uint32_t sum = 0;
    for (int i = 0; i < OVERSAMPLE_COUNT; i++) {
        sum += ADC_Read_Channel(channel);
    }
    // 64 次平均: sum/64, 并右移以保持 12-bit 对齐
    return (uint16_t)(sum / OVERSAMPLE_COUNT);
}

// 中值滤波 (移除尖峰噪声)
uint16_t ADC_Read_Median_Filtered(uint32_t channel, int samples) {
    uint16_t buf[32];  // 最大 32 个样本
    for (int i = 0; i < samples; i++) {
        buf[i] = ADC_Read_Channel(channel);
    }
    // 排序
    for (int i = 0; i < samples - 1; i++) {
        for (int j = i + 1; j < samples; j++) {
            if (buf[i] > buf[j]) {
                uint16_t tmp = buf[i]; buf[i] = buf[j]; buf[j] = tmp;
            }
        }
    }
    return buf[samples / 2];  // 中值
}
```

---

## 4. DAC 输出配置

```c
DAC_HandleTypeDef hdac;

void MX_DAC_Init(void) {
    hdac.Instance = DAC;
    HAL_DAC_Init(&hdac);

    DAC_ChannelConfTypeDef sConfig = {0};
    sConfig.DAC_Trigger = DAC_TRIGGER_NONE;          // 软件触发
    sConfig.DAC_OutputBuffer = DAC_OUTPUTBUFFER_ENABLE;
    HAL_DAC_ConfigChannel(&hdac, &sConfig, DAC_CHANNEL_1);
}

// 输出指定电压 (DAC 12-bit)
void DAC_SetVoltage(float voltage) {
    // V_out = DAC_Value × VREF / 4096
    uint32_t dac_val = (uint32_t)(voltage * 4095.0f / 3.3f);
    HAL_DAC_SetValue(&hdac, DAC_CHANNEL_1, DAC_ALIGN_12B_R, dac_val);
    HAL_DAC_Start(&hdac, DAC_CHANNEL_1);
}
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | ADC 读数跳动严重 (±50 LSB) | 电源噪声或参考源不干净 | VDDA 加强去耦; 增加采样时间 |
| 2 | ADC 值总是接近 0 或 4095 | 输入引脚电平超范围 | 检查引脚电压是否在 0-VREF 之间 |
| 3 | 多通道 ADC 值相互串扰 | 采样时间太短, 采样电容未充满 | 增加采样时间到 144+ 周期 |
| 4 | 12-bit ADC 有效位只有 9-10 bit | PCB 布局噪声, 在数字电路中走模拟信号 | 模拟信号走线远离数字信号, 加模拟地 |
| 5 | F1 系列 ADC 精度明显低于 F4 | F1 的 ADC 参考内部 VREFINT 较不稳定 | 外接精密基准源; 或使用 F4/G4 系列 |

---

## 6. 参考文档

1. RM0090: STM32F4xx 参考手册 — ADC/DAC 章节
2. ST AN2834: ADC 精度提高技巧 (How to get the best ADC accuracy)
3. ST AN4073: ADC 过采样技术
4. ST AN3126: DAC 使用指南
