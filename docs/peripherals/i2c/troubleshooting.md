# I2C 故障排查

> **文档说明**：本文档总结 I2C 总线最常见的故障模式及系统化排查方法。

---

## 目录

1. [I2C 故障分类](#1-i2c-故障分类)
2. [排查工具与方法](#2-排查工具与方法)
3. [常见故障及解决方案](#3-常见故障及解决方案)
4. [I2C 死锁恢复](#4-i2c-死锁恢复)
5. [参考文档](#5-参考文档)

---

## 1. I2C 故障分类

```
I2C 故障三大类:

1. 物理层故障 (占 60%)
   ├─ 上拉电阻缺失/阻值不对
   ├─ SDA/SCL 引脚短路/开路
   ├─ 总线电容过大 (走线过长)
   └─ 电源噪声耦合到总线上

2. 协议层故障 (占 30%)
   ├─ 从机地址错误
   ├─ 从机时钟拉伸 (Clock Stretching)
   ├─ 总线死锁 (SDA 一直被某个设备拉低)
   └─ 多主竞争/仲裁丢失

3. 软件层故障 (占 10%)
   ├─ 未正确初始化或未使能时钟
   ├─ 中断优先级问题
   └─ 并发访问冲突 (RTOS 多个任务同时操作 I2C)
```

---

## 2. 排查工具与方法

### 2.1 排查分层方法

```
步骤1: 万用表 (静态检查)
  ├─ 测 VDD-VSS 电压
  ├─ 测 SDA-VDD、SCL-VDD 的通断 (确认上拉电阻)
  └─ 测 SDA-VSS、SCL-VSS 的电阻 (确认没有短路)

步骤2: 逻辑分析仪 (动态检查)
  ├─ 捕获 I2C 波形
  ├─ 解码看数据内容
  └─ 确认 ACK/NACK 第 9 个 bit

步骤3: 示波器 (信号质量检查)
  ├─ 测 SDA/SCL 的上升时间 (tr)
  └─ 测 SDA/SCL 的噪声/毛刺

步骤4: 软件 I2C 扫描器 (地址验证)
  └─ 确认从机是否在线、地址是否正确
```

### 2.2 I2C 地址扫描器

```c
// 扫描 I2C 总线上所有从机地址
// 打印所有响应的地址
void I2C_Scanner(void) {
    printf("I2C Scanner Start...\r\n");
    for (uint8_t addr = 1; addr < 127; addr++) {
        // 尝试向 addr 发送一个 0 字节的空写
        if (HAL_I2C_IsDeviceReady(&hi2c1, addr << 1, 1, 10) == HAL_OK) {
            printf("Device found at 0x%02X\r\n", addr);
        }
    }
    printf("I2C Scanner Done.\r\n");
}
```

---

## 3. 常见故障及解决方案

### 故障 1: SDA 一直为低 (总线死锁)

```
现象: I2C BUSY 标志置位，逻辑分析仪显示 SDA 恒为低。
原因: 主机在读数据过程中被复位，从机仍持有 SDA 拉低 (发送 ACK 或数据 0)。

恢复方法: 软件复位 I2C 外设 + 在 SCL 上发送 9 个脉冲使从机释放 SDA
```

```c
// I2C 死锁恢复
void I2C_Bus_Recovery(I2C_HandleTypeDef *hi2c) {
    GPIO_InitTypeDef gpio = {0};

    // 1. 先关闭 I2C 外设
    HAL_I2C_DeInit(hi2c);

    // 2. 将 SCL 和 SDA 配置为 GPIO 开漏输出
    gpio.Mode = GPIO_MODE_OUTPUT_OD;
    gpio.Pull = GPIO_PULLUP;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;

    gpio.Pin = GPIO_PIN_6;  // SCL (PB6)
    HAL_GPIO_Init(GPIOB, &gpio);

    gpio.Pin = GPIO_PIN_7;  // SDA (PB7)
    HAL_GPIO_Init(GPIOB, &gpio);

    // 3. 在 SCL 上发送 9 个时钟脉冲
    // 原理: 从机每收到一个 SCL 脉冲，就会释放 SDA 一个 bit
    // 连续 9 个脉冲后可以释放所有等待状态的从机
    for (int i = 0; i < 9; i++) {
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_6, GPIO_PIN_RESET);  // SCL=0
        HAL_Delay(1);
        HAL_GPIO_WritePin(GPIOB, GPIO_PIN_6, GPIO_PIN_SET);    // SCL=1
        HAL_Delay(1);
    }

    // 4. 发送 STOP 条件
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_6, GPIO_PIN_RESET);  // SCL=0
    HAL_Delay(1);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_7, GPIO_PIN_RESET);  // SDA=0
    HAL_Delay(1);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_6, GPIO_PIN_SET);    // SCL=1
    HAL_Delay(1);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_7, GPIO_PIN_SET);    // SDA=1 (STOP)

    // 5. 重新初始化 I2C
    MX_I2C1_Init();  // 或 HAL_I2C_Init(hi2c)
}
```

### 故障 2: 上升沿过慢

```
现象: 通信不稳定，速度越高越容易失败。
排查: 示波器测上升时间 (10%→90%)。
标准: Fast Mode (400kHz) 要求 tr < 300ns。
原因: R_pullup × C_bus = RC 时间常数太大。

解决:
  1. 减小上拉电阻 (但不能小于 I2C 规范的最小值)
  2. 减少总线上的器件数量 (每个器件增加 5-10pF 电容)
  3. 缩短 PCB 走线 (减少分布电容)
```

### 故障 3: F1 系列 I2C 的 EV7/EV7_1 问题

```
STM32F1 的 I2C 有已知硬件 Bug:
- 在主机接收模式下，当收到最后一个字节时，必须在收到 RXNE (EV7) 后
  1 个周期内设置 STOP 和 ADDR 清零。
- 如果错过这个窗口 → 无法生成 STOP 条件 → 总线卡死。

现代方案: 使用 F4/G4/H7 等较新系列 (F1 的 I2C 问题无法软件完全修复)
```

---

## 4. I2C 死锁恢复

```c
// RTOS 环境下 I2C 操作的互斥保护
static SemaphoreHandle_t i2c_mutex;

void I2C_Init_With_Mutex(void) {
    i2c_mutex = xSemaphoreCreateMutex();
    MX_I2C1_Init();
}

HAL_StatusTypeDef I2C_Read_Protected(uint16_t DevAddress,
                                      uint8_t *pData, uint16_t Size,
                                      uint32_t Timeout) {
    HAL_StatusTypeDef status;
    if (xSemaphoreTake(i2c_mutex, pdMS_TO_TICKS(Timeout)) != pdTRUE) {
        return HAL_TIMEOUT;
    }

    status = HAL_I2C_Master_Receive(&hi2c1, DevAddress, pData, Size, Timeout);

    if (status != HAL_OK) {
        // 通信错误: 尝试恢复总线
        I2C_Bus_Recovery(&hi2c1);
    }

    xSemaphoreGive(i2c_mutex);
    return status;
}
```

---

## 5. 参考文档

1. NXP UM10204: I2C-bus specification
2. "AN2824: STM32F10xxx I2C optimized examples"
3. "I2C Bus Recovery" — ST Community Wiki
4. 逻辑分析仪 I2C 解码教程 — Saleae/PulseView 用户手册
