# CANopen 生态与工具

本文档覆盖 CANopen 开发调试工具链、主流驱动器配置要点、周边协议生态，以及 Python 辅助工具代码。适合在项目调试和选型阶段参考。

---

## 1. CANopen 抓包分析

### 1.1 工具选择

| 工具 | 平台 | 费用 | 核心能力 |
|------|------|------|---------|
| **PCAN-View** | Windows | 免费 (需 PEAK 硬件) | 抓包、CANopen 插件解析、统计 |
| **CANoe** | Windows | 收费 (Vector) | 全功能仿真、脚本 (CAPL)、自动测试 |
| **candump + Wireshark** | Linux | 免费 | 命令行抓包 + 图形化协议解析 |
| **BUSMASTER** | Windows | 免费开源 | 抓包、脚本、CANopen 插件 |
| **CANalyzer** | Windows | 收费 (Vector) | 轻量版 CANoe, 纯分析 |

### 1.2 Linux candump 实战

```bash
# 1. 设置 CAN 接口
sudo ip link set can0 type can bitrate 1000000
sudo ip link set up can0

# 2. 带时间戳实时抓取
candump -ta can0

# 3. 按 COB-ID 过滤 (只看节点 2 的 SDO)
candump can0,600-67f,580-5ff

# 4. 记录日志供 Wireshark 分析
candump -l can0  # 生成 candump-YYYY-MM-DD_HHMMSS.log

# 5. 配合 Wireshark 实时监控
candump can0 | wireshark -k -i -

# 6. 回放日志 (测试用)
canplayer -I candump-2026-05-10_140000.log
```

**candump 输出示例（带注释）：**

```
(000.000)  can0  702   [1]  00                ← 节点 2 Boot-up
(000.010)  can0  602   [8]  40 00 10 00 00 00 00 00  ← SDO 读 0x1000
(000.015)  can0  582   [8]  43 00 10 00 92 01 00 00  ← SDO 响应: CiA 402 (0x0192)
(000.500)  can0  702   [1]  05                ← Heartbeat: Operational
(001.000)  can0  080   [0]                    ← SYNC
(001.001)  can0  182   [6]  27 06 50 85 01 00    ← TPDO1 (状态字+位置)
(001.002)  can0  202   [6]  0F 00 A0 86 01 00    ← RPDO1 (控制字+目标位置)
(001.997)  can0  080   [0]                    ← 下一个 SYNC (周期 ~1ms)
```

### 1.3 报文诊断速查

**1. 检查 NMT 状态流程是否正常：**

```
正常的启动序列:
  Boot-up (0x700+x: [00])
  → SDO 配置通信 (0x600+x / 0x580+x)
  → NMT Start (0x000: xx 01)
  → Heartbeat 变为 Operational (0x700+x: [05])
  → PDO 数据开始交换 (0x180+x / 0x200+x)

异常信号:
  只有 Boot-up, 没有 Heartbeat → 从站卡在 Initialisation / 心跳未开启
  SDO 响应 Abort 0x0800 0021 → 从站不在 Pre-Op / Operational 状态
  PDO 一直不发 → 从站不在 Operational / PDO COB-ID bit31=1(禁用)
```

**2. SDO Abort 错误码速查：**

| Abort Code | 含义 | 常见原因 |
|------------|------|---------|
| 0x0504 0000 | SDO 超时 | 从站 200ms 内未响应 |
| 0x0601 0000 | 对象不存在 | Index/Sub-index 错误 |
| 0x0601 0001 | 读取被拒 | 对象是 WO (只写) |
| 0x0601 0002 | 写入被拒 | 对象是 RO (只读) 或状态不允许 |
| 0x0604 0041 | 不能映射到 PDO | 该对象不允许 PDO 映射 |
| 0x0604 0042 | PDO 长度超出 | 映射总长 > 8 字节 |
| 0x0607 0010 | 数据类型不匹配 | 值大小不对 |
| 0x0609 0011 | 子索引不存在 | Sub 号超出范围 |
| 0x0800 0021 | 当前状态不允许 | 如在 Op 状态修改 PDO 映射 |

### 1.4 Wireshark 解析 CANopen

Wireshark 内置 CANopen 解析器：

```
配置步骤:
  1. Edit → Preferences → Protocols → CANopen
  2. 导入驱动器的 EDS 文件
  3. 打开 candump 日志或实时抓 SocketCAN

解析效果:
  SDO: 自动显示 Index=0x6060, Sub=0x00, Value=0x08 (CSP mode)
  PDO: 自动按映射解析 → 0x6041=0x0627, 0x6064=99664, 0x606C=21
  EMCY: 显示错误码文字描述 (如 0x2300="Continuous over current")
  NMT: 自动标注 "Start Node 2"
```

### 1.5 PCAN-View CANopen 插件

```
操作流程:
  1. 连接 PEAK CAN 硬件 → 选择波特率
  2. View → CANopen Project → 加载 EDS 文件
  3. 右键节点 → SDO Read/Write → 图形化读写对象字典
  4. Trace 窗口: 按 COB-ID 过滤 (如 "182" 只看 TPDO1)
  5. 导出 CSV: File → Export → 选时间范围和 COB-ID
  6. 统计窗口: 查看总线负载率 (Busload)、错误帧计数
```

---

## 2. 常见驱动器 CANopen 配置

### 2.1 Copley Controls (Accelnet / Xenus)

Copley 的 CiA 402 兼容性最好，是"标准答案"级实现。

**关键参数：**

| 对象 | 说明 | 默认值 |
|------|------|--------|
| 0x2000 | Node-ID (非易失) | 1 |
| 0x2001 | 波特率 (0=1M, 1=800K, 2=500K, 3=250K) | 0 |
| 0x24A0 | 启动行为 (0=Pre-Op, 1=Op) | 1 |

**默认 PDO 映射 (出厂预设, 大多数场景无需修改)：**

```
TPDO1: 0x6041(Statusword,16b) + 0x6064(Position Actual,32b) = 6 字节
RPDO1: 0x6040(Controlword,16b) + 0x607A(Target Position,32b) = 6 字节
TPDO2: 0x6041(Statusword,16b) + 0x606C(Velocity,32b) + 0x6078(Current,16b) = 8 字节
RPDO2: 0x6040(Controlword,16b) + 0x60FF(Target Velocity,32b) = 6 字节
```

**注意事项：**
- 位置限制 0x607D/0x607E 超出会导致 Fault，新项目务必设置
- 限位开关的极性由 CME2 软件配置，不在对象字典中

### 2.2 Elmo (Gold / SimplIQ)

**与标准 CiA 402 的关键差异：**

| 项目 | 标准 CiA 402 | Elmo |
|------|-------------|------|
| Node-ID 配置 | SDO 写 0x2000 或面板 | EASII 软件, 写入后需重启 |
| 模式切换 | Operation Enabled 下可直接切换 | **必须先 Disable Operation 才能切换** |
| 位置单位 | 用户自定义单位 | 编码器脉冲 (Pulse) |
| 速度单位 | 用户自定义单位/s | Pulse/s |

**单位换算公式：**

```
电机编码器: 2500 line/rev × 4(quadrature) = 10000 Pulse/rev
减速比: 100:1

位置换算:
  用户单位 → Pulse:  TargetPosition × (Encoder_Resolution / User_Units_per_rev) / Gear_Ratio
  Pulse → 用户单位:  ActualPosition × Gear_Ratio / (Encoder_Resolution / User_Units_per_rev)

速度换算:
  TargetVelocity = UserVelocity (rpm) × Encoder_Resolution(inc/rev) / 60 × Gear_Ratio
  例: 3000rpm → 3000 × 10000 / 60 × 1 = 500000 Pulse/s
  例(带减速比): 30rpm → 30 × 10000 / 60 × 100 = 500000 Pulse/s
```

### 2.3 Maxon (EPOS 系列)

**特色对象字典：**

| 索引 | 名称 | 说明 |
|------|------|------|
| 0x30B0 | Sensor Selection | 0=Hall, 1=Incremental Encoder, 2=SSI Absolute |
| 0x3210 | Motor Type | 0=DC, 1=EC (无刷), 2=Stepper |
| 0x6410 | Motor Rated Current | 单位 mA |

**EPOS 特色功能：**
- **Data Recording (环形缓冲区)** — 高速记录指定对象到 RAM, 离线读取, 绘制响应曲线
- **模拟量叠加** — CANopen 指令 ± 模拟量 ±10V 偏置 (混合控制)
- **I/O 功能映射** — 0x2070/0x2078 可在运行时通过 SDO 重映射

### 2.4 台达 (Delta ASDA-A2 / A3 / B3)

**与标准差异：**

| 项目 | 标准 | 台达 |
|------|------|------|
| Node-ID | SDO/拨码 | **仅面板参数 P3-00** |
| 波特率 | SDO/拨码 | **仅面板参数 P3-01** |
| 默认 PDO 映射 | 纯对象字典 | **含 0x2000.02(DI 状态) 和 0x2001.01(DO 控制)** |
| 回零方法 | 1-35 | 1-14 与标准同, 17-30 使用台达内部编号 |
| SYNC 周期 | — | A2 最小 1ms, A3/B3 最小 0.5ms |

**台达使用要点：**
- 修改 PDO 映射前必须将 P3-09/P3-10 设为自定义模式
- DI/DO 功能映射需在面板上操作或使用台达专用 SDO (0x2000 区)

---

## 3. CiA 402 驱动器选型对比

| 特性 | Copley | Elmo | Maxon EPOS | 台达 ASDA | 汇川 SV660 |
|------|--------|------|------------|----------|-----------|
| CiA 402 兼容性 | 极好 | 好 | 好 | 中等 | 中等 |
| 支持模式 | 全部 | 全部 | PP/PV/HM/CSP/CSV/CST | PP/PV/HM/CSP/CSV | PP/PV/HM/CSP |
| 最小 SYNC 周期 | 250μs | 100μs | 1ms | 1ms(A2)/0.5ms(A3) | 1ms |
| PDO 数量 | 4T4R | 4T4R | 4T4R | 4T4R | 3T3R |
| EDS 文件 | 完善 | 完善 | 完善 | 部分型号缺失 | 通常有 |
| 回零方法 | 全部 35 种 | 全部 35 种 | 1-14,17-30,33-35 | 有限 | 有限 |
| 价格定位 | 高端 | 高端 | 中高端 | 中端 | 中端 |
| 中文文档 | 少 | 少 | 好 | 好 | 好 |

**选型建议：**

- **高精度多轴同步 (< 250μs SYNC)** → Copley 或 Elmo
- **成本敏感、国内生态** → 台达或汇川
- **直流有刷/无刷小功率一体化** → Maxon EPOS
- **高频响 (> 2kHz 带宽)** → Elmo Gold 系列

---

## 4. CANopen Safety (CiA 304)

CiA 304 在标准 CANopen 上实现**功能安全通信**, 达到 IEC 61508 SIL3 / ISO 13849 PL e 等级。

### 4.1 SRDO (Safety-Related Data Object)

SRDO 是安全通信的核心，与 PDO 类似的周期性传输，但增加了多重安全保护：

| 特性 | 标准 PDO | SRDO |
|------|---------|------|
| 数据校验 | CAN CRC (15bit) | 额外 24bit CRC + 序列号 |
| 时间监控 | 无强制要求 | **严格超时 (SCT: Safety Cycle Time)** |
| 冗余 | 无 | **每消息发两次, 互补位 (取反)** |
| 身份认证 | CAN ID 可伪造 | 唯一 SNN (Safety Network Number) |
| 通信周期 | 灵活 | 必须在 SCT 内完成 |

**SRDO 报文结构：**

```
正常报文: [安全数据 1-7 字节][CRC24(3字节)][SeqNum(1字节)]
取反报文: ~[安全数据 1-7 字节][CRC24(3字节)][SeqNum(1字节)]

接收端同时收到两条 → 逐位比较 (必须是精确的互补关系)
→ 不一致 → 安全通信故障 → 触发安全状态 (如 STO)
```

### 4.2 典型安全应用

| 安全功能 | 说明 | SRDO 内容 |
|---------|------|----------|
| **STO (Safe Torque Off)** | 安全转矩关断 | 1 bit 控制 |
| **SS1 (Safe Stop 1)** | 安全停止 1 (减速 + STO) | 控制指令 + 监控 |
| **SLS (Safely Limited Speed)** | 安全限速 | 速度上限值 + 实际速度反馈 |
| **SLP (Safely Limited Position)** | 安全限位 | 位置窗口 + 实际位置反馈 |
| **双手控制** | 双手按钮时序监控 | 按钮状态 + 时间戳 |

**安全通信的响应时间预算：**

```
总响应时间 = 传感器延迟 + SRDO 传输时间 + 安全PLC处理 + 执行器关断
            ≤ 安全距离 / 危险源速度

例: 机械臂末端速度 2m/s, 安全距离 100mm
  总响应时间 ≤ 0.1 / 2 = 50ms
  
  SRDO 周期 = 10ms
  SRDO 传输 = 0.5ms
  传感器 + 处理 + 关断 ≤ 39.5ms
  → 可满足 SIL3 要求
```

---

## 5. CANopen FD

CANopen FD (CiA 1301) 将 CANopen 应用层移植到 CAN FD 物理层。

### 5.1 核心提升

| 特性 | 经典 CANopen | CANopen FD |
|------|-------------|------------|
| PDO 单帧数据 | 8 字节 | 64 字节 |
| SDO 单帧数据 | 4 字节 | 63 字节 |
| 数据段速率 | = 仲裁段 (≤ 1Mbps) | 可独立提升 (≤ 8Mbps) |
| 一帧能传的反馈 | 状态字+位置+速度 (6B) | 状态+位置+速度+转矩+电流+温度+IO+诊断 (40B+) |

**单帧 PDO 能装下什么？**

```
经典 CANopen (8 字节):
  → 2 个 I32 目标值 (如 XY 两轴位置)
  → 或 1 个 I32 + 2 个 I16

CANopen FD (64 字节):
  → 8 个 I32 目标值 (8 轴位置！)
  → 或 4 个 I32 目标位置 + 4 个 I32 速度 + 4 个 I16 转矩
  → 或 1 个完整的运动指令包 (位置+速度+加速度+加加速度+限制值+模式)
```

### 5.2 USDO (Universal SDO)

CANopen FD 新增了 USDO 协议，替代经典 SDO：

```
USDO 特点:
  - 命令-响应模型，单帧 63 字节负载 (无需分段)
  - 支持 Multiplex (一次访问多个对象字典条目)
  - 支持 Write Broadcast (广播写, 一次配置所有同类节点)
  - 支持 Read Multiple (一次读取多个对象)

USDO COB-ID: 0x600 + Node-ID + 0x8000
```

### 5.3 迁移策略

```
方案 A — 混合模式 (推荐过渡期):
  主站: CAN FD 控制器
  关键从站: CAN FD (64B PDO)
  非关键从站: 保持经典 CAN (8B PDO)
  → CAN FD 的 BRS (Bit Rate Switch) 仅影响数据段
  → 仲裁段 1Mbps, FD 数据段 5Mbps 共存

方案 B — 全 FD (新项目):
  全部节点 CAN FD 控制器 + 收发器
  → 重新设计 PDO 映射 (64B 单帧容纳所有数据)
  → 取消 8B 限制, 简化多 PDO 管理

硬件要求:
  - MCU: STM32G0/G4/H7 FDCAN, 或 NXP S32K
  - 收发器: TJA1043, TJA1463 (CAN FD 专用, 向下兼容)
  - 经典 CAN 节点收到 FD 帧会报错并丢帧
```

---

## 6. J1939 vs CANopen 对比

| 维度 | CANopen | J1939 (SAE) |
|------|---------|-------------|
| **应用领域** | 工业自动化、机器人、医疗 | 商用车、工程机械、柴油机 |
| **制定组织** | CiA | SAE |
| **ID 位数** | 11 bit (默认, 可扩展 29bit) | 29 bit (强制) |
| **ID 结构** | 功能码(4bit)+NodeID(7bit) | 优先级(3)+PF(8)+PS(8)+SA(8) |
| **参数组织** | 对象字典 (Index+Sub-index) | PGN (Parameter Group Number, 24bit) + SPN |
| **配置方式** | SDO (点对点请求-确认) | 专用配置报文 |
| **周期性数据** | PDO (同步/异步/事件) | 循环广播 (按 PGN 固定周期) |
| **状态管理** | NMT 集中式状态机 | 无统一状态机, 各 ECU 独立 |
| **最大节点** | 127 + 1 主站 | 254 (29 位 ID 的 8bit SA) |
| **字节序** | 小端 | 小端 |
| **诊断** | EMCY + SDO 读 0x1001/0x1003 | DM1 (Diagnostic Message 1) |
| **网络管理** | NMT Master 集中管理 | Address Claiming (上电自协商) |

**选型指南：**

```
用 CANopen 的典型场景:
  → 多轴伺服/步进电机控制
  → 工业机器人关节
  → 模块化传感器/执行器系统
  → 需要主站集中管理 + 灵活 SDO 配置

用 J1939 的典型场景:
  → 发动机 ECU (柴油/天然气)
  → 商用车仪表盘/车身控制
  → 工程机械液压控制系统
  → 需要节点即插即用 + 不需要主从管理
```

---

## 7. EtherCAT CoE (CANopen over EtherCAT)

CoE 将 CANopen 的**对象字典和 CiA 402 设备子协议**完整复用到 EtherCAT 以太网总线上。

### 7.1 协议映射关系

```
CANopen:
  CAN 物理层 (差分)
    → CAN 数据链路层 (帧、仲裁)
      → CANopen 应用层 (NMT, SDO, PDO, 对象字典)
        → CiA 402 (电机状态机、对象)

EtherCAT CoE:
  以太网 PHY (100Base-TX)
    → EtherCAT 链路层 (ESC + 集总帧)
      → EtherCAT 应用层 (状态机、邮箱、分布时钟 DC)
        → CoE (复用 CANopen 对象字典 + CiA 402)
```

### 7.2 概念一一对应

| CANopen 概念 | EtherCAT CoE 等价 | 差异 |
|-------------|------------------|------|
| PDO | PDO (映射到过程数据区) | **CoE PDO 无 8 字节限制** |
| SDO | SDO (通过邮箱 CoE 协议) | 一次可传数百字节 |
| NMT 状态机 | ESM (Init→PreOp→SafeOp→Op) | 多一个 SafeOp 状态 |
| EMCY | CoE Emergency | 通过邮箱传输 |
| SYNC | **SYNC0/SYNC1 信号** | DC 分布时钟, ns 级同步 |
| 对象字典 | **完全相同的 Index/Sub** | 新增 EtherCAT 专用对象 (0x1C00) |
| EDS 文件 | **ESI XML 文件** | 功能更强 (含 PDO 默认映射) |

### 7.3 代码迁移最小化

CANopen 和 EtherCAT CoE 共用同一个对象字典设计，**应用层控制逻辑几乎相同**：

```c
// CANopen: 写目标位置到 0x607A (通过 SDO)
sdo_write_u32(0x607A, 0x00, target_pos);

// EtherCAT CoE: 0x607A 映射在过程数据区 (通过 PDO)
// 应用层只需更新过程数据对应的内存位置
ecat_pdo.tx.target_position = target_pos;

// 状态机判断逻辑完全一样:
if ((statusword & 0x006F) == 0x0027) {
    // Operation Enabled — 两个协议同用 CiA 402 FSA
}
```

---

## 8. CiA 401 I/O 模块标准

CiA 401 是 CANopen 为**数字量和模拟量 I/O 模块**定义的设备子协议。与 CiA 402 电机在同一网络上共存，构成完整的工业控制系统。

### 8.1 核心对象字典 (0x6000 – 0x6FFF)

**数字量：**

| 索引 | 名称 | 说明 |
|------|------|------|
| 0x6000 | 8 通道数字量输入 | 每 bit 对应一个物理通道 |
| 0x6001 | 8 通道数字量输入 (9-16ch) | — |
| 0x6002 | 8 通道数字量输入 (17-24ch) | — |
| 0x6200 | 8 通道数字量输出 | 每 bit 对应一个物理通道 |

**模拟量：**

| 索引 | 名称 | 说明 |
|------|------|------|
| 0x6401.01-.08 | 模拟量输入值 | I16, 默认 0-10V → 0-32767 |
| 0x6411.01-.08 | 模拟量输出值 | I16 |
| 0x6421 | 模拟量输入中断使能 | 通道超阈值时产生 EMCY |
| 0x6441/0x6442 | 中断触发阈值 (高/低) | — |
| 0x6450 | 平均滤波深度 | 0=无滤波, >0=滑动平均窗口 |

### 8.2 混合网络示例

一个完整的自动化系统通常混合多种从站：

```
  NMT主站 ────────────────────────────────────────
    │                      CAN 总线 (1Mbps)
    ├── 节点 2: Servo_X (CiA 402)
    ├── 节点 3: Servo_Y (CiA 402)
    ├── 节点 4: DI/DO模块 (CiA 401) — 限位开关、气缸、指示灯
    ├── 节点 5: AI/AO模块 (CiA 401) — 压力传感器、比例阀
    └── 节点 6: 编码器 (CiA 406) — 主轴编码器反馈

  SYNC 周期: 1ms
  PDO 分配:
    节点 2 RPDO1 (6B): 0x202
    节点 2 TPDO1 (6B): 0x182
    节点 3 RPDO1 (6B): 0x203
    节点 3 TPDO1 (6B): 0x183
    节点 4 TPDO1 (2B): 0x184 (DI 状态)
    节点 4 RPDO1 (2B): 0x204 (DO 控制)

  总线负载 (1Mbps, 1ms 周期):
    SYNC:   50 bit  × 1kHz    ≈  0.05%
    RPDO×3: 150 bit × 1kHz × 3 ≈ 0.45%
    TPDO×3: 150 bit × 1kHz × 3 ≈ 0.45%
    Heartbeat ×5: ~1% (每 100ms 发送)
    总负载: ~2% (非常安全)
```

---

## 9. 对象字典 Excel 模板

### 9.1 模板结构

对象字典 Excel 是 CANopen 从站开发的**核心文档**。一份好的模板可同时输出：
- **EDS 文件** — 网络配置工具加载
- **C 源码 (CO_OD.h/c)** — CANopenNode 协议栈使用
- **参数手册** — 集成工程师参考

**最小列头：**

| Index | Sub | Parameter Name | Object Type | Data Type | Access | Default Value | PDO Map | Category | Description |
|-------|-----|---------------|-------------|-----------|--------|---------------|---------|----------|-------------|
| 0x6040 | 00 | Controlword | VAR | UNSIGNED16 | RW | 0x0000 | Yes | CiA 402 | 控制字, 控制状态机跳转 |

**完整模板应覆盖：**

```
通信对象区 (0x1000-0x1FFF):
  设备标识 (0x1018): Vendor-ID, Product-Code, Revision, Serial
  Heartbeat (0x1017)
  PDO 通信/映射参数 (0x1400-x1BFF)

制造商区 (0x2000-0x5FFF):
  电机参数: 额定电流、极对数、编码器线数、惯量
  PID 参数: 位置环 Kp/Ki/Kd, 速度环 Kp/Ki, 电流环 Kp/Ki
  I/O 功能映射
  保护阈值: 过温、过流、过压、跟随误差窗口

CiA 402 区 (0x6000-0x6FFF):
  控制/状态、运行模式、目标/实际值、回零参数、限位
```

### 9.2 生成流水线

```
ObjDict.xlsx
    │
    ├─→ objdictgen.py (CANopenNode 官方工具) → CO_OD.h + CO_OD.c
    ├─→ objdictgen.py → ObjDict.eds
    └─→ 自定义 Python 脚本 → ObjDict.md (参数手册)
```

---

## 10. EDS 文件解析器 (Python)

```python
"""
CANopen EDS 解析器
解析 EDS 文件, 支持查询对象信息和生成 C 头文件
依赖: 仅 Python 标准库
"""
import configparser
import os

class EDSParser:
    def __init__(self, eds_path):
        self.parser = configparser.ConfigParser(strict=False)
        self.parser.optionxform = str  # 保持大小写
        with open(eds_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        self.parser.read_string(content)

    def get_object(self, index):
        """获取指定索引的对象信息"""
        section = f'{index:X}'
        if section not in self.parser:
            return None

        sec = self.parser[section]
        return {
            'name': sec.get('ParameterName', ''),
            'type': sec.get('DataType', ''),
            'access': sec.get('AccessType', ''),
            'default': sec.get('DefaultValue', ''),
            'pdo_mappable': sec.get('PDOMapping', '0') == '1',
        }

    def get_all_objects(self):
        """返回所有对象字典条目的排序列表"""
        objects = []
        for section in self.parser.sections():
            if not section[0].isdigit():
                continue
            if 'sub' in section.lower():
                continue
            try:
                idx = int(section, 16)
                obj = self.get_object(idx)
                if obj:
                    objects.append({'index': idx, **obj})
            except ValueError:
                continue
        return sorted(objects, key=lambda x: x['index'])

    def get_device_info(self):
        """读取设备信息"""
        info = {}
        for key in ['VendorName', 'ProductName', 'ProductText']:
            if 'DeviceInfo' in self.parser:
                info[key] = self.parser['DeviceInfo'].get(key, '')
        return info

    def generate_c_header(self, output_path):
        """从 EDS 生成 C 头文件 (对象字典索引宏)"""
        objs = self.get_all_objects()
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('// Auto-generated from EDS file\n')
            f.write('#ifndef OD_INDEX_H_\n#define OD_INDEX_H_\n\n')

            f.write('/* Communication Objects (0x1000-0x1FFF) */\n')
            for obj in objs:
                if 0x1000 <= obj['index'] <= 0x1FFF:
                    f.write(f'#define OD_{obj["name"]:35s} 0x{obj["index"]:04X}\n')

            f.write('\n/* CiA 402 Objects (0x6000-0x9FFF) */\n')
            for obj in objs:
                if 0x6000 <= obj['index'] <= 0x9FFF:
                    f.write(f'#define OD_{obj["name"]:35s} 0x{obj["index"]:04X}\n')

            f.write('\n#endif\n')
        print(f'Generated: {output_path}')


# 命令行用法:
if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print('Usage: python eds_parser.py <eds_file> [--header output.h]')
        sys.exit(1)

    eds = EDSParser(sys.argv[1])
    info = eds.get_device_info()
    print(f"Device: {info.get('VendorName', '?')} / {info.get('ProductName', '?')}")
    print(f"Total objects in EDS: {len(eds.get_all_objects())}")

    # 查询特定对象
    ctrl = eds.get_object(0x6040)
    if ctrl:
        print(f"\n0x6040 Controlword: type={ctrl['type']}, access={ctrl['access']}")

    # 生成 C 头文件
    if '--header' in sys.argv:
        idx = sys.argv.index('--header')
        eds.generate_c_header(sys.argv[idx + 1])
```

---

## 11. python-can 电机调试工具

### 11.1 环境搭建

```bash
pip install python-can
pip install canopen  # CANopen 主站协议栈 (基于 python-can)
```

### 11.2 交互式调试终端

```python
"""
CANopen 电机交互式调试工具
命令: enable, disable, mv <pos>, status, mode <pp|csp|csv>, reset, quit
"""
import canopen
import time
import argparse
import readline  # 方向键支持

class MotorDebugger:
    MODE_MAP = {'pp': 1, 'pv': 3, 'pt': 4, 'hm': 6, 'csp': 8, 'csv': 9, 'cst': 10}

    def __init__(self, channel='can0', node_id=2, eds='drive.eds'):
        self.network = canopen.Network()
        self.network.connect(channel=channel, bustype='socketcan')
        self.node = canopen.RemoteNode(node_id=node_id, object_dictionary=eds)
        self.network.add_node(self.node)
        self.node_id = node_id

    def enable(self):
        """完整使能流程"""
        self.node.nmt.state = 'OPERATIONAL'
        for cmd in [0x06, 0x07, 0x0F]:
            self.node.rpdo[1]['Controlword'].raw = cmd
            time.sleep(0.05)  # 留足够时间给驱动器响应
        sw = self.node.sdo[0x6041].raw
        print(f"Enabled. Statusword = 0x{sw:04X}")

    def disable(self):
        self.node.rpdo[1]['Controlword'].raw = 0x0000
        print("Disabled voltage.")

    def move_to(self, position):
        self.node.rpdo[1]['Target Position'].raw = position
        self.network.sync.send()
        print(f"Target position = {position}")

    def read_status(self):
        sw = self.node.sdo[0x6041].raw
        pos = self.node.sdo[0x6064].raw
        vel = self.node.sdo[0x606C].raw
        mode = self.node.sdo[0x6061].raw

        # 解析状态
        state_code = sw & 0x006F
        states = {0x40: 'NRTSo', 0x21: 'Ready to SO', 0x23: 'SO', 0x27: 'Op Enabled', 0x07: 'QS Active'}
        state_name = states.get(state_code, f'Unknown(0x{state_code:02X})')
        fault = ' FAULT!' if sw & 0x08 else ''

        print(f"Mode:{mode} State:{state_name}{fault} SW:0x{sw:04X} Pos:{pos} Vel:{vel}")

    def set_mode(self, mode_name):
        mode = self.MODE_MAP.get(mode_name)
        if mode is None:
            print(f"Unknown mode: {mode_name}. Available: {list(self.MODE_MAP.keys())}")
            return
        self.node.sdo[0x6060].raw = mode
        time.sleep(0.05)
        actual = self.node.sdo[0x6061].raw
        print(f"Mode: {mode_name}({mode}) / Actual: {actual}")

    def close(self):
        self.network.disconnect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='CANopen Motor Debugger')
    parser.add_argument('--channel', default='can0', help='CAN interface (default: can0)')
    parser.add_argument('--node', type=int, default=2, help='Node-ID (default: 2)')
    parser.add_argument('--eds', default='drive.eds', help='EDS file path')
    args = parser.parse_args()

    m = MotorDebugger(channel=args.channel, node_id=args.node, eds=args.eds)
    print(f"Connected to Node {args.node} on {args.channel}.")
    print("Commands: enable, disable, mv <pos>, status, mode <name>, reset, quit")

    try:
        while True:
            try:
                cmd = input('> ').strip().split()
            except EOFError:
                break
            if not cmd:
                continue
            if cmd[0] == 'enable':      m.enable()
            elif cmd[0] == 'disable':    m.disable()
            elif cmd[0] == 'mv' and len(cmd) == 2: m.move_to(int(cmd[1]))
            elif cmd[0] == 'status':     m.read_status()
            elif cmd[0] == 'mode' and len(cmd) == 2: m.set_mode(cmd[1])
            elif cmd[0] == 'reset':
                m.node.nmt.state = 'RESET'
                time.sleep(0.5)
                print("Node reset.")
            elif cmd[0] == 'quit': break
            else: print("Commands: enable disable mv <pos> status mode <pp|csp|csv> reset quit")
    except KeyboardInterrupt:
        pass
    finally:
        m.close()
        print("\nDisconnected.")
```

**终端运行效果：**

```
$ python motor_debug.py --channel can0 --node 2
Connected to Node 2 on can0.
Commands: enable, disable, mv <pos>, status, mode <name>, reset, quit
> enable
Enabled. Statusword = 0x0627
> mv 100000
Target position = 100000
> status
Mode:8 State:Op Enabled SW:0x0637 Pos:99852 Vel:125
> mv 0
> disable
Disabled voltage.
> quit
Disconnected.
```

---

## 12. 快速故障排查表

| 现象 | 首先检查 | 其次检查 |
|------|---------|---------|
| 从站不上线 (无 Boot-up) | CAN 终端电阻、收发器供电 | 波特率是否一致, Node-ID 是否冲突 |
| SDO 无响应 | 从站是否在 Pre-Op/Op (心跳确认) | COB-ID 是否匹配 (SDO 请求 0x600+ID, 响应 0x580+ID) |
| PDO 无数据 | 从站是否在 Operational | PDO COB-ID bit31 (使能位), PDO 映射条目数 > 0? |
| 电机不使能 | 0x1001 错误寄存器≠0? | 母线电压 / 急停信号 / 硬件使能线 |
| 位置不跟踪 | 模式是否 CSP | RPDO 是否已配置, SYNC 是否在发送 |
| 总线高负载 (>80%) | 心跳周期是否过短 | 异步 PDO 是否有禁止时间, SYNC 周期是否必要这么高 |
| 任意节点丢帧 | 终端电阻缺失 | 支线过长 (>30cm@1Mbps), 波特率/采样点配置 |
