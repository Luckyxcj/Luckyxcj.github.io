# CANopen 开发实战

本文档面向需要在嵌入式平台实现 CANopen 主站/从站的开发者，包含 STM32 裸机和 FreeRTOS 下的主站实现、开源从站协议栈移植、多轴同步插补算法、以及 CiA 402 回零模式的完整应用。

---

## 1. 硬件选型

### 1.1 MCU CAN 外设要求

| 需求 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CAN 控制器 | 1 路 (主站) | 2 路 (主站+冗余) |
| 硬件滤波器 | 至少 14 组 (CANopen 需要多 COB-ID 过滤) | 28 组 |
| 发送邮箱 | 3 个 | ≥ 6 个 |
| 接收 FIFO | 2 组 (每组 ≥ 3 帧深) | 2 组 (每组 ≥ 5 帧深) |
| 定时器 | 1 路 32bit (SYNC 周期) | 2 路 (SYNC + Heartbeat 监控) |

**推荐 MCU：**
- **STM32F4** — bxCAN, 14 组滤波器, 3 发送邮箱, 大量成熟案例
- **STM32G4** — FDCAN, 支持 CAN FD, 更多滤波器和 RAM Buffer
- **STM32H7** — FDCAN, 高速, 大 Buffer, 适合复杂主站

### 1.2 CAN 收发器

| 型号 | 特性 | 适用场景 |
|------|------|---------|
| **TJA1050 / TJA1040** | 高速 CAN 5V 供电, 经典款 | 一般工业应用 |
| **SN65HVD230** | 3.3V 供电, 低功耗睡眠 | 3.3V 系统 |
| **TJA1043** | CAN FD, 低功耗, 唤醒 | 需要 CAN FD 或低功耗 |
| **ISO1050** | 隔离式 CAN | 高可靠性/安全应用 |

---

## 2. STM32 裸机主站实现

### 2.1 最小主站框架

以下代码在 STM32F4 + HAL 库上实现一个最简 CANopen 主站——能够 NMT、SYNC、SDO 读写、处理心跳。

**数据结构和全局状态：**

```c
// canopen_master.h

#include "stm32f4xx_hal.h"

// 节点最大数量
#define MAX_NODES  16

// 节点状态跟踪
typedef struct {
    uint8_t  node_id;
    uint8_t  nmt_state;        // NMT 状态 (0x00=Boot,0x04=Stopped,0x05=Op,0x7F=PreOp)
    uint32_t last_heartbeat_ms; // 上次心跳时间戳
    uint8_t  heartbeat_ok;      // 1=在线, 0=离线
    uint8_t  fault;             // 1=有故障
    uint16_t statusword;        // 最近一次状态字
    int32_t  actual_position;   // 最近一次实际位置
    int32_t  actual_velocity;   // 最近一次实际速度
} canopen_node_t;

extern canopen_node_t g_nodes[MAX_NODES];
extern uint32_t g_systick_ms;  // 系统 1ms 时基

// CAN 帧发送
void can_send(CAN_HandleTypeDef *hcan, uint32_t cob_id, uint8_t *data, uint8_t dlc);

// NMT 命令
void nmt_send(uint8_t node_id, uint8_t command);

// SYNC 发送
void sync_send(void);

// SDO 基本读写 (阻塞, 超时200ms)
int  sdo_read_u32(uint8_t node_id, uint16_t index, uint8_t sub, uint32_t *value);
int  sdo_read_u16(uint8_t node_id, uint16_t index, uint8_t sub, uint16_t *value);
int  sdo_read_u8(uint8_t node_id, uint16_t index, uint8_t sub, uint8_t *value);
int  sdo_write_u32(uint8_t node_id, uint16_t index, uint8_t sub, uint32_t value);
int  sdo_write_u16(uint8_t node_id, uint16_t index, uint8_t sub, uint16_t value);
int  sdo_write_u8(uint8_t node_id, uint16_t index, uint8_t sub, uint8_t value);

// 节点操作
int  node_enable(uint8_t node_id);     // 使能电机 (完整状态机)
int  node_disable(uint8_t node_id);     // 关闭电机
int  node_fault_reset(uint8_t node_id); // 故障复位
void node_set_mode(uint8_t node_id, uint8_t mode);  // 设置运行模式
```

**核心实现：**

```c
// canopen_master.c

canopen_node_t g_nodes[MAX_NODES];

// 发送 CAN 帧
void can_send(CAN_HandleTypeDef *hcan, uint32_t cob_id, uint8_t *data, uint8_t dlc) {
    CAN_TxHeaderTypeDef header = {0};
    header.ExtId = cob_id;          // CANopen 使用扩展 29bit ID
    header.IDE   = CAN_ID_EXT;
    header.RTR   = CAN_RTR_DATA;
    header.DLC   = dlc;

    uint32_t mailbox;
    if (HAL_CAN_AddTxMessage(hcan, &header, data, &mailbox) != HAL_OK) {
        // 发送邮箱满: 重新初始化或丢弃
    }
}

// NMT 命令
void nmt_send(uint8_t node_id, uint8_t command) {
    uint8_t data[2] = {node_id, command};
    can_send(&hcan1, 0x000, data, 2);
}

// SYNC
void sync_send(void) {
    can_send(&hcan1, 0x080, NULL, 0);
}

// SDO 写 32bit — 阻塞实现
int sdo_write_u32(uint8_t node_id, uint16_t index, uint8_t sub, uint32_t value) {
    uint32_t cob_id_req = 0x600 + node_id;
    uint32_t cob_id_resp = 0x580 + node_id;

    uint8_t data[8] = {0};
    data[0] = 0x23;  // Download Request, 4 bytes
    data[1] = index & 0xFF;
    data[2] = (index >> 8) & 0xFF;
    data[3] = sub;
    data[4] = value & 0xFF;
    data[5] = (value >> 8) & 0xFF;
    data[6] = (value >> 16) & 0xFF;
    data[7] = (value >> 24) & 0xFF;

    can_send(&hcan1, cob_id_req, data, 8);

    // 等待响应 (简化轮询, 生产代码应使用中断+队列)
    uint32_t t0 = g_systick_ms;
    while (g_systick_ms - t0 < 200) {  // 200ms 超时
        // 在 CAN 接收中断中更新此标志
        // if (sdo_response_received && sdo_cob_id == cob_id_resp) ...
    }
    return -1;  // 超时
}
```

### 2.2 CAN 接收中断处理

```c
// CAN 接收中断 — 解析所有 CANopen 报文
void HAL_CAN_RxFifo0MsgPendingCallback(CAN_HandleTypeDef *hcan) {
    CAN_RxHeaderTypeDef header;
    uint8_t data[8];
    HAL_CAN_GetRxMessage(hcan, CAN_RX_FIFO0, &header, data);

    uint32_t cob_id = header.ExtId;
    uint8_t  node_id = cob_id & 0x7F;
    uint16_t func    = cob_id & 0x780;  // 功能码 (bit7-10)

    // 确保 node_id 有对应的节点槽位
    if (node_id == 0 || node_id >= MAX_NODES) return;

    canopen_node_t *node = &g_nodes[node_id];

    switch (func) {
        case 0x700:  // Boot-up / Heartbeat
            if (data[0] == 0x00) {
                // Boot-up
                node->nmt_state = 0x7F;  // 默认为 Pre-Op
                node->heartbeat_ok = 1;
                node->fault = 0;
            } else {
                // Heartbeat
                node->nmt_state = data[0];
                node->last_heartbeat_ms = g_systick_ms;
                node->heartbeat_ok = 1;
            }
            break;

        case 0x580:  // SDO Response
            store_sdo_response(node_id, data);
            break;

        case 0x180:  // TPDO1 (预映射: 状态字 + 位置)
            node->statusword     = data[0] | (data[1] << 8);
            node->actual_position = data[2] | (data[3] << 8)
                                  | (data[4] << 16) | (data[5] << 24);
            break;

        case 0x280:  // TPDO2 (预映射: 速度 + 转矩)
            node->actual_velocity = data[0] | (data[1] << 8)
                                  | (data[2] << 16) | (data[3] << 24);
            break;

        case 0x080:  // EMCY
            node->fault = 1;
            uint16_t error_code = data[0] | (data[1] << 8);
            // 记录错误码, 触发应用层处理
            handle_emcy(node_id, error_code, data[2]);
            break;
    }
}
```

### 2.3 SYNC 定时器驱动

```c
// 使用 TIM2 产生 1ms 周期中断来驱动 SYNC
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM2) {
        sync_send();
        // 在 SYNC 之后发送所有 RPDO
        send_all_rpdos();
    }
}

// SYNC 定时器初始化
void sync_timer_init(uint32_t period_us) {
    // 计算预分频和周期值
    // 假设 168MHz 时钟:
    //   PSC = 167  → 定时器时钟 = 168MHz/(167+1) = 1MHz = 1μs
    //   ARR = period_us - 1
    TIM2->PSC = 167;
    TIM2->ARR = 1000 - 1;  // 1ms
    TIM2->DIER |= TIM_DIER_UIE;
    HAL_NVIC_SetPriority(TIM2_IRQn, 0, 0);  // 最高优先级
    HAL_NVIC_EnableIRQ(TIM2_IRQn);
    HAL_TIM_Base_Start_IT(&htim2);
}
```

### 2.4 电机使能/关闭函数

```c
int node_enable(uint8_t node_id) {
    canopen_node_t *node = &g_nodes[node_id];

    // 1. 故障检查
    if (node->statusword & 0x0008) {
        // 有故障, 先复位
        nmt_send(node_id, 0x81);  // Reset Node
        return -1;
    }

    // 2. Shutdown → Ready to Switch On
    send_rpdo_ctrl_word(node_id, 0x0006);
    HAL_Delay(10);
    if ((node->statusword & 0x006F) != 0x0021) return -2;

    // 3. Switch On → Switched On
    send_rpdo_ctrl_word(node_id, 0x0007);
    HAL_Delay(10);
    if ((node->statusword & 0x006F) != 0x0023) return -3;

    // 4. Enable Operation → Operation Enabled
    send_rpdo_ctrl_word(node_id, 0x000F);
    HAL_Delay(10);
    if ((node->statusword & 0x006F) != 0x0027) return -4;

    return 0;
}

void node_disable(uint8_t node_id) {
    send_rpdo_ctrl_word(node_id, 0x0000);  // Disable Voltage
}
```

### 2.5 裸机主循环

```c
// 主站启动流程
void master_init(void) {
    // 1. 等待所有从站上线 (轮询 g_nodes[].heartbeat_ok)
    //    超时 5 秒未上线 → 报告错误
    HAL_Delay(500);  // 给从站初始化时间

    // 2. 所有节点进入 Pre-Op
    nmt_send(0x00, 0x80);  // 广播 Enter Pre-Op
    HAL_Delay(100);

    // 3. 逐个读取设备标识, 验证设备类型
    for (int id = 2; id < MAX_NODES; id++) {
        if (!g_nodes[id].heartbeat_ok) continue;

        uint32_t dev_type;
        if (sdo_read_u32(id, 0x1000, 0, &dev_type) == 0) {
            if ((dev_type & 0xFFFF) != 0x0192) {
                // 非 CiA 402 设备, 记录警告
            }
        }

        // 4. 配置运行模式
        sdo_write_u8(id, 0x6060, 0, 8);  // CSP 模式

        // 5. 配置 PDO 映射 (如果需要自定义)
        configure_pdo_mapping(id);
    }

    // 6. 所有节点进入 Operational
    nmt_send(0x00, 0x01);  // 广播 Start
    HAL_Delay(50);

    // 7. 使能各轴
    for (int id = 2; id < MAX_NODES; id++) {
        if (g_nodes[id].heartbeat_ok) {
            node_enable(id);
        }
    }

    // 8. 启动 SYNC 定时器 (1ms 周期)
    sync_timer_init(1000);
}
```

---

## 3. FreeRTOS 环境主站实现

### 3.1 架构设计

```
优先级 (高→低):
  0 — CAN 接收中断 (TPDO/EMCY 解析)
  1 — SYNC 定时器中断 (释放信号量)
  2 — 控制任务 (SYNC + RPDO 发送 + 轨迹计算)
  3 — SDO 任务 (参数配置, 非实时)
  4 — 监控任务 (心跳检查/EMCY 处理)
```

### 3.2 关键任务实现

```c
// 控制任务 — 最高优先级 FreeRTOS 任务
void control_task(void *pvParameters) {
    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xPeriod = pdMS_TO_TICKS(1);  // 1ms

    while (1) {
        // 精确延时, 补偿执行时间
        vTaskDelayUntil(&xLastWakeTime, xPeriod);

        // 1. 发送 SYNC
        sync_send();

        // 2. 计算轨迹
        for (int id = 2; id < MAX_NODES; id++) {
            if (!g_nodes[id].heartbeat_ok) continue;

            // 获取目标位置 (从轨迹生成器)
            int32_t target_pos = trajectory_next(id);
            send_rpdo_csp(id, 0x000F, target_pos);
        }
    }
}

// 监控任务
void monitor_task(void *pvParameters) {
    const TickType_t xPeriod = pdMS_TO_TICKS(10);  // 10ms 一次
    TickType_t xLastWakeTime = xTaskGetTickCount();

    while (1) {
        vTaskDelayUntil(&xLastWakeTime, xPeriod);

        for (int id = 2; id < MAX_NODES; id++) {
            if (!g_nodes[id].heartbeat_ok) continue;

            // 心跳超时检查 (假设周期 200ms, 超时 600ms)
            uint32_t elapsed = g_systick_ms - g_nodes[id].last_heartbeat_ms;
            if (elapsed > 600) {
                // 离线!
                g_nodes[id].heartbeat_ok = 0;
                // 触发急停逻辑
                emergency_stop_all();
                break;
            }

            // 故障检查
            if (g_nodes[id].statusword & 0x0008) {
                handle_node_fault(id);
            }
        }
    }
}

// SDO 任务 (低优先级)
void sdo_task(void *pvParameters) {
    // 处理 SDO 请求队列
    while (1) {
        sdo_request_t req;
        if (xQueueReceive(g_sdo_queue, &req, portMAX_DELAY) == pdTRUE) {
            sdo_execute(&req);  // 阻塞执行, 超时 200ms
        }
    }
}
```

### 3.3 开发要点

| 要点 | 说明 |
|------|------|
| **SYNC 精度** | 使用硬件定时器 + 信号量, jitter < 10μs |
| **控制任务优先级** | 必须最高, 不能被其他任务打断 |
| **PDO 发送顺序** | SYNC → RPDO (间隔尽量短, 全部在 1 个 SYNC 周期内完成) |
| **SDO 互斥锁** | 同一节点同时只允许一个 SDO 在途 |
| **心跳超时策略** | 连续丢失 3 次心跳才判定离线 (避免误报) |
| **总线负载** | 1Mbps 下建议 < 70%, 留裕量给 EMCY 和重发 |

---

## 4. CANopenNode 从站协议栈移植

[CANopenNode](https://github.com/CANopenNode/CANopenNode) 是最广泛使用的开源 CANopen 从站协议栈。

### 4.1 架构概览

```
┌─────────────────────────────────────┐
│        应用层 (Application)          │  ← 用户代码 (电机控制逻辑)
├─────────────────────────────────────┤
│  CANopenNode 协议栈                  │
│  ├── CO_NMT.c    (NMT 从站)         │
│  ├── CO_SDO.c    (SDO 服务器)       │
│  ├── CO_PDO.c    (PDO 处理)         │
│  ├── CO_EMCY.c   (EMCY 生产者)      │
│  ├── CO_SYNC.c   (SYNC 消费者)      │
│  ├── CO_HB.c     (Heartbeat 生产者) │
│  ├── CO_OD.c     (对象字典, Excel生成)│
│  └── CO_Emergency.c                 │
├─────────────────────────────────────┤
│  CAN 驱动适配层 (CO_driver.h)       │
├─────────────────────────────────────┤
│  硬件 (STM32 bxCAN / FDCAN)          │
└─────────────────────────────────────┘
```

### 4.2 移植步骤

**Step 1: 定时器驱动 (1ms 中断)**

```c
// TIM7 提供 1ms 时基
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM7) {
        // CANopenNode 内部计数, 用于 SYNC 超时和 Heartbeat
        CO_OD_heartbeatProducerTime += 1;
    }
}
```

**Step 2: CAN 驱动适配**

```c
CO_ReturnError_t CO_CANmodule_init(CO_CANmodule_t *CANmodule,
                                    void *CANdriverHandle,
                                    CO_CANrx_t rxBuffer[],
                                    CO_CANtx_t txBuffer[],
                                    uint16_t CANbitRate) {
    // 1. 保存 CAN 句柄
    CANmodule->CANhandle = CANdriverHandle;

    // 2. 初始化 CAN 外设 (HAL)
    CAN_HandleTypeDef *hcan = (CAN_HandleTypeDef *)CANdriverHandle;
    // ... HAL CAN Init with bitrate ...

    // 3. 配置过滤器 (接收所有 CANopen COB-ID)
    CAN_FilterTypeDef filter;
    filter.FilterMode = CAN_FILTERMODE_IDMASK;
    filter.FilterScale = CAN_FILTERSCALE_32BIT;
    // 配置接收获胜过滤器...

    HAL_CAN_Start(hcan);
    HAL_CAN_ActivateNotification(hcan, CAN_IT_RX_FIFO0_MSG_PENDING);

    return CO_ERROR_NO;
}

CO_ReturnError_t CO_CANsend(CO_CANmodule_t *CANmodule, void *msg) {
    CO_CANtx_t *pmsg = (CO_CANtx_t *)msg;
    CAN_HandleTypeDef *hcan = (CAN_HandleTypeDef *)CANmodule->CANhandle;

    CAN_TxHeaderTypeDef header = {0};
    header.ExtId = pmsg->ident;
    header.IDE   = CAN_ID_EXT;
    header.DLC   = pmsg->DLC;

    uint32_t mailbox;
    if (HAL_CAN_AddTxMessage(hcan, &header, pmsg->data, &mailbox) != HAL_OK) {
        return CO_ERROR_TX_OVERFLOW;
    }
    return CO_ERROR_NO;
}
```

**Step 3: CAN 接收中断适配**

```c
void HAL_CAN_RxFifo0MsgPendingCallback(CAN_HandleTypeDef *hcan) {
    CAN_RxHeaderTypeDef header;
    uint8_t data[8];
    HAL_CAN_GetRxMessage(hcan, CAN_RX_FIFO0, &header, data);

    CO_CANrxMsg_t rxMsg;
    rxMsg.ident = header.ExtId;
    rxMsg.DLC   = header.DLC;
    memcpy(rxMsg.data, data, 8);

    // 调用 CANopenNode 回调
    CO_CANrx_callback(&CO->CANmodule[0], &rxMsg);
}
```

**Step 4: 主循环**

```c
int main(void) {
    HAL_Init();
    SystemClock_Config();
    MX_CAN1_Init();
    MX_TIM7_Init();

    // 初始化 CANopenNode
    CO = CO_new(NULL, &CO_CANmodule[0]);
    CO_CANinit(&CO_CANmodule[0], &hcan1, 1000000);  // 1Mbps
    CO_init(CO, 2, 1000000);  // Node-ID=2

    CO_CANsetNormalMode(&CO_CANmodule[0]);
    HAL_TIM_Base_Start_IT(&htim7);

    while (1) {
        // CANopenNode 主处理 (处理 PDO/SDO/NMT)
        CO_process(CO, 0, NULL);

        if (CO->NMToperatingState == NMT_OPERATIONAL) {
            // 读取 RPDO 映射中的目标值
            int32_t target_pos = CO_OD_readInt32(CO->SDO[0], 0x607A, 0x00);
            // 更新电机控制
            set_motor_position(target_pos);

            // 更新 TPDO 映射中的实际值
            int32_t actual_pos = get_motor_encoder();
            CO_OD_writeInt32(CO->SDO[0], 0x6064, 0x00, actual_pos);
        }
    }
}
```

### 4.3 对象字典生成流程

```
Excel 编辑 (ObjDict.xlsx)
  │
  ├─→ objdictgen.py → CO_OD.h / CO_OD.c  (C 源码, 协议栈直接使用)
  ├─→ objdictgen.py → ObjDict.eds        (EDS 文件, 网络配置工具用)
  └─→ objdictgen.py → ObjDict.md         (参数手册, 给使用者看)
```

### 4.4 开源协议栈选型

| 协议栈 | 语言 | 平台 | 主站 | 从站 | 特点 |
|--------|------|------|------|------|------|
| **CANopenNode** | C | MCU (STM32, ESP32, PIC) | ✗ | ✓ | 最广泛使用, 轻量 ~10KB |
| **Lely CANopen** | C++17 | Linux, RTOS | ✓ | ✓ | 功能最全, CiA 402 主站 |
| **CanFestival** | C | MCU, Linux | ✓ | ✓ | 老旧, 不推荐新项目 |
| **MicroCANopen** | C | 极低资源 MCU | ✗ | ✓ | 最小实现 ~4KB |

---

## 5. 多轴同步插补

### 5.1 同步机制

CANopen 通过 SYNC 报文实现**分布式同步**。所有从站在收到 SYNC 的同一微秒内锁存当前位置，在同一微秒内执行 RPDO 中的指令。

```
            SYNC(n-1)    SYN(n)       SYNC(n+1)
               │            │            │
  从站 1:     ├──锁存+执行───┼──锁存+执行───┼──
  从站 2:     ├──锁存+执行───┼──锁存+执行───┼──
  从站 3:     ├──锁存+执行───┼──锁存+执行───┼──
               │            │            │
  主站 RPDO:  发送 n 周期指令  发送 n+1 周期指令
```

**关键约束：** 主站必须在每次 SYNC **之前**发送完当前周期的所有 RPDO。

### 5.2 两轴直线插补实现 (CSP 模式)

以下代码生成 XY 直线轨迹，每个 SYNC 周期更新两轴目标位置。

```c
// 直线插补轨迹
typedef struct {
    int32_t x_start, y_start;
    int32_t x_end, y_end;
    int32_t total_steps;    // 总步数
    int32_t current_step;   // 当前步
    uint32_t feed_rate;     // 进给速度 (counts/s)
} linear_interp_t;

int linear_interp_init(linear_interp_t *li,
                        int32_t x0, int32_t y0,
                        int32_t x1, int32_t y1,
                        uint32_t feed_rate, uint32_t sync_period_us) {
    li->x_start = x0; li->y_start = y0;
    li->x_end = x1; li->y_end = y1;
    li->feed_rate = feed_rate;
    li->current_step = 0;

    // 计算总距离
    double dx = x1 - x0, dy = y1 - y0;
    double total_dist = sqrt(dx * dx + dy * dy);

    // 总时间 = 距离 / 速度
    double total_time = total_dist / feed_rate;  // 秒

    // 总步数 = 总时间 / 同步周期
    li->total_steps = (int32_t)(total_time / (sync_period_us / 1000000.0));

    return li->total_steps;
}

// 每周期调用 — 返回 0 = 继续, 1 = 完成
int linear_interp_next(linear_interp_t *li, int32_t *x_out, int32_t *y_out) {
    if (li->current_step >= li->total_steps) {
        *x_out = li->x_end;
        *y_out = li->y_end;
        return 1;  // 完成
    }

    double t = (double)li->current_step / li->total_steps;
    *x_out = li->x_start + (int32_t)((li->x_end - li->x_start) * t);
    *y_out = li->y_start + (int32_t)((li->y_end - li->y_start) * t);
    li->current_step++;
    return 0;
}
```

### 5.3 多轴同步精度保障

| 因素 | 影响 | 对策 |
|------|------|------|
| SYNC 发送 jitter | 各轴执行时刻不一致 | 使用硬件定时器中断驱动 SYNC |
| RPDO 仲裁延迟 | 不同轴收到指令时刻不同 | 确保 RPDO 都在 SYNC 前发完 |
| 从站内部延迟差异 | 不同品牌伺服响应时间不同 | 选择支持 SYNC 锁存功能的驱动器 |
| CAN 波特率不足 | 多轴 PDO 太多导致通信拥塞 | 提升波特率, 或减少同步 PDO 数量 |

---

## 6. CiA 402 回零模式详解

### 6.1 回零方法分类

| 类别 | 方法编号 | 触发信号 | 特点 |
|------|---------|---------|------|
| 限位 + 索引脉冲 | **1-2** | 限位开关 + 编码器 Z | 常用, 精度依赖于 Z 信号 |
| 原点开关 + 索引脉冲 | **3-6** | 原点开关 ± 编码器 Z | 最常用, 适用于有单独原点开关的系统 |
| 限位 + 原点 + 索引 | **7-14** | 限位 + 原点 + Z | 复杂, 用于需要双重确认的系统 |
| 仅限位 | **17-30** | 限位开关 | 无编码器 Z 信号时使用 |
| 仅索引脉冲 | **33-34** | 编码器 Z | 旋转轴/有限行程轴 |
| 当前位置归零 | **35** | 无 | 最简单, 将当前位置设为原点 |

### 6.2 方法 1 详解 (负限位 + 索引脉冲, 最常用)

```
                        负限位开关
                         ───┼───
                            │ ← 碰限位后反向
      电机 ←────────────────┤
                            │         Z 信号 (编码器转一圈一个脉冲)
                            │            ▲
                            │ ──────────→│──────→ 找 Z 后停下, 回零完成
                            │   低速     
    原点 = Z 脉冲位置 + Home Offset (0x607C)
```

**回零流程：**
1. 电机以高速朝负方向运动
2. 碰到负限位开关 → 立即减速, 反向运动
3. 离开限位开关后, 以低速寻找第一个 Z 脉冲
4. Z 脉冲触发 → 停止, 当前位置 = 原点 + 0x607C 偏移

### 6.3 回零 SDO 配置

```
节点 2, 方法 1 (负限位 + 索引脉冲):

① 写入回零方法:
  COB-ID: 0x602  Data: 2F 98 60 00 01 00 00 00
  → 0x6098 = 0x01

② 写入回零速度:
  高速 (找限位): 100000 counts/s
  COB-ID: 0x602  Data: 23 99 60 01 A0 86 01 00
  → 0x6099.01 = 0x000186A0

  低速 (找 Z): 10000 counts/s
  COB-ID: 0x602  Data: 23 99 60 02 10 27 00 00
  → 0x6099.02 = 0x00002710

③ 写入原点偏移 (可选):
  COB-ID: 0x602  Data: 23 7C 60 00 88 13 00 00
  → 0x607C = 5000

④ 启动回零 (通过 RPDO 控制字):
  RPDO: COB-ID: 0x202  Data: 1F 00 ...
  → 控制字 = 0x001F (bit4=1, Homing Operation Start)
```

### 6.4 回零状态监控

```
状态字 bit10=1 → Target Reached (回零完成)
状态字 bit12=1 → Homing Attained (已获取原点)
状态字 bit13=1 → Homing Error (回零失败)

bit13=1 时, 通过 EMCY 内容或驱动器厂商对象查看具体原因。
```

### 6.5 回零故障排查

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| 回零不完成, 电机一直走 | 限位开关信号异常 (接反/损坏) | 用示波器查限位开关电平, 确认常开/常闭配置 |
| 回零完成但位置偏差固定 | Z 信号不可靠 | 换用上升沿+下降沿确认 (方法 3/4, 检测原点开关的双沿) |
| 碰限位后不反向 | 限位逻辑错误 | 检查驱动器参数: 限位常开/常闭 |
| 冲过限位 | 高速搜索速度太快, 硬件限位超程不足 | 降低 0x6099.01 高速速度, 增加限位缓冲距离 |
| 找不到 Z 信号 | 编码器线数太少或 Z 通道损坏 | 用方法 35 (当前位置归零) 应急, 或换用仅原点开关方式 |
| 每次回零结果不一致 | 回零速度波动, Z 信号检测抖动 | 降低低速搜索速度 0x6099.02, 设置原点偏移在 Z 和机械原点之间 |

---

## 7. 开发调试清单

### 7.1 主站开发检查项

- [ ] NMT 命令能否正确控制从站状态切换?
- [ ] SDO 读写超时处理是否实现? (200ms + 重试 3 次)
- [ ] SYNC 周期是否稳定? (用示波器测量 CAN 总线波形)
- [ ] 所有节点的 Boot-up 是否都能收到?
- [ ] 心跳超时 < 200ms 的节点是否判定为离线?
- [ ] EMCY 报文是否被正确处理并触发相应保护逻辑?
- [ ] PDO 映射的字节数与实际发送的数据是否一致?

### 7.2 从站开发检查项

- [ ] EDS 文件中的所有对象是否都在固件中实现?
- [ ] PDO 映射更改是否需要 Pre-Op 状态? (标准要求 Pre-Op)
- [ ] 对象字典的只读/只写权限是否正确强制?
- [ ] 断电后对象字典修改是否保存? (需主动写 0x1010)
- [ ] Heartbeat 周期是否准确? (误差 < 10%)
