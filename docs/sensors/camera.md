# 摄像头 (OV2640 / OV5640 / DCMI)

> **文档说明**：本文档基于 Omnivision OV2640/OV5640 数据手册、STM32 DCMI 参考手册及嵌入式图像采集开发经验整理。

---

## 目录

1. [摄像头基础](#1-摄像头基础)
2. [STM32 DCMI 接口驱动](#2-stm32-dcmi-接口驱动)
3. [OV2640 驱动移植](#3-ov2640-驱动移植)
4. [OV5640 自动对焦](#4-ov5640-自动对焦)
5. [常见问题](#5-常见问题)

---

## 1. 摄像头基础

| 参数 | OV2640 | OV5640 |
|------|--------|--------|
| 分辨率 | 2MP (1600×1200) | 5MP (2592×1944) |
| 输出格式 | RGB565/422, YUV, JPEG | RGB565/422, YUV, JPEG |
| 帧率 | 15fps @ UXGA | 15fps @ 5MP, 30fps @ 1080p |
| 接口 | DVP (8-bit 并行) | DVP + MIPI CSI |
| 电压 | 2.8V (AVDD) + 1.3V (CVDD) | 2.8V + 1.5V + 1.2V |
| 功耗 | ~125mW (active) | ~250mW (active) |

```
DVP (Digital Video Port) 并行接口信号:

  ┌──────────┐                      ┌──────────┐
  │  OV2640  │                      │  STM32   │
  │  摄像头   │                      │  DCMI    │
  │          │─── D0~D7 ──────────→│  D0~D7   │ (数据线)
  │          │─── PCLK ───────────→│  PCLK    │ (像素时钟)
  │          │─── HSYNC ──────────→│  HSYNC   │ (行同步)
  │          │─── VSYNC ──────────→│  VSYNC   │ (帧同步)
  │          │─── XCLK ←──────────│  MCO/GPIO│ (主时钟 12-24MHz)
  │          │─── SCL/SDA ←───────→│  I2C     │ (SCCB 配置)
  │          │─── PWDN ←──────────│  GPIO    │ (掉电控制)
  │          │─── RESET ←─────────│  GPIO    │ (复位)
  └──────────┘                      └──────────┘
```

### SCCB 协议 (与 I2C 兼容)

```
SCCB (Serial Camera Control Bus) 与 I2C 100% 兼容:
  - 写: START + 从机地址(0x60) + 寄存器地址 + 数据 + STOP
  - 读: START + 从机地址(0x60) + 寄存器地址 + START + 从机地址(0x61) + 数据 + STOP
```

---

## 2. STM32 DCMI 接口驱动

```c
// STM32F4 DCMI + DMA 配置 (CubeMX 生成)
// DCMI: D0-D7 on PC6-9, PD3, PE4-6
// PCLK on PA6, HSYNC on PA4, VSYNC on PB7

#include "dcmi.h"

#define IMAGE_WIDTH   320
#define IMAGE_HEIGHT  240
#define IMAGE_BUF_SIZE  (IMAGE_WIDTH * IMAGE_HEIGHT * 2)  // RGB565

static uint16_t framebuf[IMAGE_WIDTH * IMAGE_HEIGHT];

void DCMI_Init(void) {
    // 1. DCMI 配置
    DCMI_HandleTypeDef hdcmi;
    hdcmi.Instance = DCMI;
    hdcmi.Init.SynchroMode  = DCMI_SYNCHRO_HARDWARE;  // 硬件同步
    hdcmi.Init.PCKPolarity  = DCMI_PCKPOLARITY_RISING;
    hdcmi.Init.VSPolarity   = DCMI_VSPOLARITY_LOW;     // VSYNC 低有效
    hdcmi.Init.HSPolarity   = DCMI_HSPOLARITY_LOW;     // HSYNC 低有效
    hdcmi.Init.CaptureRate  = DCMI_CR_ALL_FRAME;
    hdcmi.Init.ExtendedMode = DCMI_EXTEND_DATA_8B;      // 8-bit 数据
    HAL_DCMI_Init(&hdcmi);

    // 2. DMA 配置 (DCMI → framebuf, 循环模式)
    HAL_DCMI_Start_DMA(&hdcmi, DCMI_MODE_CONTINUOUS,
                       (uint32_t)framebuf, IMAGE_WIDTH * IMAGE_HEIGHT);

    // 3. 启动 DCMI 捕获
    HAL_DCMI_Start_DMA(&hdcmi, DCMI_MODE_CONTINUOUS,
                       (uint32_t)framebuf, IMAGE_WIDTH * IMAGE_HEIGHT);
}

// 帧完成中断
void DCMI_IRQHandler(void) {
    HAL_DCMI_IRQHandler(&hdcmi);
}

void HAL_DCMI_FrameEventCallback(DCMI_HandleTypeDef *hdcmi) {
    // 一帧图像完成 (framebuf 已填充)
    // 在此处理或切换缓冲区 (双缓冲避免撕裂)
    frame_ready = 1;
}
```

### 双缓冲策略

```c
// 避免帧撕裂: 使用双缓冲
static uint16_t framebuf0[IMAGE_WIDTH * IMAGE_HEIGHT];
static uint16_t framebuf1[IMAGE_WIDTH * IMAGE_HEIGHT];
static volatile uint8_t active_buf = 0;

void HAL_DCMI_FrameEventCallback(DCMI_HandleTypeDef *hdcmi) {
    if (active_buf == 0) {
        HAL_DCMI_Start_DMA(hdcmi, DCMI_MODE_CONTINUOUS,
                           (uint32_t)framebuf1, IMAGE_WIDTH * IMAGE_HEIGHT);
        ProcessFrame(framebuf0);  // 处理上一帧
    } else {
        HAL_DCMI_Start_DMA(hdcmi, DCMI_MODE_CONTINUOUS,
                           (uint32_t)framebuf0, IMAGE_WIDTH * IMAGE_HEIGHT);
        ProcessFrame(framebuf1);
    }
    active_buf ^= 1;
}
```

---

## 3. OV2640 驱动移植

```c
// OV2640 寄存器配置 (SCCB 写入)
// 有两种常用配置方式:

// 方式 1: 直接写入寄存器表 (适用于已知配置)
const uint16_t ov2640_rgb565_320x240[][2] = {
    {0xFF, 0x00},  // 选择 DSP 寄存器页
    {0x2C, 0xFF},  // 设置像素格式 (RGB565)
    {0x2E, 0xDF},
    {0xFF, 0x01},  // 选择 Sensor 寄存器页
    {0x12, 0x00},  // ...
    // ... 完整配置表 (通常 200+ 个寄存器)
};

void OV2640_WriteReg(uint8_t reg, uint8_t value) {
    uint8_t buf[2] = {reg, value};
    HAL_I2C_Master_Transmit(&hi2c1, 0x60 << 1, buf, 2, 100);
}

void OV2640_Init(void) {
    // 硬件复位
    HAL_GPIO_WritePin(RESET_GPIO_Port, RESET_Pin, GPIO_PIN_RESET);
    HAL_Delay(10);
    HAL_GPIO_WritePin(RESET_GPIO_Port, RESET_Pin, GPIO_PIN_SET);
    HAL_Delay(10);

    // 读取 PID 验证
    uint8_t pid_h, pid_l;
    // 写寄存器地址后重新 START 读取 (SCCB 读协议)
    OV2640_ReadReg(0x0A, &pid_h);
    OV2640_ReadReg(0x0B, &pid_l);
    if (pid_h != 0x26 || pid_l != 0x42) {
        Error_Handler();  // OV2640 PID = 0x2642
    }

    // 写入配置表
    for (int i = 0; i < sizeof(ov2640_rgb565_320x240) / 4; i++) {
        OV2640_WriteReg(ov2640_rgb565_320x240[i][0],
                        ov2640_rgb565_320x240[i][1]);
    }
}

// 方式 2: 使用配置结构体 (灵活, 适合动态配置)
typedef enum {
    OV2640_FMT_RGB565,
    OV2640_FMT_JPEG,
    OV2640_FMT_YUV422,
} OV2640_Format_t;

void OV2640_SetFormat(OV2640_Format_t fmt) {
    // 根据格式选择不同的寄存器配置
    switch (fmt) {
    case OV2640_FMT_JPEG:
        // JPEG 输出配置 (用于拍照)
        break;
    case OV2640_FMT_RGB565:
        // RGB565 配置 (用于实时显示)
        break;
    }
}
```

---

## 4. OV5640 自动对焦

OV5640 相比 OV2640 新增自动对焦 (AF) 功能。

```c
// OV5640 AF 控制 (通过 SCCB)
// OV5640 内部集成了 AF MCU (内嵌控制器), 通过特定寄存器触发

void OV5640_AutoFocus_Start(void) {
    // 1. 设置 AF 区域 (中心区域)
    OV5640_WriteReg(0x3022, 0x02);  // 固件模式: AF

    // 2. 启动单次自动对焦
    OV5640_WriteReg(0x3023, 0x01);  // 设置触发位
    OV5640_WriteReg(0x3022, 0x82);  // AF 启动
}

uint8_t OV5640_AutoFocus_IsDone(void) {
    uint8_t status;
    OV5640_ReadReg(0x3029, &status);
    return (status & 0x10);  // AF 完成标志
}

// 连续自动对焦 (Continuous AF)
void OV5640_ContinuousAF_Start(void) {
    OV5640_WriteReg(0x3022, 0x02);
    OV5640_WriteReg(0x3023, 0x03);  // 连续模式
    OV5640_WriteReg(0x3022, 0x82);  // 启动
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | DCMI 无数据 (全黑) | VSYNC/HSYNC 极性配置反了 | 用逻辑分析仪抓信号, 调整 `VSPolarity`/`HSPolarity` |
| 2 | 图像有条纹/撕裂 | PCLK 频率过高导致 DMA 来不及取数据 | 降低 PCLK (降低 XCLK 或配置 PLL 分频) |
| 3 | 图像花屏 (颜色错误) | 字节序错误或数据线接错 | 检查 D0-D7 物理连接; 确认 RGB/BGR 配置 |
| 4 | SCCB 通信失败 | 摄像头未供电或 SCCB 地址错误 | 量 2.8V/1.3V 供电; 扫描 I2C 地址 (写入 0x60) |
| 5 | OV2640 读数全 0xFF 或全 0x00 | RESET 时序错误或晶振停振 | 检查 XCLK (MCO 输出) 示波器确认 |
| 6 | FPS 低于预期 | DCMI 时钟慢 / DMA 带宽不足 | 用更高主频 MCU; 减小分辨率; 启用 JPEG 压缩 |
| 7 | JPEG 模式下图像不全 | JPEG 数据流中丢字节 | 增大 DMA FIFO; 用 DCMI 硬件 JPEG 模式 |

::: warning FPC 排线注意事项
摄像头 FPC 排线极易损坏。信号完整性问题 (串扰/反射) 90% 来自排线：
- 排线越短越好 (<10cm)
- 数据线间加地线隔离
- 避免锐角弯折
:::

---

## 6. 参考文档

1. OV2640 数据手册: Omnivision OV2640_DS_1.6
2. OV5640 数据手册: Omnivision OV5640_DS_2.1
3. STM32 DCMI 应用笔记: AN5020 (Digital Camera Interface on STM32)
4. "OV2640 应用指南" — 正点原子 / 野火嵌入式社区
5. Linux V4L2 摄像头框架文档: https://www.kernel.org/doc/html/latest/media/v4l-drivers/
