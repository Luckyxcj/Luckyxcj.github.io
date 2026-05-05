# BLE 低功耗蓝牙

> **文档说明**：本文档基于 Bluetooth 5.x Core Spec、Nordic Semiconductor nRF52 SDK 及嵌入式 BLE 应用开发经验整理。

---

## 目录

1. [BLE 基础](#1-ble-基础)
2. [GATT 协议详解](#2-gatt-协议详解)
3. [nRF52 平台实战](#3-nrf52-平台实战)
4. [STM32 + BLE 模块方案](#4-stm32--ble-模块方案)
5. [常见问题](#5-常见问题)

---

## 1. BLE 基础

BLE (Bluetooth Low Energy) 是 Bluetooth 4.0 引入的低功耗无线通信协议，面向低速率、低功耗物联网设备。

| 特性 | Classic Bluetooth | BLE |
|------|-------------------|-----|
| 速率 | 1-3 Mbps | 125 Kbps ~ 2 Mbps (BLE 5.0) |
| 功耗 | ~1W (持续) | ~0.01-0.5W |
| 连接延迟 | ~100 ms | ~3 ms |
| 节点数 | 7 (微微网) | 无限 (理论上) |
| 广播数据 | 无 | 31 bytes (可扩展) |
| 适用场景 | 音频、文件传输 | 传感器、穿戴设备、信标 |

```
BLE 协议栈:

┌──────────────────────────┐
│  GATT / GAP              │  ← 应用层
├──────────────────────────┤
│  ATT / SMP (安全管理)     │  ← 属性协议
├──────────────────────────┤
│  L2CAP                   │  ← 逻辑链路控制与适配
├──────────────────────────┤
│  Link Layer              │  ← 状态机 (广播/扫描/连接)
├──────────────────────────┤
│  PHY (2.4 GHz GFSK)      │  ← 物理层
└──────────────────────────┘
```

### 设备角色

| 角色 | 行为 |
|------|------|
| **Central (主机)** | 扫描→发起连接 (通常是手机/平板) |
| **Peripheral (从机)** | 广播→接受连接 (通常是传感器) |
| **Broadcaster** | 只广播，不连接 (如 iBeacon) |
| **Observer** | 只扫描，不连接 |

---

## 2. GATT 协议详解

GATT (Generic Attribute Profile) 定义了两个 BLE 设备之间如何传输数据。

```
GATT 数据层次:

  Profile (配置文件，如 Battery Service)
    └─ Service (服务，UUID: 0x180F)
         └─ Characteristic (特征值)
              ├─ Properties: Read | Notify | Write | Indicate
              ├─ Value: 实际数据 (电池电量: 85%)
              └─ Descriptor: CCCD (启用 Notify 的开关)
```

### GATT 操作

| 操作 | 方向 | 说明 |
|------|------|------|
| Read | Client → Server | 客户端主动读取 |
| Write | Client → Server | 客户端写入 |
| Notify | Server → Client | 服务器推送 (无需确认) |
| Indicate | Server → Client | 服务器推送 (需确认) |

---

## 3. nRF52 平台实战

nRF52832/nRF52840 是 Nordic 的 Cortex-M4/M4F BLE SoC，集成了 BLE 协议栈 (SoftDevice)。

```c
// ===== nRF5 SDK BLE UART 服务示例 =====
#include "ble_nus.h"
#include "nrf_ble_gatt.h"

// BLE 参数
#define APP_BLE_CONN_CFG_TAG    1
#define APP_BLE_OBSERVER_PRIO   3
#define NUS_SERVICE_UUID_TYPE   BLE_UUID_TYPE_VENDOR_BEGIN

ble_nus_t m_nus;  // Nordic UART Service 实例

// GAP 参数 (广播)
#define DEVICE_NAME             "MySensor"
#define APP_ADV_INTERVAL        300     // ms (低功耗)
#define APP_ADV_DURATION        18000   // 18 秒后停止广播 (0 = 一直广播)

void BLE_Init(void) {
    uint32_t err_code;

    // 1. 初始化 BLE 协议栈 (SoftDevice)
    nrf_sdh_enable_request();
    // 配置 SoftDevice 时钟、RAM 起始地址等...

    // 2. 初始化 GATT
    nrf_ble_gatt_init(&m_gatt, NULL);

    // 3. 注册 GATT Service (NUS)
    ble_nus_init_t nus_init = {0};
    nus_init.data_handler = nus_data_handler;  // 收到数据的回调
    err_code = ble_nus_init(&m_nus, &nus_init);
    APP_ERROR_CHECK(err_code);

    // 4. 配置广播
    ble_advertising_init_t adv_init = {0};
    adv_init.advdata.name_type = BLE_ADVDATA_FULL_NAME;
    adv_init.advdata.flags = BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE;
    adv_init.config.ble_adv_fast_interval = APP_ADV_INTERVAL;
    adv_init.config.ble_adv_fast_timeout  = APP_ADV_DURATION;
    ble_advertising_init(&m_advertising, &adv_init);
}

// 收到手机端写入数据
static void nus_data_handler(ble_nus_evt_t *p_evt) {
    if (p_evt->type == BLE_NUS_EVT_RX_DATA) {
        // p_evt->params.rx_data.p_data[0..length-1]
        // 处理手机发来的数据
    }
}

// 发送数据到手机
void BLE_Send(uint8_t *data, uint16_t len) {
    uint32_t err_code;
    uint16_t actual_len = len;

    err_code = ble_nus_data_send(&m_nus, data, &actual_len,
                                  m_conn_handle);
    if (err_code != NRF_SUCCESS) {
        // 可能原因: 未连接 / 缓冲区满
    }
}

// BLE 事件处理 (连接/断连)
static void ble_evt_handler(ble_evt_t const *p_ble_evt, void *p_context) {
    switch (p_ble_evt->header.evt_id) {
    case BLE_GAP_EVT_CONNECTED:
        m_conn_handle = p_ble_evt->evt.gap_evt.conn_handle;
        break;
    case BLE_GAP_EVT_DISCONNECTED:
        m_conn_handle = BLE_CONN_HANDLE_INVALID;
        ble_advertising_start(&m_advertising, BLE_ADV_MODE_FAST);  // 重新广播
        break;
    }
}
```

### 低功耗优化

```c
// nRF52 低功耗关键配置:
// 1. 广播间隔: 增大以减少广播功耗
//    APP_ADV_INTERVAL = 1000 (1Hz) → 数百 μA
//    APP_ADV_INTERVAL = 100  (10Hz) → 约 1mA

// 2. 连接间隔: 增大以减少连接功耗
//    连接参数更新请求:
ble_gap_conn_params_t conn_params = {
    .min_conn_interval = MSEC_TO_UNITS(500, UNIT_1_25_MS),  // 500ms
    .max_conn_interval = MSEC_TO_UNITS(1000, UNIT_1_25_MS), // 1000ms
    .slave_latency     = 4,   // 跳过 4 个连接事件
    .conn_sup_timeout  = MSEC_TO_UNITS(4000, UNIT_10_MS),
};

// 3. TX Power: 降低发射功率
//    sd_ble_gap_tx_power_set(BLE_GAP_TX_POWER_ROLE_ADV, m_advertising_handle, -8);
//    0 dBm → -8 dBm: 距离减半, 功耗降低 ~60%
```

---

## 4. STM32 + BLE 模块方案

STM32 本身不带 BLE 射频，通常通过 UART AT 指令或 HCI 连接外部 BLE 模块。

```
STM32 (UART) ←→ BLE 模块 (JDY-23 / HC-42 / E104-BT5011A)

  ┌──────────┐   UART TX ────→   ┌──────────────┐
  │  STM32    │   UART RX ←────   │  BLE 模块      │
  │  (主机)   │                   │  (透传/AT指令)  │
  └──────────┘                    └──────────────┘
```

```c
// JDY-23 BLE 模块 AT 指令配置 (通过 UART)
// 1. 进入 AT 模式: 模块上电默认是透传模式
// 2. 发送 AT 指令

// 查询模块信息
"AT+VERSION\r\n"    → "+VERSION=JDY-23-V2.2"

// 设置广播名称
"AT+NAMEMyDevice\r\n"

// 设置波特率
"AT+BAUD115200\r\n"

// 设置广播间隔 (ms)
"AT+ADVIN1000\r\n"

// 恢复出厂设置
"AT+DEFAULT\r\n"

// 进入低功耗模式 (自动休眠)
"AT+SLEEP2\r\n"

// 透传模式下 STM32 侧代码:
void BLE_Passthrough_Send(uint8_t *data, uint16_t len) {
    HAL_UART_Transmit(&huart2, data, len, 100);
}

void BLE_Passthrough_Receive(void) {
    // UART IDLE 中断接收
    // 收到即转发给上层逻辑
}
```

| 模块 | 芯片 | 特点 | 功耗 |
|------|------|------|------|
| JDY-23 | 国产 | 超低成本 (~¥2) | ~2mA 连接 |
| HC-42 | TI CC2541 | 经典模块 | ~9mA |
| E104-BT5011A | nRF52811 | BLE 5.1, 长距离 (Coded PHY) | ~3mA |

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 手机搜不到设备 | 广播未开启或广播间隔太大 | 检查广播初始化; 使用 nRF Connect APP 扫描 |
| 2 | 连接后立即断开 | 连接参数协商失败 | 放宽连接间隔范围 |
| 3 | 数据传输很慢 (1-2 KB/s) | 连接间隔太大 | 减小连接间隔到 15-30ms |
| 4 | 透传模块丢数据 | UART 波特率不匹配或缓冲区溢出 | 降低 BLE 发包频率; 加硬件流控 |
| 5 | 多个手机同时连接失败 | 模块/协议栈不支持多连接 | 确认模块支持多连接 (nRF52 支持 20 连接) |
| 6 | nRF52 功耗降不下来 | 外设未关 / log 打印未关 / Debug 模式 | 关闭 UART log; 进入 System ON Sleep |
| 7 | Bond 后无法重新连接 | 绑定信息损坏 | 清除手机端配对记录 + 设备端 Flash 绑定区 |

---

## 6. 参考文档

1. Bluetooth Core Specification 5.x: https://www.bluetooth.com/specifications/
2. Nordic nRF5 SDK 文档: https://infocenter.nordicsemi.com/
3. nRF Connect for Mobile (调试利器): Google Play / App Store
4. "BLE 入门与实践" — 低功耗蓝牙协议栈详解
5. JDY-23 数据手册 (AT 指令集)
