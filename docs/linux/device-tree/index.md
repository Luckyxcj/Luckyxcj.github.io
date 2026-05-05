# 设备树开发 (Device Tree)

> **文档说明**：本文档基于 devicetree.org 规范、Linux 内核 devicetree 文档及嵌入式平台设备树开发经验整理。

---

## 目录

1. [设备树基础](#1-设备树基础)
2. [DTS 语法详解](#2-dts-语法详解)
3. [常用节点与属性](#3-常用节点与属性)
4. [Device Tree Overlay](#4-device-tree-overlay)
5. [调试方法](#5-调试方法)
6. [常见问题](#6-常见问题)

---

## 1. 设备树基础

设备树 (Device Tree) 是描述硬件拓扑的数据结构，Linux 内核在启动时解析 DTB 来获知平台硬件。

```
为什么需要设备树:

  x86 (ACPI/BIOS):          ARM (Device Tree):
  ┌────────────┐            ┌────────────┐
  │ BIOS 枚举硬件│            │ DTB (预编译) │
  │ 自动发现设备 │            │ 静态描述硬件 │
  └────────────┘            └────────────┘
  硬件即插即用               硬件由 DTS 描述

  设备树好处:
  - 同一内核镜像 + 不同 DTB → 支持不同硬件
  - 硬件描述与驱动代码分离
  - 社区共享 (dts 在 arch/arm/boot/dts/ 中维护)
```

```
从 DTS 到硬件:

  .dts (源文件)  →  dtc 编译  →  .dtb (二进制)  →  bootloader 加载  →  内核解析
      │                        │
   .dtsi (头文件, 包含)         .dtbo (Overlay, 运行时叠加)
   SoC 级 (.dtsi)
   Board 级 (.dts)
```

---

## 2. DTS 语法详解

```dts
// ===== 基本语法 =====

/dts-v1/;

// 包含 SoC 级和设备级 .dtsi
#include "stm32mp157.dtsi"

/ {
    // 根节点
    model = "My STM32MP157 Board";
    compatible = "st,stm32mp157c-dk2", "st,stm32mp157";
    #address-cells = <1>;     // 子节点 reg 的地址单元数
    #size-cells = <1>;        // 子节点 reg 的大小单元数

    // CPU 节点
    cpus {
        #address-cells = <1>;
        #size-cells = <0>;

        cpu0: cpu@0 {
            compatible = "arm,cortex-a7";
            device_type = "cpu";
            reg = <0>;        // CPU ID
            clock-frequency = <650000000>;
        };

        cpu1: cpu@1 {
            compatible = "arm,cortex-a7";
            reg = <1>;
        };
    };

    // 内存节点 (通常由 bootloader 填充)
    memory@c0000000 {
        device_type = "memory";
        reg = <0xc0000000 0x20000000>;  // 起始 0xC0000000, 大小 512MB
    };

    // 总线上的外设
    soc {
        #address-cells = <1>;
        #size-cells = <1>;
        compatible = "simple-bus";
        ranges;

        // UART 控制器
        usart1: serial@40011000 {
            compatible = "st,stm32h7-uart";
            reg = <0x40011000 0x400>;     // 基址 + 大小
            interrupts = <37>;             // 中断号
            clocks = <&rcc USART1_K>;
            status = "okay";               // 使能
        };

        // I2C 控制器
        i2c1: i2c@40012000 {
            compatible = "st,stm32mp1-i2c";
            reg = <0x40012000 0x400>;
            interrupts = <31>, <32>;       // 事件中断 + 错误中断
            clock-frequency = <400000>;    // 400kHz
            status = "okay";

            // I2C 总线上的从设备
            eeprom@50 {
                compatible = "atmel,24c02";
                reg = <0x50>;
                pagesize = <16>;
            };
        };
    };
};
```

### 关键概念

```dts
// 1. 标签 (Label) 与引用 (&)
led_pin: pin@1 {           // led_pin 是标签
    pins = "PA13";
};

&led_pin {                  // 引用并覆盖/追加属性
    bias-pull-up;
};

// 2. status 属性
status = "okay";            // 设备启用
status = "disabled";        // 设备禁用 (但硬件存在)
status = "reserved";        // 保留但不使用
status = "fail";            // 检测到故障

// 3. phandle 引用 (指针)
clocks = <&rcc 5>;         // 引用 rcc 节点的第 5 个时钟
pinctrl-0 = <&uart4_pins>; // 引用 pinmux 配置

// 4. 中断系统
interrupt-parent = <&nvic>; // 中断控制器
interrupts = <37 0>;        // 中断编号 + 触发方式
                             //  0: 无 / 1: 上升沿 / 2: 下降沿
                             //  3: 双边沿 / 4: 高电平 / 8: 低电平
```

---

## 3. 常用节点与属性

### GPIO

```dts
// GPIO 在设备树中的使用
my_device {
    compatible = "my-company,my-device";

    enable-gpios = <&gpioa 5 GPIO_ACTIVE_HIGH>;   // PA5, 高有效
    reset-gpios = <&gpiob 0 GPIO_ACTIVE_LOW>;     // PB0, 低有效
    irq-gpios   = <&gpioc 13 GPIO_ACTIVE_LOW>;    // 用作中断

    // GPIO 命名 (推荐):
    // <name>-gpios = <&gpioX N flags>;
};
```

### Pinmux (引脚复用)

```dts
// STM32MP1 Pinctrl 示例
&pinctrl {
    uart4_pins: uart4-pins {
        pins1 {
            pinmux = <STM32_PINMUX('G', 11, AF6)>,  // TX
                     <STM32_PINMUX('B', 2, AF8)>;   // RX
            bias-disable;
            drive-push-pull;
            slew-rate = <0>;
        };
    };
};

&uart4 {
    pinctrl-names = "default", "sleep";
    pinctrl-0 = <&uart4_pins>;    // 默认状态
    pinctrl-1 = <&uart4_sleep_pins>;  // 睡眠状态 (低功耗)
    status = "okay";
};
```

### 常用属性速查

| 属性 | 说明 | 示例 |
|------|------|------|
| `compatible` | 驱动匹配字符串 | `"st,stm32mp1-i2c"` |
| `reg` | 寄存器地址和大小 | `<0x40012000 0x400>` |
| `interrupts` | 中断 | `<37>` |
| `clocks` | 时钟 | `<&rcc 5>` |
| `dmas` | DMA 通道 | `<&dma1 5 0x400>` |
| `pinctrl-0` | Pinmux 配置 | `<&uart4_pins>` |
| `status` | 使能状态 | `"okay"` |

---

## 4. Device Tree Overlay

Overlay 允许在运行时动态修改设备树，无需重新编译内核，常用于 FPGA 动态外设或 BeagleBone Capes。

```dts
// 设备树 Overlay 示例: 添加一个 SPI 设备
/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&spi1>;  // 目标节点 (要修改的节点)
        __overlay__ {
            #address-cells = <1>;
            #size-cells = <0>;
            status = "okay";

            myspi: device@0 {
                compatible = "my-company,my-spi-device";
                reg = <0>;
                spi-max-frequency = <10000000>;
            };
        };
    };
};
```

```bash
# 编译 Overlay
dtc -@ -I dts -O dtb -o my-overlay.dtbo my-overlay.dts

# 加载 Overlay (运行时)
# 方法 1: 通过 U-Boot
# fdt apply my-overlay.dtbo
# boot

# 方法 2: 通过 Linux configfs (内核 4.4+)
mkdir /sys/kernel/config/device-tree/overlays/my_overlay
cat my-overlay.dtbo > /sys/kernel/config/device-tree/overlays/my_overlay/dtbo

# 方法 3: U-Boot 环境变量 bootcmd
# setenv bootcmd "fdt addr ${fdt_addr}; fdt resize; fdt apply ${loadaddr}; bootz ..."
```

---

## 5. 调试方法

```bash
# 1. 查看运行中的设备树
ls /sys/firmware/devicetree/base/          # 内核 4.x+
ls /proc/device-tree/                      # 旧内核

# 2. 查看特定节点属性
cat /proc/device-tree/soc/serial@40011000/compatible
# 输出: st,stm32h7-uart

# 3. 检查设备是否被绑定到驱动
ls /sys/bus/platform/devices/   # platform 设备
ls /sys/bus/i2c/devices/        # I2C 设备
ls /sys/bus/spi/devices/        # SPI 设备

# 4. 检查驱动 probe 状态
cat /sys/bus/platform/drivers/xxx/driver/bind
cat /sys/bus/platform/drivers/xxx/driver/unbind
dmesg | grep -i "probe"

# 5. dtc 验证语法
dtc -I dts -O dtb -o /dev/null myboard.dts  # 只检查语法
```

---

## 6. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 驱动不 probe (设备无响应) | `compatible` 字符串不匹配 | 确认驱动和 dts 中的 compatible 一致 |
| 2 | 设备树编译错误 `syntax error` | 分号/括号缺失 | `dtc -I dts -O dtb -o /dev/null xxx.dts` 检查 |
| 3 | 新增 pinmux 不生效 | 未使能 pinctrl 节点 | 确认 `pinctrl-0` 和 `pinctrl-names` 配置 |
| 4 | GPIO 方向/电平不对 | `GPIO_ACTIVE_LOW` 与实际电路不匹配 | 检查硬件原理图; 调整 flags |
| 5 | Overlay 加载失败 | 内核 CONFIG_OF_OVERLAY 未使能 | `CONFIG_OF_OVERLAY=y` 重新编译 |
| 6 | DTB 太大超 bootloader 内存 | phandle 过多或 Overlay 叠加过多 | 精简 dts; 合并 Overlay |
| 7 | 中断编号不对 | SoC 中断映射复杂 | 参考 SoC reference manual + dtsi 文件 |

---

## 7. 参考文档

1. Device Tree Specification v0.4: https://www.devicetree.org/specifications/
2. Linux Devicetree 文档: `Documentation/devicetree/` (内核源码树内)
3. "Device Tree for Dummies" — Thomas Petazzoni (Bootlin): https://bootlin.com/pub/conferences/
4. "Solving Device Tree Issues" — ELCE 报告 by Frank Rowand
5. STM32MP1 Devicetree 文档: https://wiki.st.com/stm32mpu/wiki/Device_tree
