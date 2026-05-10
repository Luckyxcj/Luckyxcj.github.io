# CANopen 基础

本文档介绍 CANopen 的核心概念：协议框架、对象字典和网络管理（NMT）。建议作为阅读其他 CANopen 文档的前置内容。

---

## 1. CANopen 概述

### 1.1 协议定位

CANopen 是基于 CAN 总线的**高层应用协议**，由 CiA (CAN in Automation) 组织制定和维护。它定义了应用层通信规范和设备配置文件，使得不同厂商的设备可以互联互通。

**CAN 协议栈分层：**

```
┌─────────────────────────────────────────┐
│   CiA 4xx 设备子协议 (CiA 401/402/406)  │  ← 设备应用层 (标准化设备行为)
├─────────────────────────────────────────┤
│   CANopen 应用层 (CiA 301)             │  ← NMT, PDO, SDO, 对象字典
├─────────────────────────────────────────┤
│   CAN 数据链路层 (ISO 11898-1)         │  ← 帧格式、仲裁、错误检测
├─────────────────────────────────────────┤
│   CAN 物理层 (ISO 11898-2/3)           │  ← 收发器、差分信号、终端电阻
└─────────────────────────────────────────┘
```

### 1.2 核心设计思想

CANopen 围绕五个核心概念构建：

| 概念 | 作用 | 类比 |
|------|------|------|
| **对象字典 (Object Dictionary)** | 统一参数编址 | 设备的"寄存器映射表" |
| **SDO (Service Data Object)** | 点对点配置 | "配置通道" — 有问有答 |
| **PDO (Process Data Object)** | 实时数据广播 | "数据流通道" — 持续推送 |
| **NMT (Network Management)** | 状态机管理 | "网络管家" — 统管所有节点 |
| **设备子协议** | 行业标准接口 | "设备模板" — 让不同厂家的同类设备互换 |

### 1.3 CiA 标准体系

CANopen 由一系列 CiA 标准构成：

| 标准 | 内容 |
|------|------|
| **CiA 301** | CANopen 应用层与通信协议 (核心) |
| **CiA 302** | CANopen 网络管理补充 (动态 SDO 连接、程序下载) |
| **CiA 303** | 布线、连接器、指示灯 (橙色运行/红色错误) |
| **CiA 304** | CANopen Safety — 功能安全通信 |
| **CiA 305** | 波特率设置 (LSS — Layer Setting Services) |
| **CiA 306** | EDS/DCF 文件规范 |
| **CiA 401** | I/O 模块设备子协议 |
| **CiA 402** | 伺服/变频器/步进电机设备子协议 |
| **CiA 406** | 编码器设备子协议 |
| **CiA 1301** | CANopen FD 协议 |

---

## 2. 对象字典 (Object Dictionary)

对象字典是 CANopen 最核心的概念。每个设备的所有参数——从设备 ID 到应用数据——都存在对象字典中，通过 **16 位索引 (Index)** 和 **8 位子索引 (Sub-index)** 编址。

### 2.1 对象字典地址空间

```
索引范围                内容                                 示例
────────────────────────────────────────────────────────────────────
0x0000                 保留                                 —
0x0001 – 0x001F        静态数据类型定义                      UNSIGNED8=0x05, INTEGER32=0x04
0x0020 – 0x003F        复杂数据类型定义                      PDO 映射记录结构
0x0040 – 0x005F        制造商自定义数据类型
0x0060 – 0x009F        设备子协议数据类型
0x00A0 – 0x0FFF        保留
0x1000 – 0x1FFF        通信对象区                           NMT/PDO/SDO/Heartbeat 参数
0x2000 – 0x5FFF        制造商自定义区                       电机参数、PID、自定义诊断
0x6000 – 0x9FFF        设备子协议区                         CiA 402 控制字/位置/速度
0xA000 – 0xAFFF        符合 IEC 61131-3 的网络变量
0xB000 – 0xBFFF        系统变量 (CiA 302)
0xC000 – 0xFFFF        保留
```

### 2.2 CANopen 数据类型

每个对象字典条目都有一个数据类型。标准数据类型在 0x0001-0x001F 中定义：

| 类型编码 | 名称 | 大小 | 说明 |
|---------|------|------|------|
| 0x01 | BOOLEAN | 1 bit | 布尔值 |
| 0x02 | INTEGER8 | 1 byte | 有符号 8 位 |
| 0x03 | INTEGER16 | 2 bytes | 有符号 16 位 |
| 0x04 | INTEGER32 | 4 bytes | 有符号 32 位 |
| 0x05 | UNSIGNED8 | 1 byte | 无符号 8 位 |
| 0x06 | UNSIGNED16 | 2 bytes | 无符号 16 位 |
| 0x07 | UNSIGNED32 | 4 bytes | 无符号 32 位 |
| 0x08 | REAL32 | 4 bytes | IEEE 754 单精度浮点数 |
| 0x09 | VISIBLE_STRING | 变长 | ASCII 字符串 (null 结尾) |
| 0x0A | OCTET_STRING | 变长 | 字节数组 |
| 0x0B | UNICODE_STRING | 变长 | Unicode 字符串 |

### 2.3 访问权限

| 权限 | 含义 | 说明 |
|------|------|------|
| **RO** (Read Only) | 只读 | 实际位置、实际速度、状态字等反馈量 |
| **WO** (Write Only) | 只写 | 控制字、目标位置等指令量 |
| **RW** (Read/Write) | 读写 | 运行模式、心跳周期等配置参数 |
| **CONST** | 常量 | 设备类型、Vendor-ID 等出厂参数 |

### 2.4 通信对象区 (0x1000 – 0x1FFF) 关键索引

**设备信息类：**

| 索引 | 名称 | 类型 | 说明 |
|------|------|------|------|
| 0x1000 | 设备类型 | U32 | 低 16 位=子协议号 (0x0191=CiA 401, 0x0192=CiA 402, 0x0193=CiA 406)；高 16 位=附加信息 |
| 0x1001 | 错误寄存器 | U8 | bit0=一般错误, bit1=电流, bit2=电压, bit3=温度, bit4=通信, bit5=设备子协议, bit6=保留, bit7=制造商 |
| 0x1003 | 预定义错误域 | ARRAY | 子索引 0=错误数量, 子索引 1-N=最近 N 个错误 (U32 错误码) |
| 0x1008 | 设备名 | STRING | 制造商自定义设备名称 |
| 0x1009 | 硬件版本 | STRING | 硬件版本号 |
| 0x100A | 软件版本 | STRING | 固件版本号 |
| 0x1018 | 标识对象 | RECORD | 子 1=Vendor-ID(U32), 子 2=Product-Code(U32), 子 3=Revision(U32), 子 4=Serial(U32) |

**网络参数类：**

| 索引 | 名称 | 类型 | 说明 |
|------|------|------|------|
| 0x1005 | COB-ID SYNC | U32 | 同步报文 COB-ID (默认 0x080) |
| 0x1006 | 通信周期 | U32 | SYNC 发送周期 (μs) |
| 0x100C | 监护时间 | U16 | Heartbeat 周期 (ms), 0=禁用心跳 |
| 0x100D | 生命因子 | U8 | Node Guarding 超时因子 (已废弃, 推荐 Heartbeat) |
| 0x1014 | COB-ID EMCY | U32 | 紧急报文 COB-ID (默认 0x080 + Node-ID) |
| 0x1016 | 心跳消费者 | ARRAY | 监控目标节点的心跳周期 (ms) + Node-ID |
| 0x1017 | 心跳生产者 | U16 | 本节点心跳发送间隔 (ms), 0=禁用 |
| 0x1019 | 同步计数器溢出 | U8 | SYNC 计数器归零阈值 (0=不归零) |
| 0x1F80 | NMT 启动行为 | U32 | bit0=0 上电进入 Operational; bit0=1 上电进入 Pre-Op; bit2=1 自动启动 |

**存储操作类：**

| 索引 | 名称 | 说明 |
|------|------|------|
| 0x1010 | 存储参数 | 写 ASCII "save"(0x65766173) 将参数保存到非易失存储 |
| 0x1011 | 恢复默认参数 | 写 ASCII "load"(0x64616F6C) 恢复出厂设置, 写 "dada" 仅当厂商参数无效时 |

::: warning 保存参数注意事项
0x1010 和 0x1011 的写入必须以小端 ASCII 格式发送。错误的数据会导致驱动器不保存参数，而不是报错——这是一个常见的坑。
:::

### 2.5 对象字典条目与 EDS 文件

EDS (Electronic Data Sheet) 是描述一个 CANopen 设备完整对象字典的 ASCII 文件。它由 CiA 306 规范定义，用于：

- **网络配置工具** 加载设备的对象字典定义
- **主站程序** 了解从站支持的参数
- **集成工程师** 查看设备参数

EDS 文件必须包含的内容：

```
[FileInfo]       — 文件元信息 (文件名、版本、作者)
[DeviceInfo]     — 设备信息 (厂商、产品名、描述)
[DeviceComissioning] — 默认通信参数 (Node-ID, 波特率)
[MandatoryObjects]   — 必须支持的对象列表
[XXXX]           — 每个对象字典条目的详细定义
[XXXXsubY]       — 子索引定义 (针对 RECORD/ARRAY 类型)
```

一个典型的对象字典条目在 EDS 中的表示：

```ini
[6040]
ParameterName=Controlword
ObjectType=0x07       ; VAR (简单变量)
DataType=0x0006       ; UNSIGNED16
AccessType=RW
DefaultValue=0x0000
PDOMapping=1          ; 可映射到 PDO
```

**常见 ObjectType：**

| 值 | 类型 | 说明 |
|----|------|------|
| 0x07 | VAR | 简单变量 (如 U16 控制字) |
| 0x08 | ARRAY | 数组 (子索引为纯数字 1-N, 同类型) |
| 0x09 | RECORD | 记录 (子索引为命名子条目, 可不同类型) |

---

## 3. 网络管理 (NMT)

### 3.1 NMT 状态机

CANopen 定义了一个标准状态机，每个从节点必须实现：

```
                         上电/硬件复位
                              │
                              ▼
                     ┌────────────────┐
              ┌────  │ Initialisation │
              │      └───────┬────────┘
              │              │ 初始化完成，自动发送 Boot-up 报文
              │              ▼
              │      ┌────────────────┐
              │ ┌──→ │  Pre-Operational│ ←──────────────┐
              │ │    └───┬─────┬──────┘                │
              │ │        │     │                       │
              │ │        │     │ NMT: Start             │
              │ │  NMT:  │     │ Remote Node            │
              │ │  Enter │     ▼                       │
              │ │Pre-Oper│ ┌──────────────┐    NMT:    │
              │ │        │ │ Operational  │──→ Enter   │
              │ │        │ └──────┬───────┘  Pre-Oper  │
              │ │        │        │                     │
              │ │        │        │ NMT: Stop           │
              │ │        ▼        ▼                     │
              │ │      ┌────────────────┐              │
              │ └───── │    Stopped     │──────────────┘
              │        └────────────────┘
              │
              ▼      
        ┌──────────┐
        │  Reset   │ (NMT: Reset Node / Reset Communication)
        └──────────┘
```

### 3.2 各状态说明

| 状态 | 允许操作 | 典型用途 |
|------|---------|---------|
| **Initialisation** | 无 | 上电自检、加载对象字典默认值、硬件初始化。完成后自动发 Boot-up |
| **Pre-Operational** | SDO, NMT, EMCY, SYNC, Heartbeat | **参数配置阶段** — 禁止 PDO，只能通过 SDO 配置 |
| **Operational** | 全部 | **正常通信阶段** — PDO 使能，实时数据交换 |
| **Stopped** | NMT, Heartbeat (可选) | 紧急停止、故障隔离 — 只响应 NMT，其他通信全部停止 |

**状态转换触发方式：**

- **NMT 命令** — 主站主动发送 NMT 报文控制
- **内部事件** — 上电/复位后自动进入 Initialisation
- **错误触发** — 严重错误时驱动器内部自动回退到 Stopped 或 Pre-Op

### 3.3 NMT 报文格式

NMT 报文使用 **COB-ID = 0x000** (最高优先级，CAN 标识符 0 = 最高优先级)，所有从站都监听。格式固定为 2 字节：

```
COB-ID  Byte0    Byte1
0x000   Node-ID  Command

Node-ID:  0x00 = 广播 (所有节点响应)
          0x01-0x7F = 单节点地址

Command:
  0x01  Start Remote Node          → Operational
  0x02  Stop Remote Node           → Stopped
  0x80  Enter Pre-Operational      → Pre-Operational
  0x81  Reset Node                 → 复位应用层 + 通信层 (等同于热重启)
  0x82  Reset Communication        → 仅复位通信层 (NMT 状态机回 Initialisation)
```

**NMT 命令使用场景：**

```
场景 1: 所有节点启动
  → 主站检测到所有从站的 Boot-up 后, 发送 COB-ID=0x000, Data=[0x00, 0x01]
  → 所有节点同时进入 Operational

场景 2: 单节点配置
  → 发送 COB-ID=0x000, Data=[0x02, 0x80]  将节点 2 拉回 Pre-Op
  → SDO 修改节点 2 的 PDO 映射
  → 发送 COB-ID=0x000, Data=[0x02, 0x01]  节点 2 回到 Operational

场景 3: 紧急停机
  → 节点 4 的 EMCY 报告驱动过流
  → 发送 COB-ID=0x000, Data=[0x04, 0x02]  立即停止节点 4

场景 4: 故障复位
  → 节点 3 处于 Fault 状态
  → 发送 COB-ID=0x000, Data=[0x03, 0x81]  Reset Node
  → 节点 3 重新初始化, 发送 Boot-up
```

### 3.4 Boot-up 报文

节点完成 Initialisation 后，自动发送一条 Boot-up 报文：

```
COB-ID = 0x700 + Node-ID
Data   = [0x00]  (1 字节)

示例:
  节点 1 的 Boot-up: COB-ID=0x701, Data=[0x00]
  节点 2 的 Boot-up: COB-ID=0x702, Data=[0x00]
  ...
  节点 127 的 Boot-up: COB-ID=0x77F, Data=[0x00]
```

::: warning Boot-up 常见问题
Boot-up 报文的 COB-ID (0x700+NodeID) 和 Heartbeat 报文的 COB-ID **完全相同**。主站通过数据内容区分：
- Data[0] == 0x00 → Boot-up (初始化完成)
- Data[0] == 0x04 / 0x05 / 0x7F → Heartbeat (当前 NMT 状态)

如果主站漏掉 Boot-up 报文（上电时总线拥堵），该节点可能永远不会被主站发现。建议主站在上电后等待 500ms-1s 再扫描非应答节点。
:::

### 3.5 Node Guarding (已废弃)

Node Guarding 是 Heartbeat 的前身实现。它基于主站轮询机制——主站周期性发送远程帧 (RTR) 给从站，从站响应当前 NMT 状态。

```
Node Guarding (不推荐):
  主站 → 远程帧 (COB-ID: 0x700 + Node-ID, RTR=1)
  从站 → 数据帧 (Data[0]: bit7=Toggle, bit6-0=NMT 状态)

弃用原因:
  - RTR 远程帧在现代 CAN 中不被推荐 (CAN FD 不再支持 RTR)
  - 主站轮询浪费总线带宽
  - 从站离线检测延迟大 (生命因子 × 监护时间)
```

### 3.6 NMT 启动行为配置 (0x1F80)

通过对象 0x1F80 可控制节点上电后的初始行为。该对象的含义依赖 bit0 和 bit2：

```
0x1F80 bit0 = 0 → 上电直接进入 Operational
0x1F80 bit0 = 1 → 上电进入 Pre-Operational (建议默认)

0x1F80 bit2 = 1 → 自动启动 NMT Start (不需要主站发 NMT 命令)
  (仅在 bit0=0 时有效, 节点在 Initialisation 后自己进入 Operational)
```

**推荐配置：** 对于生产环境，建议 `bit0 = 1` (上电 Pre-Op)，由主站完成参数验证后统一切换到 Operational。这样可以防止参数错误的从站直接进入数据交换。

### 3.7 Node-ID 分配规范

| Node-ID | 典型角色 | 说明 |
|---------|---------|------|
| 0x00 | 广播地址 | 不是真实节点 |
| 0x01 | NMT 主站 | 惯例, 非强制 |
| 0x02 – 0x1F | 高优先级从站 | 伺服驱动器等实时设备 |
| 0x20 – 0x5F | 普通从站 | I/O 模块、传感器 |
| 0x60 – 0x7E | 低优先级从站 | 辅助设备、显示面板 |
| 0x7F | 保留 | 不分配给实际节点 |

**Node-ID 设置方式：**

| 方式 | 适用场景 | 说明 |
|------|---------|------|
| **拨码开关 / 旋转开关** | 中小批量 | 最可靠，出厂设置后不会变 |
| **非易失存储** | 大批量 | 通过 SDO/FoE 配置，存储在 EEPROM |
| **LSS (CiA 305)** | 大批量自动化 | 基于唯一序列号自动分配 Node-ID |

---

## 4. CANopen 设备识别流程

当主站发现新节点时，标准识别流程如下：

```
① 收到 Boot-up 报文 (COB-ID: 0x700 + NodeID, Data=[0x00])
② SDO 读 0x1000 (设备类型)   → 确认设备子协议 (CiA 402? CiA 401?)
③ SDO 读 0x1018.01 (Vendor-ID) → 确定制造商
④ SDO 读 0x1018.02 (Product-Code) + 0x1018.03 (Revision) → 确定型号/版本
⑤ SDO 读 0x1008/0x1009/0x100A → 设备/硬件/固件版本字符串
⑥ 根据子协议加载对应的 EDS/DCF 配置
⑦ 进入 Pre-Op, 通过 SDO 写入运行参数
⑧ NMT Start → 进入 Operational, 开始 PDO 数据交换
```

**Vendor-ID 是 CiA 分配的全球唯一编号**，知名厂商的部分 Vendor-ID：

| Vendor-ID | 厂商 |
|-----------|------|
| 0x0000005A | Copley Controls |
| 0x00000066 | Beckhoff Automation |
| 0x000000B0 | Elmo Motion Control |
| 0x000000E4 | Maxon Motor |
| 0x00000162 | Delta Electronics (台达) |
| 0x000001DD | Inovance (汇川) |
