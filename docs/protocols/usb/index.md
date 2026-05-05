# USB 设备开发

> **文档说明**：本文档基于 USB 2.0 Specification、STM32Cube USB 库及 USB 设备开发实战经验整理。

---

## 目录

1. [USB 基础](#1-usb-基础)
2. [USB CDC (虚拟串口)](#2-usb-cdc-虚拟串口)
3. [USB HID (人机接口设备)](#3-usb-hid-人机接口设备)
4. [USB MSC (大容量存储)](#4-usb-msc-大容量存储)
5. [常见问题](#5-常见问题)

---

## 1. USB 基础

USB (Universal Serial Bus) 是嵌入式设备与 PC 通信最常用的方式之一。STM32 提供全速 (12 Mbps) USB 外设 (USB FS/HS)。

```
USB 拓扑:

  Host (PC) ──── Root Hub ──── Device 1 (STM32 CDC)
                          ├─── Device 2 (STM32 HID)
                          └─── Device 3 (Hub → 更多 Device)
```

### USB 描述符层次

```
设备描述符 (Device Descriptor)
  ├─ VID (Vendor ID) / PID (Product ID)
  ├─ 配置描述符 (Configuration Descriptor)
  │    ├─ 接口描述符 (Interface Descriptor)
  │    │    ├─ CDC: 两个接口 (通信 + 数据)
  │    │    ├─ HID: HID 描述符 + 端点描述符
  │    │    └─ MSC: 批量 IN + 批量 OUT 端点
  │    └─ ...
  └─ 字符串描述符 (厂商名、产品名、序列号)
```

### 传输类型

| 类型 | 特点 | 最大包大小 (FS) | 典型用途 |
|------|------|----------------|---------|
| **控制 (Control)** | 双向、可靠 | 8/16/32/64 | 枚举、命令 |
| **中断 (Interrupt)** | 定时轮询、可靠 | 1-64 | HID 键鼠输入 |
| **批量 (Bulk)** | 可靠、带宽弹性 | 8/16/32/64 | CDC 数据、MSC |
| **同步 (Isochronous)** | 固定带宽、不可靠 | 1-1023 | 音频、视频 |

---

## 2. USB CDC (虚拟串口)

USB CDC (Communications Device Class) 是最常用的 USB 设备类型之一，在 PC 上识别为虚拟 COM 口。

```c
// ===== STM32Cube CDC 配置 =====
// CubeMX: USB_OTG_FS → Mode: Device_Only
// Middleware: USB_DEVICE → Class: Communication Device Class (CDC)

// usbd_cdc_if.c 中的关键实现:

#include "usbd_cdc_if.h"

// 2.1 CDC 接收回调 (在 USB 中断上下文中)
static int8_t CDC_Receive_FS(uint8_t *Buf, uint32_t *Len) {
    // Buf: USB 接收缓冲区
    // Len: 接收到的数据长度

    // 将数据传递给应用层 (如放入 FreeRTOS 队列)
    USBD_CDC_SetRxBuffer(&hUsbDeviceFS, Buf);
    USBD_CDC_ReceivePacket(&hUsbDeviceFS);  // 准备下一次接收

    return USBD_OK;
}

// 2.2 CDC 发送函数
uint8_t CDC_Transmit_FS(uint8_t *Buf, uint16_t Len) {
    // CDC_Transmit_FS 内部状态机:
    //   USBD_BUSY → 稍后重试
    //   USBD_OK   → 发送成功
    uint8_t result = USBD_OK;
    USBD_CDC_TransmitPacket(&hUsbDeviceFS);
    return result;
}

// 实际应用封装:
void USB_Send(uint8_t *data, uint16_t len) {
    uint8_t retry = 0;
    while (CDC_Transmit_FS(data, len) == USBD_BUSY) {
        vTaskDelay(pdMS_TO_TICKS(1));
        if (++retry > 10) break;  // 超时放弃
    }
}

// 2.3 线路编码 (Line Coding)  — 用于配置波特率/数据位等
// 当 PC 端打开串口时, 会发送 SET_LINE_CODING 请求
// 回调函数:
static int8_t CDC_Control_FS(uint8_t cmd, uint8_t *pbuf, uint16_t length) {
    switch (cmd) {
    case CDC_SET_LINE_CODING: {
        USBD_CDC_LineCodingTypeDef *lc = (void *)pbuf;
        // lc->bitrate    = 115200
        // lc->datatype   = 8 (数据位)
        // lc->paritytype = 0 (无校验)
        // lc->format     = 0 (1 停止位)
        return USBD_OK;
    }
    }
}
```

### CDC 自定义 VID/PID

```c
// usbd_desc.c
#define USBD_VID      0x0483  // STMicroelectronics (可改为自己的 VID)
#define USBD_PID      0x5740  // 虚拟串口 PID

// 设备描述符字符串
#define USBD_PRODUCT_STRING_FS     "MyDevice Virtual COM"
#define USBD_MANUFACTURER_STRING   "MyCompany"
#define USBD_SERIALNUMBER_STRING   "00000001"
```

::: warning VID/PID 注意
量产产品应使用自己申请的 USB VID（或使用 MCU 厂商授权的 PID 子范围）。使用 ST 默认 VID 可能存在合规风险。
:::

---

## 3. USB HID (人机接口设备)

```c
// ===== 自定义 HID 报表描述符 =====
// HID 无需 PC 驱动，系统自带驱动，适合简单的双向数据通信

// 报表描述符 (定义数据格式):
// 输入报告: 1 byte (PC → 设备)
// 输出报告: 64 bytes (设备 → PC)

__ALIGN_BEGIN static uint8_t CUSTOM_HID_ReportDesc_FS[] __ALIGN_END = {
    // 输入报告 (PC ← 设备): 64 字节
    0x06, 0x00, 0xFF,  // Usage Page (Vendor Defined)
    0x09, 0x01,        // Usage (Vendor 1)
    0xA1, 0x01,        // Collection (Application)
    0x19, 0x01,        //   Usage Minimum (1)
    0x29, 0x40,        //   Usage Maximum (64)
    0x15, 0x00,        //   Logical Minimum (0)
    0x26, 0xFF, 0x00,  //   Logical Maximum (255)
    0x75, 0x08,        //   Report Size (8 bits)
    0x95, 0x40,        //   Report Count (64)
    0x81, 0x02,        //   Input (Data, Variable, Absolute)
    // 输出报告 (PC → 设备): 1 字节
    0x19, 0x01,        //   Usage Minimum (1)
    0x29, 0x01,        //   Usage Maximum (1)
    0x75, 0x08,        //   Report Size (8 bits)
    0x95, 0x01,        //   Report Count (1)
    0x91, 0x02,        //   Output (Data, Variable, Absolute)
    0xC0               // End Collection
};

// HID 数据收发:
uint8_t HID_Buffer[64];

// 发送 64 字节到 PC
USBD_CUSTOM_HID_SendReport(&hUsbDeviceFS, HID_Buffer, 64);

// 接收回调:
static int8_t CUSTOM_HID_OutEvent_FS(uint8_t *report, uint16_t len) {
    // report[0..len-1]: PC 发来的数据
    return USBD_OK;
}
```

---

## 4. USB MSC (大容量存储)

MSC (Mass Storage Class) 使 STM32 在 PC 上显示为一个 U 盘。

```c
// CubeMX: USB_DEVICE → Class: Mass Storage Class
// 需要实现存储介质接口 (usbd_storage_if.c):

// 存储介质操作函数:
int8_t STORAGE_Init_FS(uint8_t lun);           // 初始化
int8_t STORAGE_GetCapacity_FS(uint8_t lun,     // 读容量
                               uint32_t *block_num,
                               uint16_t *block_size);
int8_t STORAGE_Read_FS(uint8_t lun,            // 读块
                        uint8_t *buf, uint32_t blk_addr,
                        uint16_t blk_len);
int8_t STORAGE_Write_FS(uint8_t lun,           // 写块
                         uint8_t *buf, uint32_t blk_addr,
                         uint16_t blk_len);

// 典型实现: 映射到内部 Flash 或 SPI Flash (W25Q64)
int8_t STORAGE_Read_FS(uint8_t lun, uint8_t *buf,
                        uint32_t blk_addr, uint16_t blk_len) {
    W25Q_Read(buf, blk_addr * STORAGE_BLK_SIZ, blk_len * STORAGE_BLK_SIZ);
    return USBD_OK;
}
```

::: danger USB MSC 共用注意事项
- PC 端格式化时避免拔出 USB，可能导致文件系统损坏
- 设备端不要同时通过代码写存储介质 (MSC 模式时)
- 支持的 FAT 文件系统格式化: FAT12/FAT16/FAT32/exFAT
:::

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | PC 无法识别设备 | 描述符错误或上拉电阻未使能 | 用 USBlyzer 抓描述符；检查 DP 上拉 1.5kΩ 配置 |
| 2 | CDC 打开串口后蓝屏 | 驱动冲突或 ST VCP 驱动版本旧 | 更新 STSW-STM32102 VCP 驱动 |
| 3 | CDC 发送数据时卡死在 BUSY | PC 端未及时读取导致 NAK | 加超时重试；检查 PC 侧串口软件是否打开 |
| 4 | HID 传输速度慢 (每帧 1ms) | FS 帧为 1kHz, 每帧最大 64B | HID 理论速度 64KB/s; 改用 WinUSB 或 Bulk |
| 5 | MSC 格式化失败 | 存储介质写保护或擦除失败 | 检查 Flash 写保护状态 |
| 6 | USB 线缆长距离不稳定 | 信号衰减 | 用屏蔽线；加共模扼流圈；加 TVS 管保护 |
| 7 | 枚举成功但通信中断 | OTG 时钟精度不足 | HSE (外部晶振) 必须准确, 48MHz USB 时钟 < ±0.25% 误差 |
| 8 | Win7 无自带驱动 | Windusb.sys 不匹配 | MSC/HID 免驱; CDC 需要 inf 文件或改用 WinUSB |

---

## 6. 参考文档

1. USB 2.0 Specification: https://www.usb.org/document-library/usb-20-specification
2. STM32 USB 培训 PPT: AN4879 (Introduction to USB with STM32)
3. USB Device Class Definition for CDC: https://www.usb.org/document-library/
4. HID Usage Tables: https://www.usb.org/document-library/hid-usage-tables-14
5. USBlyzer (USB 协议分析工具): http://www.usblyzer.com/
6. STM32Cube USB 库例程: `Projects/STM32F407ZG-Nucleo/Applications/USB_Device/`
