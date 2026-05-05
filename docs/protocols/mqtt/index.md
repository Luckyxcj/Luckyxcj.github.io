# MQTT 协议 (嵌入式 IoT)

> **文档说明**：本文档基于 MQTT v3.1.1 和 v5.0 规范、Eclipse Paho 及 ESP32/STM32 平台实践经验整理。

---

## 目录

1. [MQTT 概述与适用场景](#1-mqtt-概述与适用场景)
2. [MQTT 核心机制](#2-mqtt-核心机制)
3. [嵌入式 MQTT 客户端实现](#3-嵌入式-mqtt-客户端实现)
4. [MQTT Broker 部署](#4-mqtt-broker-部署)
5. [常见问题与排查](#5-常见问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. MQTT 概述与适用场景

MQTT (Message Queuing Telemetry Transport) 是一种轻量级的发布-订阅消息传输协议，专为资源受限的 IoT 设备和低带宽、不可靠网络设计。

```
MQTT 架构:

┌──────────┐        ┌──────────────┐        ┌──────────┐
│          │  Pub   │              │  Sub   │          │
│ 传感器    │───────→│   Broker     │───────→│ 监控终端  │
│          │        │ (服务器)      │        │          │
└──────────┘        │              │        └──────────┘
                    │  topic 路由   │
┌──────────┐        │              │        ┌──────────┐
│ 执行器    │←───────│              │←───────│ 手机 App  │
│          │  Sub   │              │  Pub   │          │
└──────────┘        └──────────────┘        └──────────┘
```

**适用场景**：
- 传感器数据上报 (低功耗、窄带网络)
- 设备远程控制与OTA
- 智能家居、工业物联网 (IIoT)
- 车联网 (V2X 通信)

---

## 2. MQTT 核心机制

### 2.1 Topic 与通配符

```
Topic 示例:
  home/bedroom/temperature    → 卧室温度
  home/bedroom/humidity       → 卧室湿度
  home/livingroom/temperature → 客厅温度

通配符:
  + (单层): home/+/temperature  → 匹配所有房间的温度
  # (多层): home/#              → 匹配 home 下的所有 topic
```

### 2.2 QoS (服务质量)

| QoS | 名称 | 说明 | 使用场景 |
|-----|------|------|---------|
| 0 | At most once | 最多一次，消息可能丢失 | 高频传感器数据 (丢一两条没关系) |
| 1 | At least once | 至少一次，消息可能重复 | 重要状态更新 |
| 2 | Exactly once | 恰好一次，无丢失无重复 | 关键命令 (如 OTA 固件分片) |

---

## 3. 嵌入式 MQTT 客户端实现

### 3.1 ESP32 (ESP-IDF) MQTT 示例

```c
// ESP32 MQTT 客户端 (基于 ESP-MQTT)
#include "mqtt_client.h"

static esp_mqtt_client_handle_t mqtt_client;

static void mqtt_event_handler(void *arg, esp_event_base_t base,
                                int32_t event_id, void *event_data) {
    esp_mqtt_event_handle_t evt = event_data;

    switch (event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI("MQTT", "Connected");
            esp_mqtt_client_subscribe(mqtt_client, "device/cmd", 1);
            break;

        case MQTT_EVENT_DATA:
            ESP_LOGI("MQTT", "Topic: %.*s, Data: %.*s",
                     evt->topic_len, evt->topic,
                     evt->data_len, evt->data);
            // 处理接收到的命令
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGI("MQTT", "Disconnected, reconnecting...");
            break;
    }
}

void MQTT_Init(void) {
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = "mqtt://192.168.1.100:1883",
        .credentials = {
            .client_id = "esp32_sensor_01",
            .username = "device",
            .authentication.password = "secret",
        },
    };
    mqtt_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID,
                                    mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}
```

### 3.2 STM32 + LwIP MQTT (Paho Embedded)

```c
// STM32 + Paho MQTT (精简版嵌入式客户端)
#include "MQTTClient.h"

#define MQTT_BUF_SIZE 512
static Network net;
static MQTTClient client;
static uint8_t send_buf[MQTT_BUF_SIZE], recv_buf[MQTT_BUF_SIZE];

void MQTT_Task(void *pvParameters) {
    NetworkInit(&net);
    NetworkConnect(&net, "192.168.1.100", 1883);

    MQTTClientInit(&client, &net, 1000, send_buf, MQTT_BUF_SIZE,
                   recv_buf, MQTT_BUF_SIZE);

    MQTTConnectData connData = {
        .clientID = "stm32_device_01",
        .keepAliveInterval = 60,
        .cleansession = 1,
    };
    MQTTConnect(&client, &connData);

    // 发布传感器数据
    MQTTMessage msg = {
        .qos = QOS1,
        .retained = 0,
        .payload = "{\"temp\":25.3}",
        .payloadlen = 14,
    };
    MQTTPublish(&client, "sensor/temperature", &msg);

    // 订阅命令 topic
    MQTTSubscribe(&client, "device/cmd", QOS1, messageArrived);

    while (1) {
        MQTTYield(&client, 1000);  // 维持 MQTT 连接 (处理 keep-alive)
        vTaskDelay(100);
    }
}
```

---

## 4. MQTT Broker 部署

| Broker | 特点 | 部署方式 |
|--------|------|---------|
| **Mosquitto** | 轻量, 最流行, C 语言 | `apt install mosquitto` 或 Docker |
| **EMQX** | 高并发, 企业级, Erlang | Docker: `docker run -p 1883:1883 emqx` |
| **HiveMQ** | 商业, 全功能 | 云端或自建 |
| **NanoMQ** | 超轻量 (适合边缘) | Docker / 直接编译 |

```bash
# Mosquitto 快速安装
sudo apt install mosquitto mosquitto-clients

# 测试: 终端1 订阅
mosquitto_sub -h localhost -t "test/topic" -v

# 测试: 终端2 发布
mosquitto_pub -h localhost -t "test/topic" -m "Hello MQTT"
```

---

## 5. 常见问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 客户端频繁断开重连 | Keep-Alive 间隔太短或网络不稳定 | 增大 keep-alive (≥ 60s)；检查 WiFi 信号强度 |
| 2 | 订阅后收不到消息 | Topic 不匹配或 QoS 层级问题 | 用 mosquitto_sub 单独验证 topic |
| 3 | SSL/TLS 连接失败 | 证书过期或不匹配 | 检查 Broker 证书；使用 1883 端口无 TLS 先验证功能 |
| 4 | 内存泄漏 | MQTT 消息未释放或缓冲区溢出 | 检查 MQTT_Yield 调用；确保 receive callback 处理足够快 |

---

## 6. 参考文档

1. MQTT v3.1.1 Specification: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/
2. Eclipse Paho Embedded C: https://github.com/eclipse/paho.mqtt.embedded-c
3. Mosquitto Broker: https://mosquitto.org/
4. EMQX: https://www.emqx.com/
