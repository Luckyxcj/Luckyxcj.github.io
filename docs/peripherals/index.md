# 外设驱动

嵌入式 MCU 外设驱动详解，涵盖 GPIO、ADC/DAC、PWM、Timer、DMA、I2C、SPI、UART 等常用外设的配置与实战。

---

## 目录

### [GPIO 通用输入输出](./gpio/)
八种 GPIO 模式、推挽/开漏输出选择、速度与 EMI 权衡、BSRR 原子操作

- [GPIO 高级应用](./gpio/advanced) — EXTI 中断、位带操作、5V 容忍、低功耗 GPIO 处理

### [UART 通用异步收发](./uart/)
波特率计算与误差分析、HAL 库配置、中断接收环形缓冲区

- [DMA + 空闲中断实战](./uart/dma-uart) — 不定长帧接收、双缓冲区 Ping-Pong

### [I2C 总线](./i2c/)
协议基础与总线拓扑、EEPROM/传感器读写、多主模式

- [I2C 故障排查](./i2c/troubleshooting) — 总线死锁恢复、上升沿分析、I2C 地址扫描器

### [SPI 串行外设接口](./spi/)
四种工作模式 (CPOL/CPHA)、SPI Flash 实战、高速通信与信号完整性

### [ADC / DAC 模数数模转换](./adc-dac/)
12-bit ADC 精度优化、DMA 连续多通道采集、过采样与滤波、DAC 波形生成

### [PWM 脉宽调制](./pwm/)
占空比与频率计算、互补输出+死区、舵机/电机控制实战

### [定时器](./timer/)
基本/通用/高级定时器对比、编码器模式、输入捕获测频

### [DMA 直接存储器访问](./dma/)
双 DMA 控制器架构、循环/乒乓模式、Cache 一致性问题 (H7/F7)
