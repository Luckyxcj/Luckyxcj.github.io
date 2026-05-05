# 激光雷达 (RPLidar / TFmini / LD19)

> **文档说明**：本文档基于 SLAMTEC RPLidar A1、Benewake TFmini、LD19 数据手册及机器人定位导航开发经验整理。

---

## 目录

1. [激光雷达对比](#1-激光雷达对比)
2. [RPLidar A1 驱动](#2-rplidar-a1-驱动)
3. [TFmini 单点测距](#3-tfmini-单点测距)
4. [LD19 低成本 360°](#4-ld19-低成本-360)
5. [常见问题](#5-常见问题)

---

## 1. 激光雷达对比

| 参数 | RPLidar A1 | TFmini Plus | LD19 |
|------|-----------|-------------|------|
| 类型 | 360° 旋转扫描 | 单点 (ToF) | 360° 旋转扫描 |
| 量程 | 0.15-12m | 0.1-12m | 0.02-12m |
| 精度 | ±1% 量程 | ±1cm (<6m) | ±3cm |
| 采样率 | 8000 Hz | 1000 Hz | 4500 Hz |
| 角分辨率 | ≤1° | N/A | ~1° |
| 接口 | UART (115200-256000) | UART/CAN | UART (230400) |
| 供电 | 5V | 5V | 5V |
| 价格 | ~¥600 | ~¥200 | ~¥200 |
| 适用 | 建图定位 | 定高/避障 | 避障/导航 |

---

## 2. RPLidar A1 驱动

RPLidar 使用串口通信，通过请求-应答模式获取扫描数据。

```
RPLidar 通信协议:

  请求: [0xA5] [0xXX]          (起始标志 + 命令)
  应答: [0xA5] [0x5A] [0x05] [0x00] [0x00] [0x40] [0x81]
         ────── 固定应答头 ──────  描述符 数据长度  (共 7 字节)

  扫描数据包 (5 字节):
   Byte 0: 质量 (0-255)
   Byte 1: 角度低字节 (S)
   Byte 2: 角度高字节 (S + 1)   → angle = ((S+1)>>1) | (S<<7) / 64.0 (度)
   Byte 3: 距离低字节
   Byte 4: 距离高字节            → distance = (d1 | d2<<8) / 4.0 (mm)
```

```c
// RPLidar A1 驱动
#include "rplidar.h"

#define RPLIDAR_BAUD  115200  // 默认波特率 (A1M8 为 256000)

// 请求命令
#define CMD_STOP        0x25
#define CMD_SCAN        0x20
#define CMD_GET_HEALTH  0x52
#define CMD_GET_INFO    0x50

// 发送命令
static void RPLidar_SendCmd(uint8_t cmd) {
    uint8_t buf[2] = {0xA5, cmd};
    HAL_UART_Transmit(&huart_lidar, buf, 2, 100);
}

// 读取应答描述符 (7 字节)
uint8_t RPLidar_GetDescriptor(uint8_t *desc) {
    // 先同步到 0xA5 0x5A
    uint8_t c;
    while (1) {
        HAL_UART_Receive(&huart_lidar, &c, 1, 100);
        if (c == 0xA5) {
            HAL_UART_Receive(&huart_lidar, &c, 1, 10);
            if (c == 0x5A) break;
        }
    }
    HAL_UART_Receive(&huart_lidar, desc, 5, 100);  // 后续 5 字节
    return 0;
}

// 启动扫描并解析数据
void RPLidar_ScanTask(void *pvParameters) {
    uint8_t buf[5];
    RPLidar_SendCmd(CMD_SCAN);  // 启动连续扫描

    for (;;) {
        // 读取一个扫描点 (5 字节)
        if (HAL_UART_Receive(&huart_lidar, buf, 5, 100) != HAL_OK) continue;

        uint8_t  quality  = buf[0];
        uint16_t angle_raw = ((buf[2] << 8) | buf[1]) >> 1;
        float    angle_deg = angle_raw / 64.0f;
        uint16_t dist_raw  = (buf[4] << 8) | buf[3];
        float    dist_mm   = dist_raw / 4.0f;

        // 过滤无效点 (质量=0 或距离=0)
        if (quality == 0 || dist_mm == 0) continue;

        // 存储或处理点云数据
        AddScanPoint(angle_deg, dist_mm, quality);
    }
}

// 停止扫描
void RPLidar_Stop(void) {
    RPLidar_SendCmd(CMD_STOP);
    HAL_Delay(10);  // 等待电机停转
}
```

### 电机 PWM 控制

```c
// RPLidar A1 电机需要 PWM 控制 (通过 MOTOCTL 引脚)
// 占空比 ≈ 50% 对应转速约 5-6 Hz (300-360 RPM)

void RPLidar_Motor_Start(void) {
    // TIM3 CH3 PWM: 25kHz (电机 PWM 频率)
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3, 50);  // 50% 占空比
}

void RPLidar_Motor_Stop(void) {
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_3, 0);
}
```

---

## 3. TFmini 单点测距

TFmini 是 Benewake 的单点红外 ToF 测距模组，协议简洁。

```
TFmini 数据帧格式 (9 字节):

  0x59  0x59  DistL DistH StrengthL StrengthH  Mode  0x00  CheckSum
  ────  ────  ────────────  ─────────────────  ────  ────  ────────
  帧头   帧头   距离(cm)       信号质量           保留   保留   前 8 字节和 (低 8 位)
```

```c
#define TFMINI_FRAME_LEN  9

uint8_t TFmini_Parse(uint8_t *buf, int16_t *dist, int16_t *strength) {
    if (buf[0] != 0x59 || buf[1] != 0x59) return 1;

    uint8_t checksum = 0;
    for (int i = 0; i < 8; i++) checksum += buf[i];
    if (checksum != buf[8]) return 2;

    *dist     = (buf[3] << 8) | buf[2];  // cm
    *strength = (buf[5] << 8) | buf[4];

    return 0;
}

// UART 接收采用 IDLE + DMA 方式，9 字节一帧
void TFmini_RxCallback(uint8_t *rx_buf, uint16_t len) {
    if (len >= TFMINI_FRAME_LEN) {
        int16_t dist, strength;
        if (TFmini_Parse(rx_buf, &dist, &strength) == 0) {
            // 使用 dist 和 strength
        }
    }
}
```

---

## 4. LD19 低成本 360°

LD19 是乐动机器人推出的低成本 360° 雷达 (类似 YDLIDAR)，适合学生竞赛和小型机器人。

```c
// LD19 数据包格式 (47 字节 / 12 个扫描点)
// 帧头: 0x54, 速度: 2 字节 (°/s), 起始角: 2 字节 (×0.01°),
// 后跟 12 个点: 距离(2B) + 置信度(1B) 每点,
// 结束角: 2 字节, CRC16: 2 字节

#define LD19_PKT_LEN  47

typedef struct __packed {
    uint8_t  header;         // 0x54
    uint16_t speed;          // °/s
    uint16_t start_angle;    // × 0.01°
    struct __packed {
        uint16_t distance;   // mm
        uint8_t  confidence; // 0-255
    } points[12];
    uint16_t end_angle;
    uint16_t crc16;
} LD19_Packet_t;
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | RPLidar 扫出全 0 数据 | 电机未转或转速不对 | 检查 PWM 输出 (50% 占空比) |
| 2 | RPLidar 数据频繁超时 | 波特率不匹配 | A1 默认 115200, A1M8 是 256000 |
| 3 | TFmini 阳光下测距跳变 | 日光红外干扰 | TFmini Plus 在阳光下表现较好; 加速光罩 |
| 4 | TFmini 读不到数据 | 帧头同步丢失 | 先读 2 字节找 0x59 0x59, 再读剩余 7 字节 |
| 5 | LD19 近距离 (<5cm) 数据不准 | 三角测距盲区 | 使用 ToF 雷达 (如 LD06); 或用超声波补盲 |
| 6 | 雷达数据中出现大量噪点 | 玻璃/镜面/黑色表面 | 过滤低置信度点 (quality < 阈值); 对镜面改用超声波 |
| 7 | 多雷达互相干扰 | 同频红外串扰 | 分时工作; 或用不同调制频率 (TFmini 可配置) |

---

## 6. 参考文档

1. RPLidar A1 开发套件手册: https://www.slamtec.com/en/Support#rplidar-a-series
2. TFmini 产品手册: https://en.benewake.com/TFminiPlus/index_proid_324.html
3. LD19 开发手册 (乐动机器人): https://www.ldrobot.com/
4. "Probabilistic Robotics" — Thrun, Burgard, Fox (SLAM 理论基础)
5. ROS LaserScan 消息格式: http://docs.ros.org/en/api/sensor_msgs/html/msg/LaserScan.html
