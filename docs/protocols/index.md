# 通信协议

嵌入式常用通信协议栈与中间件。

---

## 目录

### [CAN 总线](./can/) ✅ 已完善
物理层、帧格式、错误处理、位定时 — [CAN 网络基础](./can/basics)

STM32 bxCAN/FDCAN 指南、滤波配置、Ring Buffer — [STM32 CAN 指南](./can/stm32)

Bus-Off 诊断、波形分析、工具推荐 — [CAN 故障排查](./can/troubleshooting)

### [Modbus 协议](./modbus/)
Modbus RTU/TCP 帧结构、CRC 校验、FreeModbus 移植到 STM32

### [MQTT 物联网协议](./mqtt/)
发布-订阅模式、QoS 0/1/2、ESP32 MQTT 实战、Mosquitto Broker 部署

### [BLE 低功耗蓝牙](./ble/)
GATT 服务架构、nRF52/ESP32 BLE 开发、MTU/PHY 优化

### [LwIP 网络协议栈](./lwip/)
TCP/UDP Socket API、STM32 Ethernet 集成、网络性能优化

### [USB 协议栈](./usb/)
CDC/HID/MSC 设备类、STM32 USB Device/Host 开发、描述符解析

### [SPI / I2C / UART 协议对比](./spi-i2c-uart/)
三者的协议层对比、电平转换方案、多主仲裁、速率距离权衡
