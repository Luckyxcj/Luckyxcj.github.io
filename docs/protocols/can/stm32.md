# STM32 CAN 使用指南

## 1. STM32 CAN 外设概况

### 1.1 各系列 CAN 外设对比

| 系列 | CAN 外设 | 特点 |
|------|---------|------|
| STM32F1 | bxCAN | 单 CAN 2.0B，14 个过滤器组 |
| STM32F4 | bxCAN (双 CAN) | 两个 CAN 控制器共享 28 个过滤器组 |
| STM32F7 | bxCAN | 同 F4，28 个过滤器组 |
| STM32G0/G4/H7 | FDCAN | CAN FD 支持，64 字节数据，可变速率 |
| STM32F0 | bxCAN | 14 个过滤器组，仅一个 CAN |

本文以 **STM32F4 的 bxCAN** 为主展开，FDCAN 有单独章节说明。

### 1.2 bxCAN 内部架构

```
           ┌──────────────┐
  CAN_RX ──┤ 接收引擎     │
           │              │
           │  3 个邮箱    │──> 接收 FIFO 0 (3 帧深)
           │  3 个邮箱    │──> 接收 FIFO 1 (3 帧深)
           │              │
           │  3 个邮箱    │<── 发送队列 (按优先级或 FIFO)
           │              │
           │  28 组过滤器 │
           └──────────────┘
  CAN_TX <──  发送引擎
```

关键硬件资源：
- **3 个发送邮箱** — 硬件自动仲裁，可配置优先级或 FIFO
- **2 个接收 FIFO** — 各 3 帧深度，带硬件过载保护
- **28/14 组过滤器** — 可配为 2 个 14 位 (屏蔽位模式) 或 4 个 7 位 (列表模式)

---

## 2. 硬件连接

### 2.1 最小连接

```
             STM32F407xx
          ┌──────────────┐
          │  PD1  CAN1_TX │────> TXD ────┐
          │  PD0  CAN1_RX │<──── RXD ────┤
          └──────────────┘               │
                                    TJA1050 等
                                    ┌──────┐
                                    │ VCC  │─── 5V/3.3V
                                    │ GND  │─── GND
                                    │ TXD  │<── MCU CAN_TX
                                    │ RXD  │──> MCU CAN_RX
                                    │ CANH │──> 总线 CAN_H
                                    │ CANL │──> 总线 CAN_L
                                    │ RS   │─── GND (高速模式)
                                    └──────┘
```

### 2.2 GPIO 引脚选择（注意重映射）

STM32F4 CAN1 默认引脚：

| CAN | 默认 TX | 默认 RX | 重映射 TX | 重映射 RX |
|-----|---------|---------|----------|----------|
| CAN1 | PD1 | PD0 | PB9 | PB8 |
| CAN2 | PB6 | PB5 | PB13 | PB12 |

```c
// CAN1 默认引脚 (PD1/PD0)
RCC_AHB1PeriphClockCmd(RCC_AHB1Periph_GPIOD, ENABLE);
GPIO_PinAFConfig(GPIOD, GPIO_PinSource0, GPIO_AF_CAN1);  // RX
GPIO_PinAFConfig(GPIOD, GPIO_PinSource1, GPIO_AF_CAN1);  // TX

// 初始化 GPIO
GPIO_InitStructure.GPIO_Pin   = GPIO_Pin_0 | GPIO_Pin_1;
GPIO_InitStructure.GPIO_Mode  = GPIO_Mode_AF;
GPIO_InitStructure.GPIO_OType = GPIO_OType_PP;
GPIO_InitStructure.GPIO_PuPd  = GPIO_PuPd_UP;  // 内部上拉
GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
GPIO_Init(GPIOD, &GPIO_InitStructure);
```

::: danger 警告
CAN 是差分信号，**绝对不能将 MCU 的 TX/RX 引脚直接接到 CAN_H/CAN_L 上**，否则：
1. 电平不匹配：STM32 3.3V TTL vs 总线 +-2V 差分
2. 总线仲裁失效：TTL 推挽输出不具备线与特性
3. 短路风险：差分线与单端直接连接可能损坏 IO

**务必使用外部 CAN 收发器！**
:::

---

## 3. 时钟与位定时配置

### 3.1 CAN 时钟源

STM32F4 的 CAN 时钟来自 **APB1 总线** (PCLK1)，典型值为 42MHz 或 45MHz。

```c
// 获取 APB1 时钟频率
// PCLK1 = HCLK / APB1_Prescaler
// CAN 时钟 = PCLK1 (注意不是 PCLK1 x 2)
```

::: warning 注意
APB1 定时器 (TIM) 在 APB1 prescaler != 1 时时钟为 2 x PCLK1，但 **CAN 不受此规则影响**。CAN 的时钟始终 = PCLK1。
验证方法：读取 RCC_ClocksTypeDef 中的 PCLK1 频率。
:::

### 3.2 位定时参数计算

以 500Kbps 为例，时钟 42MHz：

常用配置速查表 (42MHz PCLK1)：

**1Mbps**
```c
CAN_InitStructure.CAN_Prescaler = 6;      // BRP = 5, 分频系数 6
CAN_InitStructure.CAN_BS1 = CAN_BS1_4tq;  // BS1 = 4 Tq
CAN_InitStructure.CAN_BS2 = CAN_BS2_2tq;  // BS2 = 2 Tq
// 总 Tq = 1+4+2 = 7 Tq
// Tq 频率 = 42MHz / 6 = 7MHz
// 波特率 = 7MHz / 7 = 1Mbps
// 采样点 = (1+4)/7 = 71.4%
```

**500Kbps**
```c
CAN_InitStructure.CAN_Prescaler = 7;      // BRP = 6, 分频系数 7
CAN_InitStructure.CAN_BS1 = CAN_BS1_8tq;  // BS1 = 8 Tq
CAN_InitStructure.CAN_BS2 = CAN_BS2_3tq;  // BS2 = 3 Tq
// 总 Tq = 1+8+3 = 12 Tq
// Tq 频率 = 42MHz / 7 = 6MHz
// 波特率 = 6MHz / 12 = 500Kbps
// 采样点 = (1+8)/12 = 75%
```

**250Kbps**
```c
CAN_InitStructure.CAN_Prescaler = 12;     // BRP = 11, 分频系数 12
CAN_InitStructure.CAN_BS1 = CAN_BS1_9tq;
CAN_InitStructure.CAN_BS2 = CAN_BS2_4tq;
// 总 Tq = 1+9+4 = 14 Tq
// 波特率 = 42MHz / 12 / 14 = 250Kbps
// 采样点 = (1+9)/14 = 71.4%
```

**125Kbps**
```c
CAN_InitStructure.CAN_Prescaler = 14;     // BRP = 13, 分频系数 14
CAN_InitStructure.CAN_BS1 = CAN_BS1_12tq;
CAN_InitStructure.CAN_BS2 = CAN_BS2_5tq;
// 总 Tq = 1+12+5 = 18 Tq
// 波特率 = 42MHz / 14 / 18 = 125Kbps
// 采样点 = (1+12)/18 = 72.2%
```

::: tip 波特率精度要求
CAN 总线所有节点波特率误差总和应 **< 5%**。单个节点误差建议 **< 1%**。用 STM32CubeMX 时钟树工具可直接计算，推荐使用。
:::

### 3.3 采样点推荐值

| 速率 | 推荐采样点 |
|------|----------|
| 1 Mbps | 75% ~ 80% |
| 500 Kbps | 87.5% (CANopen 推荐) |
| 250 Kbps | 87.5% |
| 125 Kbps | 87.5% |

---

## 4. bxCAN 初始化完整流程

```c
CAN_InitTypeDef        CAN_InitStructure;
CAN_FilterInitTypeDef  CAN_FilterInitStructure;

// ===== 第 1 步：使能时钟 =====
RCC_APB1PeriphClockCmd(RCC_APB1Periph_CAN1, ENABLE);

// ===== 第 2 步：复位 CAN 外设 (重要!) =====
CAN_DeInit(CAN1);

// ===== 第 3 步：设置模式 =====
CAN_InitStructure.CAN_TTCM = DISABLE;  // 禁止时间触发模式
CAN_InitStructure.CAN_ABOM = ENABLE;   // 自动 Bus-Off 恢复
CAN_InitStructure.CAN_AWUM = ENABLE;   // 自动唤醒
CAN_InitStructure.CAN_NART = DISABLE;  // 自动重发 (出错会自动重发)
CAN_InitStructure.CAN_RFLM = DISABLE;  // FIFO 溢出时覆盖旧数据
CAN_InitStructure.CAN_TXFP = DISABLE;  // 发送邮箱按 ID 优先级

// ===== 第 4 步：位定时 =====
CAN_InitStructure.CAN_Mode = CAN_Mode_Normal;
CAN_InitStructure.CAN_SJW = CAN_SJW_1tq;
CAN_InitStructure.CAN_BS1  = CAN_BS1_8tq;
CAN_InitStructure.CAN_BS2  = CAN_BS2_3tq;
CAN_InitStructure.CAN_Prescaler = 7;

// ===== 第 5 步：初始化 =====
if (CAN_Init(CAN1, &CAN_InitStructure) == CANINITFAILED) {
    // 初始化失败 — 常见原因见故障排查章节
    while (1);
}
```

::: danger CAN_Init 失败的死循环问题
`CAN_Init()` 函数内部等待硬件 ACK，若 CAN 总线无其他节点则**永远无法完成初始化**。这在只有一个节点的调试阶段特别常见。

**解决方案**：
- 调试时先初始化为 **LoopBack 模式** 或 **Silent 模式**
- 或手动操作寄存器跳过硬件 ACK 等待
- 或至少总线上挂 2 个节点 (另一个节点负责 ACK)
:::

---

## 5. 过滤器配置

### 5.1 过滤器组与模式

bxCAN 的过滤器控制哪些帧进入接收 FIFO。

**两种模式**：

| 模式 | 原理 | 使用场景 |
|------|------|---------|
| **屏蔽位模式** (Mask) | 2 个 32 位寄存器：ID + Mask | 接收一个 ID 范围 |
| **列表模式** (List) | 2 个 32 位寄存器：ID0 + ID1 | 接收 2 个/4 个精确 ID |

**两种位宽**：

| 位宽 | 每过滤器可配置 |
|------|-------------|
| 32 位 | 2 个 ID (标准+扩展混用) |
| 16 位 | 4 个 ID (仅标准帧) |

### 5.2 过滤器配置示例

```c
// === 示例 1：接收所有标准帧 (旁路模式) ===
CAN_FilterInitStructure.CAN_FilterNumber = 0;
CAN_FilterInitStructure.CAN_FilterMode = CAN_FilterMode_IdMask;
CAN_FilterInitStructure.CAN_FilterScale = CAN_FilterScale_32bit;
CAN_FilterInitStructure.CAN_FilterIdHigh = 0;
CAN_FilterInitStructure.CAN_FilterIdLow  = 0;
CAN_FilterInitStructure.CAN_FilterMaskIdHigh = 0;  // Mask 全 0 = 全接收
CAN_FilterInitStructure.CAN_FilterMaskIdLow  = 0;
CAN_FilterInitStructure.CAN_FilterFIFOAssignment = CAN_Filter_FIFO0;
CAN_FilterInitStructure.CAN_FilterActivation = ENABLE;
CAN_FilterInit(&CAN_FilterInitStructure);

// === 示例 2：只接收标准 ID 0x123 ===
// 标准 ID 在 32 位模式下的位置：STID 左移 21 位
CAN_FilterInitStructure.CAN_FilterIdHigh = 0x123 << 5;
CAN_FilterInitStructure.CAN_FilterIdLow  = 0;
CAN_FilterInitStructure.CAN_FilterMaskIdHigh = 0xFFFF;  // 精确匹配
CAN_FilterInitStructure.CAN_FilterMaskIdLow  = 0;

// === 示例 3：接收 CANopen 0x181~0x187 (4 个 PDO) ===
// Mask 中 1 = 需匹配，0 = 不关心
// 匹配除 bit0~2 以外的所有位
CAN_FilterInitStructure.CAN_FilterIdHigh = 0x181 << 5;
CAN_FilterInitStructure.CAN_FilterMaskIdHigh = ~((0x7) << 5) & 0xFFE0;
```

### 5.3 ID 在 32 位过滤器中的位布局

```
标准帧 (11-bit):
+----------------------------------------+
| STID[10:3] | STID[2:0] | RTR | IDE | 0 |
|   (8 bit)  |  (3 bit)  | 1b  |  0  | 0 |
+----------------------------------------+
  <-------- FilterIdHigh [15:0] --------->

扩展帧 (29-bit):
+----------------------------------------+----------------------------------------+
| EXID[28:13] (16 bit)                  | EXID[12:0] (13 bit) | IDE=1 | RTR | 0 |
+----------------------------------------+----------------------------------------+
  <---- FilterIdHigh [15:0] ----->       <---- FilterIdLow [15:0] ------------->
```

::: warning 过滤器配置陷阱
配置过滤器必须在 CAN 初始化完成后，且过滤器寄存器在 `CAN_FMR` 的 FINIT (Filter Init Mode) 位为 1 时才能写。标准外设库的 `CAN_FilterInit()` 函数内部自动设置了 FINIT 位。
:::

---

## 6. 接收处理

### 6.1 中断方式接收

```c
// 配置接收中断
CAN_ITConfig(CAN1, CAN_IT_FMP0, ENABLE);  // FIFO0 消息挂起中断

// NVIC 配置
NVIC_InitStructure.NVIC_IRQChannel = CAN1_RX0_IRQn;
NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority = 1;
NVIC_InitStructure.NVIC_IRQChannelSubPriority = 0;
NVIC_InitStructure.NVIC_IRQChannelCmd = ENABLE;
NVIC_Init(&NVIC_InitStructure);

// 中断服务函数
void CAN1_RX0_IRQHandler(void) {
    CanRxMsg RxMessage;
    CAN_Receive(CAN1, CAN_FIFO0, &RxMessage);

    // 数据在 RxMessage.Data[], 长度在 RxMessage.DLC
    // ID 在 RxMessage.StdId (标准) 或 RxMessage.ExtId (扩展)

    // 关键：读完后自动清中断标志
}
```

### 6.2 FIFO 溢出处理

```c
void CAN1_RX0_IRQHandler(void) {
    CanRxMsg RxMessage;

    // 先检查溢出标志
    if (CAN_GetFlagStatus(CAN1, CAN_FLAG_FOV0)) {
        // FIFO0 溢出！有帧丢失
        // 必须清除溢出标志才能继续接收
        CAN_ClearFlag(CAN1, CAN_FLAG_FOV0);
    }

    if (CAN_MessagePending(CAN1, CAN_FIFO0)) {
        CAN_Receive(CAN1, CAN_FIFO0, &RxMessage);
        ProcessCanMessage(&RxMessage);
        // 处理函数必须快速返回，不能阻塞
    }
}
```

### 6.3 高效接收模式（环形缓冲区）

中断中只做数据拷贝，实际处理放到主循环或低优先级任务中：

```c
#define CAN_RX_BUF_SIZE 32

volatile CanRxMsg can_rx_buf[CAN_RX_BUF_SIZE];
volatile uint8_t   can_rx_head = 0;
volatile uint8_t   can_rx_tail = 0;

void CAN1_RX0_IRQHandler(void) {
    if (CAN_MessagePending(CAN1, CAN_FIFO0)) {
        uint8_t next = (can_rx_head + 1) % CAN_RX_BUF_SIZE;
        if (next != can_rx_tail) {
            CAN_Receive(CAN1, CAN_FIFO0, (CanRxMsg*)&can_rx_buf[can_rx_head]);
            can_rx_head = next;
        } else {
            // 缓冲区满，记录丢帧计数
        }
    }
}

// 主循环中处理
void CanMessageProc(void) {
    while (can_rx_tail != can_rx_head) {
        ProcessCanMessage((CanRxMsg*)&can_rx_buf[can_rx_tail]);
        can_rx_tail = (can_rx_tail + 1) % CAN_RX_BUF_SIZE;
    }
}
```

---

## 7. 发送处理

### 7.1 发送函数

```c
CanTxMsg TxMessage;
uint8_t  mailbox;

TxMessage.StdId = 0x123;
TxMessage.ExtId = 0;            // 标准帧不关心
TxMessage.IDE   = CAN_Id_Standard;
TxMessage.RTR   = CAN_RTR_Data;
TxMessage.DLC   = 8;

TxMessage.Data[0] = 0x01;
TxMessage.Data[1] = 0x02;
// ... (Data 数组为 uint8_t，无端序问题)

mailbox = CAN_Transmit(CAN1, &TxMessage);
// 返回值：0-2 = 成功 (邮箱号), CAN_TxStatus_NoMailBox = 失败
```

### 7.2 发送完成检测

```c
// 方式 1：轮询邮箱状态
uint8_t TransmitMailbox(CAN_TypeDef* CANx, CanTxMsg* msg) {
    uint8_t mb = CAN_Transmit(CANx, msg);
    if (mb == CAN_TxStatus_NoMailBox) return 0;

    uint32_t timeout = 0xFFFFF;
    while (CAN_TransmitStatus(CANx, mb) != CAN_TxStatus_Ok) {
        if (--timeout == 0) return 0;
    }
    return 1;
}

// 方式 2：中断发送完成
CAN_ITConfig(CAN1, CAN_IT_TME, ENABLE);  // 发送邮箱空中断
```

---

## 8. 模式详解

| 模式 | CAN_Init取值 | 用途 | 需要收发器 |
|------|------------|------|-----------|
| Normal | `CAN_Mode_Normal` | 正常通信 | 是 |
| LoopBack | `CAN_Mode_LoopBack` | TX内连RX，调试发送/接收 | 否 |
| Silent | `CAN_Mode_Silent` | 只收不发，总线监听 | 是 |
| Silent_LoopBack | `CAN_Mode_Silent_LoopBack` | 内部回环，软件单测 | 否 |

```c
// 调试阶段：先用 LoopBack 确认软件逻辑正确
CAN_InitStructure.CAN_Mode = CAN_Mode_LoopBack;
CAN_Init(CAN1, &CAN_InitStructure);
// ... 验证发送接收逻辑 ...

// 再切换到正常模式
CAN_InitStructure.CAN_Mode = CAN_Mode_Normal;
CAN_Init(CAN1, &CAN_InitStructure);
```

---

## 9. FDCAN (STM32G0/G4/H7)

### 9.1 与 bxCAN 的关键差异

| 项目 | bxCAN | FDCAN |
|------|-------|-------|
| 寄存器接口 | 标准 32 位 | 独立消息 RAM，需配置起始偏移 |
| 数据长度 | 0-8 字节 | 0-8/12/16/20/24/32/48/64 字节 |
| 标准帧过滤 | 最多 28 组 | 最多 28 组标准 + 8 组扩展 |
| 发送缓冲 | 3 个邮箱 | 可配置深度 TX FIFO/Queue |
| 接收缓冲 | 2 x 3 深 | 可配置 2 个 RX FIFO + RX Buffer |
| 位速率切换 | 不支持 | 支持 (BRS) |
| 时间戳 | 无 | 16 位/32 位硬件时间戳 |

### 9.2 FDCAN RAM 配置

FDCAN 使用独立的 Message RAM，需要手动分配各区域：

```c
// H7 FDCAN 示例：配置 Message RAM (位于 0x4000AC00)
FDCAN1->RXF0C  |= (rx_fifo0_start << 16);
FDCAN1->RXF0C  |= rx_fifo0_elements;
FDCAN1->RXF1C  |= (rx_fifo1_start << 16);
FDCAN1->RXF1C  |= rx_fifo1_elements;
FDCAN1->TXBC   |= (tx_buf_start << 16);
FDCAN1->TXBC   |= tx_elements;
FDCAN1->SIDFC  |= (std_filter_start << 16);
FDCAN1->SIDFC  |= std_filter_count;
FDCAN1->XIDFC  |= (ext_filter_start << 16);
FDCAN1->XIDFC  |= ext_filter_count;
// 所有区域不能重叠，否则行为未定义
```

用 STM32CubeMX 可自动计算 RAM 偏移。

### 9.3 FDCAN 中断向量变更

| bxCAN 中断 | FDCAN 替代 |
|-----------|-----------|
| CAN1_RX0_IRQHandler | FDCAN1_IT0_IRQHandler (中断线 0) |
| CAN1_RX1_IRQHandler | FDCAN1_IT1_IRQHandler (中断线 1) |
| CAN1_TX_IRQHandler  | 合并到 IT0/IT1 中 |

---

## 10. 开发注意事项清单

### 10.1 初始化陷阱

| # | 问题 | 后果 | 解决方案 |
|---|------|------|---------|
| 1 | 忘记 `CAN_DeInit` | 残留状态致初始化失败 | `CAN_Init` 前先 `CAN_DeInit` |
| 2 | `CAN_NART = ENABLE` | 发送失败不自动重发 | 通常设为 `DISABLE` |
| 3 | `CAN_ABOM = DISABLE` | Bus-Off 后永久离线 | **必须设为 `ENABLE`** |
| 4 | 单节点用 Normal 模式 | `CAN_Init` 死等 ACK | 先 LoopBack 或接 2 个节点 |
| 5 | 忘记使能 GPIO AF | CAN 引脚无功能 | 检查 `GPIO_PinAFConfig` |

### 10.2 运行时陷阱

| # | 问题 | 后果 | 解决方案 |
|---|------|------|---------|
| 6 | FIFO 溢出不处理 | 后续帧丢弃 | 中断中检查 `CAN_FLAG_FOV0/1` |
| 7 | 中断函数耗时过长 | FIFO 溢出 | 中断只拷贝，主循环处理 |
| 8 | 未监控错误计数器 | 节点无声 Bus-Off | 周期性读取 ESR 中 TEC/REC |
| 9 | 采样点不统一 | 高速通信失败 | 统一采样点 (推荐 87.5%) |
| 10 | 终端电阻遗漏或多余 | 信号反射 | 只两端各接 120R |

### 10.3 硬件陷阱

| # | 问题 | 后果 | 解决方案 |
|---|------|------|---------|
| 11 | 忘记焊终端电阻 | 反射致通信失败 | 测 CAN_H vs CAN_L 约 60R |
| 12 | 收发器 RS 引脚浮空 | 模式不确定 | 接地 (高速模式) |
| 13 | CAN_H/CAN_L 反接 | 全总线无法通信 | 检查差分极性 |
| 14 | 收发器供电电压错误 | 损坏或工作异常 | 查数据手册 VCC 范围 |
