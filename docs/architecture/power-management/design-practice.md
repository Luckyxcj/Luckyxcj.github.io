# 低功耗设计实战

> **文档说明**：本文档基于实际低功耗产品开发经验，涵盖功耗估算、优化技巧和硬件设计指南。

---

## 目录

1. [功耗预算与估算](#1-功耗预算与估算)
2. [功耗优化的十大技巧](#2-功耗优化的十大技巧)
3. [硬件设计中的低功耗考量](#3-硬件设计中的低功耗考量)
4. [电池选型与寿命估算](#4-电池选型与寿命估算)
5. [功耗调试与测量](#5-功耗调试与测量)
6. [参考文档](#6-参考文档)

---

## 1. 功耗预算与估算

### 1.1 功耗来源分解

```
MCU 系统总功耗 = P_RUN × t_RUN + P_SLEEP × t_SLEEP + P_PERIPH + P_STATIC

其中:
  P_RUN   = 处理状态功耗 (内核 + Flash + SRAM)
  t_RUN   = 运行时间占比
  P_SLEEP = 低功耗模式功耗
  t_SLEEP = 睡眠时间占比
  P_PERIPH = 外设功耗 (射频、传感器、LED 等)
  P_STATIC = 静态漏电流 (PCB 上的电阻分压器、LDO 静态电流)
```

### 1.2 功耗预算表模板

| 组件 | 工作电流 | 工作时间 | 间歇电流 | 间歇时间 | 平均电流 |
|------|---------|---------|---------|---------|---------|
| MCU (Run 80MHz) | 8 mA | 10 ms/s | - | - | 0.08 mA |
| MCU (Stop 2) | 4 μA | - | 4 μA | 990 ms | 0.004 mA |
| BLE (TX) | 15 mA | 2 ms/s | - | - | 0.03 mA |
| BLE (Sleep) | 1 μA | - | 1 μA | 998 ms | 0.001 mA |
| 传感器 (运行) | 2 mA | 5 ms/s | - | - | 0.01 mA |
| 传感器 (断电) | 0 μA | - | 0 μA | 995 ms | 0 mA |
| LDO 静态电流 | 2 μA | 持续 | - | - | 0.002 mA |
| PCB 漏电 | 1 μA | 持续 | - | - | 0.001 mA |
| **总计** | | | | | **~0.128 mA** |

```
电池寿命 = 电池容量 (mAh) / 平均电流 (mA) × 可用系数
         = 200 mAh / 0.128 mA × 0.85 (自放电和安全余量)
         ≈ 1328 小时 ≈ 55 天 (CR2032 纽扣电池)
```

---

## 2. 功耗优化的十大技巧

### 技巧 1-5: 软件优化

**1. 降低主频**：不需要最大算力时降频，功耗几乎线性下降。
```c
// 动态降频: 计算任务时 168MHz, 等待时降到 8MHz (HSI)
void Scale_Down_Clock(void) {
    // 切换到 HSI 8MHz
    RCC->CFGR = (RCC->CFGR & ~RCC_CFGR_SW) | RCC_CFGR_SW_HSI;
    while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_HSI);
    // 关闭 PLL 和 HSE (省几 mA)
    RCC->CR &= ~(RCC_CR_PLLON | RCC_CR_HSEON);
}
```

**2. 关闭未使用的外设时钟**：
```c
__HAL_RCC_USART1_CLK_DISABLE();  // 不用时关闭
__HAL_RCC_SPI1_CLK_DISABLE();
__HAL_RCC_TIM3_CLK_DISABLE();
```

**3. 用 DMA 替代 CPU 轮询**：CPU 在 Sleep 模式下 DMA 仍能工作，大幅降低平均电流。

**4. 合理设置 GPIO 状态**：
```c
// 未使用的 GPIO → Analog 模式 (功耗最低)
gpio.Mode = GPIO_MODE_ANALOG;
gpio.Pull = GPIO_NOPULL;

// 外部上拉电阻的 GPIO → 输出低电平 (避免通过电阻耗电)
// 外部下拉电阻的 GPIO → 输出高电平
```

**5. 减少主时钟检查频率**：Tickless 模式，减少不必要的定时器中断。

### 技巧 6-10: 硬件优化

**6. 选择低功耗 LDO（而非普通 LDO）**：静态电流从 10μA (TPS7A02) 到 2mA (AMS1117) 差别巨大。

**7. 电阻分压检测电池电压的电路**：检测时用 GPIO 控制 N-MOS 通断，不检测时断电。

**8. 外部上拉电阻 ≥ 100kΩ**：I2C 上拉用 10kΩ → 改为 100kΩ (但对高速 I2C 不利)。

**9. 传感器使用 GPIO 直接供电**：当 GPIO 驱动电流足够时（<8mA），可以直接用 GPIO 为传感器供电，不采样时关断 GPIO。

**10. 选择低功耗传感器**：例如 BME280 (温湿度压力) 在 1Hz 采样时仅 3.6μA。

---

## 3. 硬件设计中的低功耗考量

### 3.1 GPIO 供电传感器的硬件方案

```
GPIO_PB5 ─────┬───── VDD_SENSOR (传感器供电)
              │
            100nF
              │
             GND

在不采样时: GPIO PB5 输出 0 (传感器断电, 0μA)
采样时:     GPIO PB5 输出 1 (传感器供电, GPIO 提供 ≤8mA)
```

### 3.2 电池电压检测电路 (零功耗待机)

```
BAT+ ─── 1MΩ ───┬─── ADC_IN ─── 100nF ── GND
                 │
            N-MOS (由 GPIO 控制)
                 │
                GND

不检测时: N-MOS 断开 (100nF 电容隔离 DC 电流, 几乎 0 功耗)
检测时: N-MOS 导通 → 电阻分压 → ADC 采样
```

---

## 4. 电池选型与寿命估算

| 电池类型 | 标称电压 | 容量范围 | 自放电率 | 适用场景 |
|----------|---------|---------|---------|---------|
| CR2032 纽扣 | 3.0V | 200-240 mAh | ~1%/年 | 低功耗传感器节点 |
| ER14505 锂亚 | 3.6V | 2400 mAh | <1%/年 | 远距离 IoT (NB-IoT/LoRa) |
| Li-Po | 3.7V | 100-5000 mAh | ~5%/月 | 可充电设备 |
| AA 碱性 ×2 | 3.0V | 2000-3000 mAh | ~3%/年 | 成本敏感 |

### 4.1 寿命估算公式

```
电池寿命 (天) = 容量(mAh) × 温度系数 × 自放电系数 / (平均电流(mA) × 24)

其中：
  温度系数 = 高温下电池容量降低 (0°C以下尤其明显)
  自放电系数 = 0.9~0.95 (锂原电池), 0.7~0.8 (碱性)
```

---

## 5. 功耗调试与测量

### 5.1 调试工具

| 工具 | 精度 | 带宽 | 适用场景 |
|------|------|------|---------|
| 万用表 | 0.1μA 分辨率 | 慢 (几次/秒) | 稳定态电流测量 |
| Nordic PPK2 | 0.2μA | 100 kSps | IoT 设备功耗分析 (推荐, ¥600) |
| Joulescope JS220 | 2nA | 2 MSps | 高精度功耗分析 (专业, $800) |
| 数字示波器+采样电阻 | 取决于示波器 | 高 | 瞬态电流波形 |

### 5.2 自测电流的方法

```c
// 使用 MCU 内部的 ADC 间接测量功耗
// 需要硬件上有一个低侧采样电阻 (0.1Ω)
// 电流 = (ADC读数 × VREF/4096) / 0.1Ω

void Measure_Current_Monitor(void) {
    HAL_ADC_Start(&hadc1);
    if (HAL_ADC_PollForConversion(&hadc1, 10) == HAL_OK) {
        uint32_t adc_val = HAL_ADC_GetValue(&hadc1);
        float current_ma = (adc_val * 3.3f / 4096.0f) / 0.1f * 1000.0f;
        printf("Current: %.2f mA\n", current_ma);
    }
}
```

### 5.3 低功耗测量清单

- [ ] 拔掉调试器 (SWD/JTAG 接口持续漏电)
- [ ] 断开开发板上的 USB-UART 芯片 (CP2102/CH340 常态耗电 3-5mA)
- [ ] 断开所有 LED (每个 LED 耗电 1-10mA)
- [ ] 关闭所有上拉电阻 (I2C/SPI 的上拉电阻通过 GPIO 漏电)
- [ ] 检查 LDO 是否低功耗 (AMS1117 静态电流 5-10mA!)
- [ ] 确认所有未使用的 GPIO 配置为 Analog 模式

---

## 6. 参考文档

1. ST AN5105: STM32G0 低功耗模式
2. Nordic Power Profiler Kit II (PPK2) 用户手册
3. "Ultra-Low Power Design" — Jack Ganssle, Embedded Systems Conference
4. nRF52840 Product Specification — 功耗特征章节
5. STM32L4+ 数据手册 — 电气特性中的功耗表格
