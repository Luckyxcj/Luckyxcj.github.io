# 串口调试助手

> **文档说明**：本文档基于各串口工具文档及嵌入式项目调试经验整理。

---

## 目录

1. [串口工具概览](#1-串口工具概览)
2. [各平台推荐工具](#2-各平台推荐工具)
3. [串口转 USB 适配器选择](#3-串口转-usb-适配器选择)
4. [高级串口调试技巧](#4-高级串口调试技巧)
5. [常见串口问题排查](#5-常见串口问题排查)
6. [参考文档](#6-参考文档)

---

## 1. 串口工具概览

串口 (UART/RS-232/RS-485) 是嵌入式开发中最基础、使用最频繁的调试接口。一个好的串口工具可以显著提高调试效率。

### 关键功能需求

- 多种波特率支持 (最高到 4 Mbps)
- 十六进制 + ASCII 双栏显示
- 定时/定长发送 (如 10ms 间隔发送测试帧)
- 日志保存到文件
- 自定义波特率 (非标准: 如 921600, 2000000)
- CRC 计算/校验 (在线校验帧数据)
- Modbus 协议显示

---

## 2. 各平台推荐工具

### 2.1 桌面串口工具对比

| 工具 | 平台 | 价格 | 特色 |
|------|------|------|------|
| **SSCOM** | Windows | 免费 | 经典国产，中文界面，简单够用 |
| **MobaXterm** | Windows | 免费版 | 全能终端(SSH+串口+FTP+Shell) |
| **SerialTool** | Windows/Mac/Linux | 免费 | 现代化 UI, 支持数据绘图 |
| **PuTTY** | Windows/Linux | 免费 | 最经典的终端，但界面古老 |
| **minicom** | Linux | 免费 | Linux 命令行串口工具 |
| **picocom** | Linux | 免费 | minicom 的轻量替代 |
| **CoolTerm** | Windows/Mac/Linux | 免费 | 跨平台，十六进制显示好 |
| **UartAssist (串口调试助手)** | Windows | 免费 | 国产功能强大，CRC/Modbus 支持 |

### 2.2 Linux 命令行串口

```bash
# 1. 列出所有串口
ls /dev/ttyUSB* /dev/ttyACM* /dev/ttyS*

# 2. 查看串口权限
ls -la /dev/ttyUSB0

# 3. 添加用户到 dialout 组 (解决权限问题)
sudo usermod -a -G dialout $USER
# 重新登录后生效

# 4. picocom (最简洁的串口终端)
picocom -b 115200 /dev/ttyUSB0
# 退出: Ctrl+A, Ctrl+X

# 5. 保存串口日志
picocom -b 115200 --logfile serial.log /dev/ttyUSB0

# 6. screen (直接在终端收发串口数据)
screen /dev/ttyUSB0 115200
# 退出: Ctrl+A, k, y

# 7. 直接读写串口 (脚本调试)
echo "AT\r\n" > /dev/ttyUSB0          # 发送 AT 指令
cat /dev/ttyUSB0                      # 读取串口数据
```

### 2.3 Python 串口调试脚本

```python
# serial_debug.py — 快速串口调试脚本
import serial
import time

ser = serial.Serial(
    port='COM3',           # Windows: 'COM3'; Linux: '/dev/ttyUSB0'
    baudrate=115200,
    bytesize=8,
    parity='N',
    stopbits=1,
    timeout=1
)

# 发送命令
ser.write(b'AT\r\n')
time.sleep(0.1)

# 读取响应
response = ser.read(ser.in_waiting)
print(f"Response: {response.hex()}")  # 十六进制
print(f"Response: {response.decode('utf-8', errors='replace')}")  # ASCII

# 持续监听
while True:
    if ser.in_waiting:
        data = ser.read(ser.in_waiting)
        print(f"[{time.strftime('%H:%M:%S')}] {data.hex()}")
    time.sleep(0.01)
```

---

## 3. 串口转 USB 适配器选择

| 芯片 | 最大波特率 | 驱动 | 稳定性 | 价格 |
|------|-----------|------|--------|------|
| **CP2102** | 1 Mbps | 免驱 (Win10+) | 极好 | ¥10-15 |
| **CP2104** | 2 Mbps | 免驱 | 极好 | ¥15-20 |
| **CH340G** | 2 Mbps | 需安装驱动 | 好 | ¥3-5 |
| **CH343** | 6 Mbps | 需安装驱动 | 好 | ¥5-8 |
| **FT232RL** | 3 Mbps | 免驱 | 极好 (工业级) | ¥30-50 |
| **PL2303** | 1.2 Mbps | 需安装驱动 | 一般 | ¥5 |

::: tip 串口适配器建议
- 个人学习: CH340G 模块 (¥3-5, 淘宝大量)
- 日常开发: CP2102 模块 (¥10-15, 最稳定)
- 工业/产品: FT232RL 模块 (¥30-50, 信号质量最好)
- 同时建议拥有一个 **USB 隔离器** (¥30-50)，防止目标板故障烧坏 PC USB 口
:::

---

## 4. 高级串口调试技巧

### 4.1 自定义波特率调试

```c
// 某些场景需要非标准波特率 (如某些传感器 250000 bps)
// STM32 USART 可以通过配置 BRR 寄存器实现任意波特率

// USARTDIV = Fck / (16 × BaudRate)
// 例如 Fck=84MHz, BaudRate=250000
// USARTDIV = 84,000,000 / (16 × 250,000) = 21.0
// DIV_Mantissa=21, DIV_Fraction=0
```

### 4.2 串口日志分级

```c
// 宏定义实现自动日志分级和开关
#define LOG_LEVEL_NONE  0
#define LOG_LEVEL_ERROR 1
#define LOG_LEVEL_WARN  2
#define LOG_LEVEL_INFO  3
#define LOG_LEVEL_DEBUG 4

#define CURRENT_LOG_LEVEL LOG_LEVEL_DEBUG

#if CURRENT_LOG_LEVEL >= LOG_LEVEL_ERROR
#define LOG_E(fmt, ...) printf("[E] " fmt "\r\n", ##__VA_ARGS__)
#else
#define LOG_E(...)
#endif

#if CURRENT_LOG_LEVEL >= LOG_LEVEL_INFO
#define LOG_I(fmt, ...) printf("[I] " fmt "\r\n", ##__VA_ARGS__)
#else
#define LOG_I(...)
#endif

#if CURRENT_LOG_LEVEL >= LOG_LEVEL_DEBUG
#define LOG_D(fmt, ...) printf("[D] %s:%d " fmt "\r\n", __func__, __LINE__, ##__VA_ARGS__)
#else
#define LOG_D(...)
#endif
```

### 4.3 时间戳自动添加

```c
// 在 RTOS 环境中，自动为每条日志添加时间戳
#include "cmsis_os.h"

int __io_putchar(int ch) {
    static uint8_t newline_flag = 1;
    if (newline_flag) {
        // 每条新行前加上时间戳
        uint32_t tick = xTaskGetTickCount();
        char ts_buf[32];
        snprintf(ts_buf, sizeof(ts_buf), "[%6lu] ", tick);
        for (char *p = ts_buf; *p; p++) {
            while (!(USART1->SR & USART_SR_TXE));
            USART1->DR = *p;
        }
        newline_flag = 0;
    }
    if (ch == '\n') newline_flag = 1;
    while (!(USART1->SR & USART_SR_TXE));
    USART1->DR = ch;
    return ch;
}
```

---

## 5. 常见串口问题排查

| # | 现象 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 串口输出乱码 | 波特率不匹配 | 检查 MCU 端的 PCLK 分频和 BRR 计算；用示波器测 TX 引脚的实际脉宽 |
| 2 | UART RX 收不到数据 | RX 引脚未配置为 AF 模式，或串口工具未连接 TX/RX 正确 | 检查 CubeMX 的 GPIO 配置；用跳线短接 TX-RX 做自发自收测试 |
| 3 | 串口助手断开重连后收不到数据 | 串口助手的 DTR/RTS 引脚变化触发了 MCU 复位 | 将目标板 NRST 引脚与串口的 DTR 断开；或在代码中忽略 DTR |
| 4 | CH340 在 Win10 上驱动有问题 | 驱动版本不匹配 | 去 wch.cn 下载最新驱动 |
| 5 | 串口数据漏字节 | 缓冲区不足或中断优先级低被其他 ISR 延迟 | 增大环形缓冲区；提高 UART ISR 优先级 |

---

## 6. 参考文档

1. SSCOM 串口调试助手: http://www.daxia.com/
2. MobaXterm: https://mobaxterm.mobatek.net/
3. CoolTerm: https://freeware.the-meiers.org/
4. picocom: https://github.com/npat-efault/picocom
5. WCH CH340 Driver: https://www.wch.cn/downloads/CH341SER_EXE.html
