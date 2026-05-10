# 流式解析 vs 批量解析

> **文档说明**：本文档深入对比 MCU 通信协议中**流式解析**与**批量解析**两种方式的本质区别，帮助开发者根据数据到达方式选择合适的解析策略。

---

## 目录

1. [核心问题](#1-核心问题)
2. [流式解析（Stream Parsing）](#2-流式解析stream-parsing)
3. [批量解析（Batch Parsing）](#3-批量解析batch-parsing)
4. [典型场景对比](#4-典型场景对比)
5. [适用场景分析](#5-适用场景分析)
6. [选型总结](#6-选型总结)

---

## 1. 核心问题

假设你要接收这样一帧数据：

```
55 AA 01 08 02 01 01 A5 F4  (9 字节，LED 控制命令)
```

这 9 个字节是怎么到达你程序的？

- **情况 1**：一次性过来 → 用**批量解析**（Batch Parsing）
- **情况 2**：一字节一字节过来 → 用**流式解析**（Stream Parsing）

**数据怎么来，就决定了怎么解析。**

---

## 2. 流式解析（Stream Parsing）

### 2.1 特点

| 特性 | 说明 |
|------|------|
| 增量处理 | 一次处理一个字节 |
| 状态机驱动 | 维护解析状态（IDLE → HEAD1 → HEAD2 → ID → ...） |
| 内部缓冲 | 有独立的接收缓冲区 |
| 实时响应 | 数据到达即处理 |

### 2.2 核心实现

```c
// 逐字节输入，状态机驱动
protocol_err_e protocol_parse_byte(protocol_parser_t *parser, uint8_t byte)
{
    switch (parser->state)
    {
        case PARSE_STATE_IDLE:
            if (byte == 0x55)
            {
                parser->buffer[0] = byte;
                parser->index = 1;
                parser->state = PARSE_STATE_HEAD2;
            }
            // 其他字节直接丢弃，继续等 0x55
            break;

        case PARSE_STATE_HEAD2:
            if (byte == 0xAA)
            {
                parser->buffer[parser->index++] = byte;
                parser->state = PARSE_STATE_ID;
            }
            else
            {
                parser->state = PARSE_STATE_IDLE;  // 包头错误，重来
            }
            break;

        // ... 其他状态类似 ...

        case PARSE_STATE_CRC_HIGH:
            parser->buffer[parser->index++] = byte;
            // CRC 校验
            if (crc_ok)
            {
                parser->state = PARSE_STATE_IDLE;
                return PROTO_OK;  // 帧完成！
            }
            else
            {
                parser->state = PARSE_STATE_IDLE;
                return PROTO_ERR_CRC_MISMATCH;
            }
    }

    return PROTO_ERR_IN_PROGRESS;  // 还没收完，继续等
}

protocol_err_e protocol_parser_get_frame(const protocol_parser_t *parser,
                                         protocol_data_t *data)
{
    if (parser == NULL || data == NULL)
    {
        return PROTO_ERR_NULL_PTR;
    }

    const uint8_t *buf = parser->buffer;

    data->id     = buf[2];  /* ID 位置 */
    data->type   = buf[3];  /* Type 位置 */
    data->length = buf[4];  /* Length 位置 */

    /* 复制 payload 数据 */
    if (data->length > 0)
    {
        memcpy(data->payload, &buf[PROTOCOL_HEADER_SIZE], data->length);
    }

    return PROTO_OK;
}
```

### 2.3 使用方式（串口中断 + 环形缓冲区）

```c
void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE)
    {
        uint8_t byte = USART1->DR;

        if (!ring_is_full(&g_rx_ring))
        {
            ring_push(&g_rx_ring, byte);
        }
    }
}

void protocol_task(void)
{
    while (!ring_is_empty(&g_rx_ring))
    {
        uint8_t byte = ring_pop(&g_rx_ring);

        protocol_err_e ret = protocol_parse_byte(&g_parser, byte);
        if (ret == PROTO_OK)
        {
            // 一帧完成，提取并处理
            protocol_data_t data;
            protocol_parser_get_frame(&g_parser, &data);
            process_frame(&data);       // 业务处理
        }
        else if (ret != PROTO_ERR_IN_PROGRESS)
        {
            // 异常处理：解析出错（CRC 错误等），状态机已自动复位
        }
    }
}
```

---

## 3. 批量解析（Batch Parsing）

### 3.1 特点

| 特性 | 说明 |
|------|------|
| 一次性处理 | 前提是已有完整帧 |
| 无状态 | 不需要维护解析状态 |
| 外部缓冲 | 依赖调用者提供完整数据 |
| 简单直接 | 逻辑清晰，易于理解 |

### 3.2 核心实现

```c
// 一次性解包完整帧
protocol_err_e protocol_unpack(const uint8_t *buf, size_t len,
                               protocol_data_t *data)
{
    // 1. 检查包头
    if (buf[0] != PROTOCOL_HEAD_BYTE1 || buf[1] != PROTOCOL_HEAD_BYTE2)
    {
        return PROTO_ERR_INVALID_HEAD;
    }

    // 2. 验证长度
    uint8_t payload_len = buf[PROTOCOL_LENGTH_INDEX];

    // 3. CRC 校验
    uint16_t calc_crc = crc16_x25(buf, crc_offset);

    // 4. 提取数据
    data->id = buf[2];
    memcpy(data->payload, &buf[PROTOCOL_HEADER_SIZE], data->length);

    return PROTO_OK;
}
```

### 3.3 使用方式

```c
// 假设从文件/网络已读取到完整帧
uint8_t rx_buf[] = {0x55, 0xAA, 0x01, 0x08, 0x02, 0x01, 0x01, 0xA5, 0xF4};
protocol_data_t data;

protocol_err_e ret = protocol_unpack(rx_buf, sizeof(rx_buf), &data);
if (ret == PROTO_OK)
{
    printf("解析成功: ID=0x%02X\n", data.id);
}
```

---

## 4. 典型场景对比

### 4.1 处理粘包

**什么是粘包？** 多个帧的数据粘在一起到达。

```
收到的数据: 55 AA 01 08 02 01 01 A5 F4 55 AA 02 08 08 02 02 00 FE A3
            |<------- 帧 1 ------->|  |<------- 帧 2 ------->|
```

| 解析方式 | 处理方式 |
|---------|---------|
| **批量解析** | 只能解析第一帧，剩余数据需要自己处理偏移 |
| **流式解析** | 自动分离！逐字节喂入状态机，完成一帧后自动开始下一帧 |

```c
// 流式解析粘包处理
uint8_t sticky[] = {
    0x55, 0xAA, 0x01, 0x08, 0x02, 0x01, 0x01, 0xA5, 0xF4,  // 帧 1
    0x55, 0xAA, 0x01, 0x08, 0x02, 0x02, 0x00, 0x44, 0xCF   // 帧 2
};

protocol_parser_t parser;
protocol_parser_init(&parser);

int frame_count = 0;
for (size_t i = 0; i < sizeof(sticky); i++)
{
    if (protocol_parse_byte(&parser, sticky[i]) == PROTO_OK)
    {
        frame_count++;
        protocol_data_t data;
        protocol_parser_get_frame(&parser, &data);
        // 处理每一帧...
    }
}
// frame_count == 2，两帧都被正确解析
```

### 4.2 处理断包

**什么是断包？** 一帧数据分多次到达。

```
第 1 批: 55 AA 01
第 2 批: 08 02 01
第 3 批: 01 A5 F4
```

| 解析方式 | 处理方式 |
|---------|---------|
| **批量解析** | 前两批数据无法解析，需要自己拼接缓冲区 |
| **流式解析** | 天然支持！状态机"记住"已收到的部分，跨次接收无缝衔接 |

```c
// 流式解析断包处理
protocol_parser_t parser;
protocol_parser_init(&parser);

// 喂入第 1 批
for (int i = 0; i < 3; i++)
    protocol_parse_byte(&parser, part1[i]);
// parser.state == PARSE_STATE_TYPE (记住已收到的部分)

// 喂入第 2 批
for (int i = 0; i < 3; i++)
    protocol_parse_byte(&parser, part2[i]);
// parser.state == PARSE_STATE_CRC_LOW

// 喂入第 3 批 → 帧解析完成！
for (int i = 0; i < 3; i++)
{
    if (protocol_parse_byte(&parser, part3[i]) == PROTO_OK)
    {
        // 帧解析完成，提取数据
    }
}
```

### 4.3 噪声过滤

真实环境中，串口可能收到干扰噪声：

```
收到的数据: FF FF 55 AA 01 08 02 01 01 A5 F4
            |噪声| |<------- 有效帧 ------->|
```

| 解析方式 | 处理方式 |
|---------|---------|
| **批量解析** | 无法处理噪声数据，解析会失败 |
| **流式解析** | 自动过滤！状态机在 IDLE 状态只等待帧头，噪声字节被直接丢弃 |

```c
// 流式解析过滤噪声
uint8_t noisy[] = {
    0xFF, 0xFF,                                           // 噪声
    0x55, 0xAA, 0x01, 0x08, 0x02, 0x01, 0x01, 0xA5, 0xF4  // 有效帧
};

protocol_parser_t parser;
protocol_parser_init(&parser);

for (size_t i = 0; i < sizeof(noisy); i++)
{
    protocol_err_e ret = protocol_parse_byte(&parser, noisy[i]);
    if (ret == PROTO_OK)
    {
        // 噪声被自动过滤，有效帧解析成功
    }
}
```

---

## 5. 适用场景分析

### 5.1 流式解析适用场景

#### 串口通信（最典型）

串口中断每次只收到 1 个字节，数据是"滴滴答答"到达的。

- 中断触发，立即处理
- 不需要等待完整帧
- 自动处理粘包问题

```c
void USART1_IRQHandler(void)
{
    if (USART1->SR & USART_SR_RXNE)
    {
        uint8_t byte = USART1->DR;
        if (!ring_is_full(&g_rx_ring))
            ring_push(&g_rx_ring, byte);
    }
}
```

#### 低速网络通信（TCP 流式传输）

TCP 是流式协议，数据分批到达，不保证一次收到完整帧。

```c
void tcp_recv_callback(uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++)
    {
        protocol_err_e ret = protocol_parse_byte(&g_parser, data[i]);
        if (ret == PROTO_OK)
            process_frame();
    }
}
```

#### 嵌入式实时系统

```c
void protocol_task(void)
{
    while (1)
    {
        if (uart_has_data())
        {
            uint8_t byte = uart_get_byte();
            protocol_parse_byte(&parser, byte);
        }
        os_delay(1);
    }
}
```

### 5.2 批量解析适用场景

#### 高速网络通信（UDP/以太网）

UDP 保证报文完整性，每次接收的就是一个完整帧。

```c
void udp_recv_callback(uint8_t *buf, size_t len)
{
    protocol_data_t data;
    protocol_err_e ret = protocol_unpack(buf, len, &data);
    if (ret == PROTO_OK)
        handle_data(&data);
}
```

- 一次性处理，效率高
- 逻辑简单，易于调试
- UDP 保证了帧的完整性

#### 文件/存储读取

从文件中读取的协议数据天然是完整的。

```c
void read_config_from_file(void)
{
    FILE *fp = fopen("config.bin", "rb");
    if (fp == NULL) return;

    uint8_t frame_buf[PROTOCOL_MAX_LEN];
    size_t read_len = fread(frame_buf, 1, sizeof(frame_buf), fp);
    fclose(fp);

    protocol_data_t config;
    if (protocol_unpack(frame_buf, read_len, &config) == PROTO_OK)
        apply_config(&config);
}
```

#### 单次通信交互

```c
void recv_cmd(void)
{
    uint8_t rx_buf[256];
    size_t rx_len;
    protocol_data_t response;

    rx_len = recv(rx_buf, sizeof(rx_buf));
    protocol_unpack(rx_buf, rx_len, &response);
}
```

---

## 6. 选型总结

### 详细对比

| 维度 | 流式解析 | 批量解析 |
|------|---------|---------|
| **适用场景** | 串口通信、低速网络、实时环境 | 文件读取、高速网络、单次交互 |
| **数据要求** | 可处理不完整数据 | 必须是完整帧 |
| **状态保持** | 需要状态机 | 无状态 |
| **内存占用** | 固定缓冲区 | 无额外缓冲区 |
| **粘包处理** | 自动分离 | 需要上层处理 |
| **断包处理** | 跨次接收无缝衔接 | 无法处理 |
| **噪声过滤** | 自动过滤 | 无法处理 |
| **实时性** | 极佳 | 一般 |
| **CPU 开销** | 较高（每字节一次调用） | 较低（一次调用） |
| **复杂度** | 高（状态机逻辑） | 低（顺序处理） |
| **错误恢复** | 自动重新同步 | 需要手动处理 |

### 选型要点

> **数据一次到齐 → 批量解析**
> **数据滴滴答答 → 流式解析**

两种方式没有优劣之分，**匹配数据到达方式**才是关键。

::: tip 常见问题
**Q: 流式解析状态机遇到"帧头假象"时如何处理？**

Payload 数据中恰好包含 `0x55 0xAA`（与帧头相同），状态机会不会误判？

不会。收到帧头后，根据 Length 字段确定帧长度，不会在 Payload 中间重新寻找帧头；即使状态机被假帧头干扰，CRC 校验会失败，状态机自动复位重新同步。

如果协议对可靠性要求极高，可以考虑**转义编码**，将 Payload 中的特殊字节转义处理。详见 [转义协议](./escape-protocol)。
:::

::: tip 延伸阅读
- 关于 ITLV 协议的完整设计，请参阅 [ITLV 协议设计](./itlv-protocol)
- 关于转义编码方案，请参阅 [转义协议](./escape-protocol)
:::
