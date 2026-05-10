# 转义协议：帧头帧尾 + 转义 + 重传

> **文档说明**：本文档介绍一种基于转义编码的轻量级 MCU 通信协议，通过帧头帧尾识别边界、转义机制解决特殊字节冲突、校验 + 重传保证可靠性。

---

## 目录

1. [协议设计原则](#1-协议设计原则)
2. [数据帧结构](#2-数据帧结构)
3. [核心机制详解](#3-核心机制详解)
4. [示例代码](#4-示例代码)
5. [协议优势](#5-协议优势)
6. [总结](#6-总结)

---

## 1. 协议设计原则

针对 MCU 硬件外设资源有限的特征，需要设计一套**轻量级且容易解析**的通信协议，通过多种机制（校验、重传、转义）来实现数据的高效可靠传输。

核心需要解决三类问题：

| 问题类型 | 解决方案 | 说明 |
|---------|---------|------|
| 数据帧边界 | 固定帧结构（帧头、帧尾） | 解决粘包问题 |
| 数据完整性 | 数据校验 + 数据重传 | 解决丢包和错包问题 |
| 特殊字节冲突 | 数据转义机制 | 避免数据域中的帧头帧尾干扰解析 |

---

## 2. 数据帧结构

协议数据帧采用以下结构：**帧头 + 原始长度 + 转义数据 + 校验码 + 帧尾**，兼顾数据帧的边界识别与特殊字节兼容。

| 帧头 | 原始长度 | 转义数据域 | 校验码 | 帧尾 |
|------|---------|-----------|--------|------|
| 0xAA | 1 字节 | N 字节 | 1 字节 | 0x55 |

### 各字段说明

1. **帧头 + 帧尾**：固定的数据帧边界，用来快速定位数据帧的起止位置，解决粘包问题。
2. **原始长度**：记录未转义的业务数据字节数（0~255），用于验证数据还原后的完整性。
3. **转义数据域**：对含有特殊字节的原始数据进行转义后的业务数据，避免与帧头帧尾冲突。
4. **校验码**：原始数据的异或校验结果，确保数据完整性，用于识别错包/丢包。

---

## 3. 核心机制详解

### 3.1 转义机制

转义机制用于解决特殊字节冲突问题。定义转义字节 `0x7D`、转义异或值 `0x08`。

**发送端转义规则**：

| 原始字节 | 含义 | 转义后 |
|---------|------|--------|
| 0xAA | 帧头 | 0x7D 0xAB |
| 0x55 | 帧尾 | 0x7D 0x54 |
| 0x7D | 转义字节本身 | 0x7D 0x7C |

**接收端还原规则**：遇到 `0x7D` 时，读取下一个字节并异或 `0x08`，还原为原始字节。

### 3.2 粘包解决机制

接收端通过**逐字节扫描**的方式，匹配帧头后读取"原始数据长度"，按照长度校验转义还原后的数据。仅当帧头、长度、帧尾、校验码都匹配时，才判定为有效包，从而避免多包粘连。

### 3.3 丢包解决机制

当接收端校验码不匹配、数据还原失败时，向发送端回复**重传指令**。发送端维护数据重传次数（通常最多 3 次），收到指令后重新发送对应的数据包，从而平衡数据可靠性和硬件资源的占用。

---

## 4. 示例代码

以下参考代码实现了该通信协议的封装、发送、接收、解析，覆盖了粘包、丢包、特殊字节冲突问题。

```c
#include "stdint.h"
#include "string.h"

// 协议核心定义
#define FRAME_HEAD    0xAA    // 帧头
#define FRAME_TAIL    0x55    // 帧尾
#define ESCAPE_BYTE   0x7D    // 转义字节
#define ESCAPE_XOR    0x08    // 转义异或值
#define MAX_DATA_LEN  255     // 最大原始数据长度
#define MAX_FRAME_LEN 512     // 转义后最大帧长度
#define MAX_RETRY_CNT 3       // 最大重传次数

// 数据包结构体
typedef struct {
    uint8_t data_len;          // 原始数据长度
    uint8_t data[MAX_DATA_LEN];// 原始业务数据
    uint8_t check_sum;         // 原始数据校验码
} Packet_t;

// 接收全局变量
uint8_t recv_buf[MAX_FRAME_LEN] = {0}; // 接收缓冲区
uint8_t recv_state = 0;                // 0:未匹配帧头 1:已匹配帧头 2:解析完成
uint8_t recv_idx = 0;                  // 接收缓冲区索引
uint8_t is_escape = 0;                 // 转义标记

// 计算原始数据异或校验码
uint8_t calc_check_sum(uint8_t *data, uint8_t len) {
    uint8_t check_sum = 0;
    for (uint8_t i = 0; i < len; i++) check_sum ^= data[i];
    return check_sum;
}

// 发送端：数据转义
uint8_t escape_data(uint8_t *src, uint8_t src_len, uint8_t *dst, uint8_t *dst_len) {
    if (src_len == 0 || src_len > MAX_DATA_LEN) return 0;
    uint8_t idx = 0;
    for (uint8_t i = 0; i < src_len; i++) {
        if (idx >= MAX_FRAME_LEN - 4) return 0;
        if (src[i] == FRAME_HEAD || src[i] == FRAME_TAIL || src[i] == ESCAPE_BYTE) {
            dst[idx++] = ESCAPE_BYTE;
            dst[idx++] = src[i] ^ ESCAPE_XOR;
        } else {
            dst[idx++] = src[i];
        }
    }
    *dst_len = idx;
    return 1;
}

// 接收端：数据还原
uint8_t unescape_data(uint8_t *src, uint8_t src_len, uint8_t *dst, uint8_t *dst_len) {
    if (src_len == 0) return 0;
    uint8_t idx = 0, escape_flag = 0;
    for (uint8_t i = 0; i < src_len; i++) {
        if (escape_flag) {
            dst[idx++] = src[i] ^ ESCAPE_XOR;
            escape_flag = 0;
        } else if (src[i] == ESCAPE_BYTE) {
            escape_flag = 1;
        } else {
            dst[idx++] = src[i];
        }
    }
    if (escape_flag) return 0;
    *dst_len = idx;
    return 1;
}

// 模拟ACK收发（实际替换为硬件接口）
uint8_t recv_ack(void) { return 0; }
void send_ack(uint8_t ack) { uint8_t ack_byte = ack; }

// 发送端：封装并发送数据包（含转义+重传）
uint8_t send_packet(uint8_t *data, uint8_t len) {
    if (len > MAX_DATA_LEN) return 0;

    Packet_t pkt;
    pkt.data_len = len;
    memcpy(pkt.data, data, len);
    pkt.check_sum = calc_check_sum(data, len);

    // 数据转义
    uint8_t escaped_data[MAX_FRAME_LEN] = {0};
    uint8_t escaped_len = 0;
    if (!escape_data(pkt.data, pkt.data_len, escaped_data, &escaped_len)) return 0;

    // 组装帧
    uint8_t frame[MAX_FRAME_LEN] = {0}, frame_idx = 0;
    frame[frame_idx++] = FRAME_HEAD;
    frame[frame_idx++] = pkt.data_len;
    memcpy(&frame[frame_idx], escaped_data, escaped_len);
    frame_idx += escaped_len;
    frame[frame_idx++] = pkt.check_sum;
    frame[frame_idx++] = FRAME_TAIL;

    // 重传逻辑
    uint8_t retry_cnt = 0;
    while (retry_cnt < MAX_RETRY_CNT) {
        // HAL_UART_Transmit(&huart1, frame, frame_idx, 100); // 替换为实际发送接口
        if (recv_ack() == 0) return 1;
        retry_cnt++;
    }
    return 0;
}

// 接收端：逐字节解析（含还原+粘包处理）
void recv_byte_handler(uint8_t byte) {
    switch (recv_state) {
        case 0: // 匹配帧头
            if (byte == FRAME_HEAD) {
                recv_state = 1;
                recv_buf[recv_idx++] = byte;
                is_escape = 0;
            }
            break;
        case 1: // 接收数据并处理转义
            if (is_escape) {
                recv_buf[recv_idx++] = byte ^ ESCAPE_XOR;
                is_escape = 0;
            } else if (byte == ESCAPE_BYTE) {
                is_escape = 1;
            } else {
                recv_buf[recv_idx++] = byte;
            }

            // 校验帧尾并解析
            if (recv_idx >= 4) {
                uint8_t origin_len = recv_buf[1];
                if (recv_buf[recv_idx - 1] == FRAME_TAIL) {
                    // 还原数据并校验
                    uint8_t escaped_len = recv_idx - 4;
                    uint8_t origin_data[MAX_DATA_LEN] = {0}, real_len = 0;
                    if (unescape_data(&recv_buf[2], escaped_len, origin_data, &real_len)
                        && real_len == origin_len) {
                        uint8_t calc_check = calc_check_sum(origin_data, real_len);
                        if (calc_check == recv_buf[2 + escaped_len]) {
                            recv_state = 2;
                            send_ack(0); // 解析成功，发送确认
                        } else {
                            send_ack(1); // 校验失败，请求重传
                        }
                    } else {
                        send_ack(1); // 还原失败，请求重传
                    }
                } else {
                    send_ack(1); // 帧尾错误，请求重传
                }
                // 重置状态
                recv_state = 0;
                recv_idx = 0;
                is_escape = 0;
                memset(recv_buf, 0, sizeof(recv_buf));
            }
            break;
        default: // 异常重置
            recv_state = 0;
            recv_idx = 0;
            is_escape = 0;
            memset(recv_buf, 0, sizeof(recv_buf));
            break;
    }
}

// 提取解析成功的数据包
uint8_t get_packet(uint8_t *out_data, uint8_t *out_len) {
    if (recv_state == 2) {
        uint8_t origin_len = recv_buf[1];
        uint8_t escaped_len = recv_idx - 4;
        unescape_data(&recv_buf[2], escaped_len, out_data, out_len);
        recv_state = 0;
        return 1;
    }
    return 0;
}
```

---

## 5. 协议优势

| 优势 | 说明 |
|------|------|
| **轻量高效** | 转义和校验均为简单的位运算，协议解析无复杂计算逻辑，适配 8 位 / 32 位单片机 |
| **兼容性强** | 转义机制解决了数据域特殊字节的冲突，帧结构保留原始长度字段，确保解析无歧义 |
| **可靠性高** | 结合帧头帧尾的边界识别（解决粘包）、校验 + 重传（解决丢包），提高通信可靠性 |
| **可扩展** | 可在数据域增加数据包序号，适配多包连续传输场景 |

---

## 6. 总结

1. MCU 字节流通信协议帧的核心结构是 **"帧头 + 原始长度 + 校验码 + 帧尾"** 的基础结构，附加转义机制来解决特殊字节冲突。

2. 通过 **"帧头帧尾 + 校验码"** 解决粘包问题；通过 **"有限重传 + 校验码"** 解决丢包问题；通过 **"转义 + 还原"** 解决特殊字节冲突问题。

3. 协议设计需要适配 MCU 的硬件资源特性，优先选择轻量级算法（如异或校验），避免过度消耗单片机有限的算力和内存资源。
