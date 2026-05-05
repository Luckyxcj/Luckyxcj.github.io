# 逻辑分析仪使用

> **文档说明**：本文档基于 Saleae Logic 用户手册、PulseView/sigrok 文档及实际项目调试经验整理。

---

## 目录

1. [为什么需要逻辑分析仪](#1-为什么需要逻辑分析仪)
2. [主流逻辑分析仪对比](#2-主流逻辑分析仪对比)
3. [PulseView + 廉价 USB 分析仪](#3-pulseview--廉价-usb-分析仪)
4. [协议解码实战](#4-协议解码实战)
5. [高级使用技巧](#5-高级使用技巧)
6. [常见问题](#6-常见问题)

---

## 1. 为什么需要逻辑分析仪

逻辑分析仪是嵌入式开发中仅次于调试器的重要工具。它能同时捕获多个数字信号，并按照协议进行解码。适合分析：

- **I2C/SPI/UART 通信问题**：主机发的数据是否正确？从机有没有 ACK？时序有无问题？
- **时序毛刺与竞争**：GPIO 控制的时序是否符合芯片 datasheet 的 setup/hold 时间？
- **中断响应时间**：GPIO 中断触发到 ISR 置位另一个 GPIO 的延迟到底是多少？
- **RTOS 任务切换**：用多个 GPIO 标记不同任务的执行状态，观察调度行为

---

## 2. 主流逻辑分析仪对比

| 型号 | 通道数 | 采样率 | 价格 | 特色 |
|------|--------|--------|------|------|
| **Saleae Logic 8** | 8 | 100 MHz | $399 | 模拟采样 + 数字, 软件体验最佳 |
| **Saleae Logic Pro 16** | 16 | 500 MHz | $999 | 专业级, 大存储 |
| **DSLogic Plus** | 16 | 400 MHz | $109 | 开源, 硬件流式传输 |
| **USB 24MHz 8CH (淘宝)** | 8 | 24 MHz | ¥25-50 | 性价比极高, 配合 PulseView |
| **Kingst LA2016** | 16 | 200 MHz | ¥300+ | 国产专业, 独立软件 |
| **示波器逻辑通道** | 8-16 | 随示波器 | ¥2,000+ | 模拟+数字混合分析 |

::: tip 入门推荐
**淘宝 25-50 元的 8CH 24MHz USB 逻辑分析仪 + PulseView (免费)**。成本不到一杯咖啡，却能解决 80% 的嵌入式通信调试问题。建议焊接排针引出 I2C/SPI/UART 的测试点以便夹线。
:::

---

## 3. PulseView + 廉价 USB 分析仪

### 3.1 安装与配置

```bash
# Windows: 下载 PulseView 安装包
# https://sigrok.org/wiki/Downloads

# Linux (Debian/Ubuntu):
sudo apt install pulseview sigrok-firmware-fx2lafw

# 插入 USB 分析仪后，PulseView 自动识别
# 首次使用可能需要安装驱动: zadig_2.7.exe (libusb-win32)
```

### 3.2 基本操作流程

```
1. 连接: 分析仪的 GND → 目标板的 GND, CH0-CH7 → 被测信号
2. 设置采样率: 至少为目标信号频率的 4 倍 (I2C @ 400kHz → 采样率 ≥ 2MHz)
3. 设置触发: 选择一个通道作为触发条件 (如下降沿触发)
4. 设置采样时间: 先采集 0.5-1 秒的样本
5. 点击 Capture (采集按钮)
6. 添加协议解码器: 点击解码器图标, 选择 I2C/SPI/UART 等
7. 观察结果
```

### 3.3 协议解码器配置

```
I2C 解码:
  ├─ SCL → Channel 0
  ├─ SDA → Channel 1
  └─ 解码器自动处理 ACK/NACK

SPI 解码:
  ├─ CLK   → Channel 0
  ├─ MOSI  → Channel 2
  ├─ MISO  → Channel 3
  └─ CS    → Channel 1 (或配置为 CS# 自动检测)

UART 解码:
  ├─ TX/RX → Channel 0/1
  ├─ 波特率: 115200 (手动输入)
  ├─ 数据位: 8
  ├─ 停止位: 1
  └─ 校验: None
```

---

## 4. 协议解码实战

### 4.1 I2C 总线调试案例

```
典型 I2C 问题: 主机发送了地址，但从机没有 ACK

PulseView 中的信号分析:

SCL: ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐
     │  │ │  │ │  │ │  │ │  │ │  │ │  │ │  │ │  │ │
─────┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └── Start

SDA: ───────┐               ┌─?──
            └───────────────┘
            0 1 0 0 1 1 1   0 ← ACK? (第 9 个 bit 应该是低电平)
            (地址 0x4E + W)     ↑ 这里如果是高 → NACK → 从机不存在或地址不对
```

**排查步骤**：
1. 确认从机地址是否正确 (别搞混 7-bit/8-bit 地址)
2. 用逻辑分析仪看 SDA 的第 9 个时钟是否为低 (ACK)
3. 如果 NACK: 测一下从机的 VDD 是否正常供电
4. 如果 NACK: 确认 I2C 上拉电阻是否焊接 (通常 4.7kΩ)

### 4.2 SPI 模式配置错误检测

```c
// SPI 有 4 种模式 (CPOL × CPHA):
// Mode 0: CPOL=0, CPHA=0  (CLK 空闲低, 第 1 个边沿采样)
// Mode 1: CPOL=0, CPHA=1  (CLK 空闲低, 第 2 个边沿采样)
// Mode 2: CPOL=1, CPHA=0  (CLK 空闲高, 第 1 个边沿采样)
// Mode 3: CPOL=1, CPHA=1  (CLK 空闲高, 第 2 个边沿采样)

// 用逻辑分析仪可以直观看到:
// 如果 MOSI 数据变化在 CLK 采样边沿附近 → 可能模式配置错
// → 数据传输会有一位偏移或全乱
```

---

## 5. 高级使用技巧

### 5.1 用逻辑分析仪测量中断延迟

```c
// 在 GPIO 中断处理中翻转一个空闲的 GPIO
// 然后在逻辑分析仪上测量外部事件到 GPIO 翻转的时间差

// 外部触发信号连接到 CH0 (输入)
// 中断响应标记信号连接到 CH1 (GPIO 输出)

void EXTI0_IRQHandler(void) {
    // 立即翻转标记引脚
    GPIOB->BSRR = GPIO_PIN_8;   // PB8 = 高 (标记 ISR 开始)
    // ... 处理中断 ...
    GPIOB->BSRR = GPIO_PIN_8 << 16;  // PB8 = 低 (标记 ISR 结束)
}

// 在 PulseView 中, CH0 下降沿到 CH1 上升沿的时间差 = 中断响应延迟
// 典型值: Cortex-M4 @168MHz → 12 周期 (71ns) 延迟
```

### 5.2 多通道同步分析

```
同时监控一个 SPI 事务的所有信号:

CH0 ── SCLK
CH1 ── MOSI
CH2 ── MISO
CH3 ── CS# (片选)
CH4 ── GPIO 标记 (用于标记事务开始 — 在 CS 前拉高)
CH5 ── IRQ 标记 (用于看中断何时触发)

这样一次采集就能看到整个 SPI 通信的全貌:
固件发出 CS# → 时钟开始 → 数据收发 → 传输完毕 → CS# 释放 → 中断触发
```

---

## 6. 常见问题

| # | 问题 | 解决方法 |
|---|------|---------|
| 1 | 廉价 USB 分析仪采样率不够 | I2C@400kHz 至少 2MS/s；SPI@10MHz 至少 50MS/s。高速通信需要更好的分析仪 |
| 2 | 采集到的信号全是乱码/毛刺 | 确保分析仪 GND 与目标板 GND 连接；检查接线是否松动 |
| 3 | PulseView 无法识别设备 | 用 Zadig 安装 WinUSB 驱动；Linux 下添加 udev 规则 |
| 4 | 触发条件太复杂 | PulseView 支持边沿触发、多通道组合触发、脉冲宽度触发 |
| 5 | 信号电压超出分析仪承受范围 | 廉价分析仪通常只支持 3.3V/5V；1.8V 或 1.2V 需要加电平转换 |
| 6 | 采样存储不够 | 降低采样率 (只要 ≥ 4× 信号频率即可)；或使用硬件流式传输的分析仪 |

---

## 7. 参考文档

1. PulseView / sigrok: https://sigrok.org/
2. Saleae Logic 2 Software: https://www.saleae.com/downloads/
3. DSLogic: https://www.dreamsourcelab.com/
4. "How to Use a Logic Analyzer" — SparkFun Tutorial
5. I2C Bus Specification (NXP UM10204)
