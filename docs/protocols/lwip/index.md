# LwIP 轻量级 TCP/IP 协议栈

> **文档说明**：本文档基于 LwIP 官方 Wiki、STM32Cube 集成 LwIP 经验及嵌入式网络应用开发整理。

---

## 目录

1. [LwIP 基础](#1-lwip-基础)
2. [STM32 平台集成](#2-stm32-平台集成)
3. [TCP / UDP 实战](#3-tcp--udp-实战)
4. [性能优化](#4-性能优化)
5. [常见问题](#5-常见问题)

---

## 1. LwIP 基础

LwIP (Lightweight IP) 是嵌入式系统最广泛使用的开源 TCP/IP 协议栈，专为资源受限系统设计。

| 特性 | Linux TCP/IP | LwIP |
|------|-------------|------|
| ROM 占用 | >500 KB (内核) | ~40 KB (最小) |
| RAM 占用 | >1 MB | ~20 KB + 缓冲区 |
| 零拷贝 | 不支持 | 支持 (pbuf 机制) |
| Socket API | 完整 BSD Socket | 兼容 BSD Socket (可选) |
| 多线程 | 支持 | 支持 (需 OS) |
| 无 OS 模式 | 不支持 | 支持 (Raw API) |

```
LwIP 架构:

┌────────────────────────────────┐
│  Application (Socket / Raw API)│
├────────────────────────────────┤
│  TCP          │    UDP         │
├──────────────┴────────────────┤
│  IP (IPv4 / IPv6)              │
│  ICMP  │  IGMP  │  DHCP  │ DNS │
├────────────────────────────────┤
│  Netif (网络接口抽象)           │
│  ┌──────────┐  ┌──────────┐   │
│  │ Ethernet │  │  PPP     │   │
│  └──────────┘  └──────────┘   │
├────────────────────────────────┤
│  硬件驱动 (ETH MAC / Wi-Fi)    │
└────────────────────────────────┘
```

---

## 2. STM32 平台集成

使用 STM32CubeMX 可以快速集成 LwIP（通常搭配 LAN8742 / DP83848 PHY）。

```
硬件连接 (RMII 接口):

  STM32F407                      LAN8742 PHY
  ┌──────────┐                  ┌──────────┐
  │ ETH_MDC   │─────────────────→│  MDC      │
  │ ETH_MDIO  │←────────────────→│  MDIO     │
  │ ETH_RMII_REF_CLK│←──────────│  CLK (50MHz)│
  │ ETH_TXD0/1│─────────────────→│  TXD0/1   │
  │ ETH_TX_EN │─────────────────→│  TX_EN    │
  │ ETH_RXD0/1│←─────────────────│  RXD0/1   │
  │ ETH_CRS_DV│←─────────────────│  CRS_DV   │
  │ ETH_RESET │─────────────────→│  nRST     │
  └──────────┘                  └─────┬─────┘
                                     │
                                  RJ45 网口
```

```c
// CubeMX 生成的 LwIP 初始化代码:

// 1. MX_LWIP_Init() 主要做的事:
//    - 初始化 ETH 外设
//    - 添加网络接口 (netif_add)
//    - 启动 DHCP (如果启用)

// ethernetif.c 中需要实现的底层函数:
// - low_level_init()   : 初始化 MAC/DMA 描述符
// - low_level_output() : 发送以太网帧
// - low_level_input()  : 接收以太网帧
// - ethernetif_input() : 将收到的 pbuf 送入 LwIP (在中断或线程中调用)

// 2. LwIP 需要周期性调用 MX_LWIP_Process()
//    在 FreeRTOS 任务中:
void LwIP_Task(void *pvParameters) {
    for (;;) {
        MX_LWIP_Process();  // 处理 LwIP 定时器 (TCP 重传、ARP 老化等)
        vTaskDelay(pdMS_TO_TICKS(10));  // 每 10ms 一次
    }
}

// 3. ETH 中断处理:
void ETH_IRQHandler(void) {
    HAL_ETH_IRQHandler(&heth);
    // HAL 框架会在接收完成回调中调用 ethernetif_input()
}
```

### 关键配置 (lwipopts.h)

```c
// 内存池配置 (影响 RAM 占用和吞吐量)
#define MEM_SIZE                 (16 * 1024)  // 堆内存 (动态分配用)
#define MEMP_NUM_PBUF            16           // 包缓冲池大小
#define MEMP_NUM_TCP_PCB         8            // 最大 TCP 连接数
#define MEMP_NUM_TCP_SEG         32           // TCP 段数量

// TCP 配置
#define TCP_MSS                  1460         // 最大分段大小
#define TCP_SND_BUF              (8 * TCP_MSS) // 发送缓冲 (8 个段)
#define TCP_WND                  (8 * TCP_MSS) // 接收窗口
#define TCP_SND_QUEUELEN         16           // 发送队列长度

// 内存优化: 如果 RAM 紧张
// - MEM_SIZE: 降到 8KB
// - MEMP_NUM_TCP_PCB: 降到 4
// - TCP_SND_BUF: 降到 4 * TCP_MSS
```

---

## 3. TCP / UDP 实战

### 3.1 TCP 服务端 (Socket API)

```c
#include "lwip/sockets.h"

#define SERVER_PORT 5000

void TCP_Server_Task(void *pvParameters) {
    int listen_fd, client_fd;
    struct sockaddr_in server_addr, client_addr;
    socklen_t client_len = sizeof(client_addr);

    // 1. 创建 socket
    listen_fd = lwip_socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) {
        vTaskDelete(NULL);
        return;
    }

    // 2. 绑定地址
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;  // 监听所有网口
    server_addr.sin_port = lwip_htons(SERVER_PORT);
    lwip_bind(listen_fd, (struct sockaddr *)&server_addr, sizeof(server_addr));

    // 3. 监听
    lwip_listen(listen_fd, 1);  // 最大 1 个排队连接

    while (1) {
        // 4. 接受连接 (阻塞)
        client_fd = lwip_accept(listen_fd,
                                (struct sockaddr *)&client_addr,
                                &client_len);
        if (client_fd >= 0) {
            // 5. 收发数据
            uint8_t rx_buf[256];
            int rx_len = lwip_recv(client_fd, rx_buf, sizeof(rx_buf), 0);
            if (rx_len > 0) {
                // 回显
                lwip_send(client_fd, rx_buf, rx_len, 0);
            }
            lwip_close(client_fd);
        }
    }
}
```

### 3.2 UDP 通信

```c
void UDP_Task(void *pvParameters) {
    int sock_fd;
    struct sockaddr_in addr, remote_addr;
    socklen_t remote_len = sizeof(remote_addr);

    sock_fd = lwip_socket(AF_INET, SOCK_DGRAM, 0);

    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = lwip_htons(6000);
    lwip_bind(sock_fd, (struct sockaddr *)&addr, sizeof(addr));

    while (1) {
        uint8_t rx_buf[512];
        int rx_len = lwip_recvfrom(sock_fd, rx_buf, sizeof(rx_buf), 0,
                                   (struct sockaddr *)&remote_addr,
                                   &remote_len);
        if (rx_len > 0) {
            // 处理 UDP 数据
            // 发送响应:
            lwip_sendto(sock_fd, rx_buf, rx_len, 0,
                        (struct sockaddr *)&remote_addr, remote_len);
        }
    }
}
```

---

## 4. 性能优化

```c
// 4.1 使用 Raw API (无 OS 或追求极致性能)
// Raw API 基于回调, 全程在 TCP/IP 线程中运行, 零上下文切换

static err_t http_recv(void *arg, struct tcp_pcb *pcb,
                       struct pbuf *p, err_t err) {
    if (p == NULL) {
        tcp_close(pcb);  // 对方关闭连接
    } else {
        tcp_recved(pcb, p->tot_len);
        pbuf_free(p);
    }
    return ERR_OK;
}

// 4.2 DMA 描述符优化
// 增大 ETH DMA 描述符数量 (stm32xxx_hal_eth.h):
#define ETH_RX_DESC_CNT   8  // 默认 4 → 8 (减少丢包)
#define ETH_TX_DESC_CNT   4  // 默认 2 → 4

// 4.3 TCP 窗口调优
// lwipopts.h:
#define TCP_WND   (16 * TCP_MSS)  // 增大窗口 → 更高吞吐
#define TCP_SND_BUF (16 * TCP_MSS)

// 4.4 关闭调试输出
#define LWIP_DEBUG  0
#define LWIP_NOASSERT  1
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | ping 不通 | 网口未初始化或 IP 未分配 | 检查 ETH Link 状态、DHCP 是否成功 |
| 2 | TCP 连接建立后很快断开 | 内存不足或 TCP 窗口太小 | 增大 `MEM_SIZE` 和 `TCP_WND` |
| 3 | 长时间运行后无法新建连接 | PCB 泄漏 | 检查 `lwip_close` 是否每次都被调用 |
| 4 | 传输速度慢 (<100KB/s) | 描述符少、窗口小、任务优先级低 | 按 4.2-4.3 优化；提高 LwIP 任务优先级 |
| 5 | DHCP 获取不到 IP | PHY 时钟或 MDIO 通信问题 | 检查 50MHz RMII 时钟和 PHY 地址配置 |
| 6 | 网络任务与实时任务冲突 | LwIP 内部锁竞争 | 提高 EMAC 中断优先级 (> 所有 FreeRTOS 任务) |
| 7 | 偶尔丢包 | 接收描述符不足 | 增大 `ETH_RX_DESC_CNT` 到 8+ |

---

## 6. 参考文档

1. LwIP 官方 Wiki: https://lwip.fandom.com/wiki/LwIP_Wiki
2. LwIP 源码贡献指南与文档: https://savannah.nongnu.org/projects/lwip/
3. STM32 以太网应用笔记: AN3966 (F4 series)
4. "嵌入式网络那些事 — LwIP 协议深度剖析与实战演练" — 朱升林
5. STM32Cube LwIP 例程: `Projects/STM32F407ZG-Nucleo/Applications/LwIP/`
