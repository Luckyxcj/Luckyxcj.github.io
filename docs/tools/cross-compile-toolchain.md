# 交叉编译工具链

> **文档说明**：本文档基于 GNU ARM Embedded Toolchain (arm-none-eabi-gcc) 文档、ARM EABI 规范及 CMake/Make 工程经验整理。

---

## 目录

1. [交叉编译概述](#1-交叉编译概述)
2. [GNU ARM 工具链安装](#2-gnu-arm-工具链安装)
3. [编译器选项精讲](#3-编译器选项精讲)
4. [链接器选项精讲](#4-链接器选项精讲)
5. [Makefile 构建模板](#5-makefile-构建模板)
6. [常见编译问题](#6-常见编译问题)
7. [参考文档](#7-参考文档)

---

## 1. 交叉编译概述

交叉编译 (Cross-compilation) 是在一种平台上编译出在另一种平台上运行的程序。嵌入式系统的编译机（x86 PC）与目标机（ARM MCU）是不同架构的处理器，因此必须使用交叉编译器。

```
工具链三元组 (Toolchain Triplet):

arm-none-eabi-gcc
 │    │    │
 │    │    └── eabi: 嵌入式 ABI (没有 OS, bare-metal)
 │    └─────── none: 没有操作系统 (bare-metal)
 └──────────── arm: 目标架构 (ARM 32-bit)

对比: arm-linux-gnueabihf-gcc
        │    │      │
        │    │      └── hf: hard-float (硬件浮点 ABI)
        │    └───────── gnueabi: GNU/Linux + ELF ABI
        └────────────── arm: 目标架构 (用于 ARM Linux)
```

---

## 2. GNU ARM 工具链安装

### 2.1 Windows

```powershell
# 方法1: 下载 ARM 官方工具链
# https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain
# 解压后将 bin/ 目录添加到 PATH

# 方法2: 通过 STM32CubeIDE (自带工具链)
# 路径: C:\ST\STM32CubeIDE_1.xx\STM32CubeIDE\plugins\...\tools\gcc-arm-none-eabi\

# 验证安装
arm-none-eabi-gcc --version
```

### 2.2 Linux / macOS

```bash
# Ubuntu/Debian
sudo apt install gcc-arm-none-eabi binutils-arm-none-eabi

# macOS (Homebrew)
brew install arm-none-eabi-gcc

# 或下载 ARM 官方工具链手动安装
wget https://developer.arm.com/-/media/Files/downloads/gnu/...
tar -xjf gcc-arm-none-eabi-*.tar.bz2
export PATH=$PATH:/path/to/gcc-arm-none-eabi/bin
```

---

## 3. 编译器选项精讲

### 3.1 必知的编译选项

```makefile
# ====== CPU/FPU 相关 ======
# -mcpu=cortex-m4: 目标 CPU 内核 (影响指令集选择)
# -mthumb: 使用 Thumb-2 指令集 (Cortex-M 只支持 Thumb)
# -mfpu=fpv4-sp-d16: FPU 类型
#   fpv4-sp-d16 → F4 系列 (单精度, 16 个双字寄存器)
#   fpv5-d16    → F7 系列
#   fpv5-sp-d16 → H7 系列
# -mfloat-abi=hard: 使用硬件 FPU (通过 FPU 寄存器传浮点参数)

# ====== 优化相关 ======
# -Og: 调试优化 (平衡调试体验和性能)
# -O0: 不优化 (调试用, 代码最大最慢)
# -Os: 空间优化 (-O2 基础上减小代码尺寸)
# -O2: 标准优化 (大多数变量的生存期可追踪)
# -O3: 激进优化 (可能内联过多、向量化)
# -flto: 链接时优化 (Link-Time Optimization, 全程序优化)

# ====== 调试相关 ======
# -g: 生成调试信息 (DWARF 格式)
# -ggdb3: 生成最详细的 GDB 调试信息

# ====== 警告相关 ======
# -Wall: 大部分警告
# -Wextra: 额外的警告
# -Werror: 警告即错误
# -Wshadow: 变量名遮蔽警告
# -Wdouble-promotion: 隐式浮点升级警告

# ====== 标准相关 ======
# -std=gnu11: C11 标准 + GNU 扩展
# -std=c11: 纯 C11 标准
# -ffunction-sections -fdata-sections: 每个函数/变量单独的段 (配合 --gc-sections)
```

### 3.2 实际项目的 CFLAGS

```makefile
# 典型嵌入式项目的编译选项
CFLAGS  = -mcpu=cortex-m4
CFLAGS += -mthumb
CFLAGS += -mfpu=fpv4-sp-d16
CFLAGS += -mfloat-abi=hard
CFLAGS += -Og -g3
CFLAGS += -Wall -Wextra -Wshadow -Wdouble-promotion
CFLAGS += -ffunction-sections -fdata-sections
CFLAGS += -DSTM32F407xx -DUSE_HAL_DRIVER
CFLAGS += -I$(HAL_DIR)/Inc
```

---

## 4. 链接器选项精讲

### 4.1 关键 LDFLAGS

```makefile
# ====== 链接脚本 ======
# -T: 使用自定义链接脚本 (替代默认)
LDFLAGS += -T stm32f407vgtx_flash.ld

# ====== 死代码剔除 ======
# --gc-sections: 移除未被引用的函数/变量 (配合 -ffunction-sections -fdata-sections)
LDFLAGS += -Wl,--gc-sections

# ====== 使用 newlib-nano (优化 C 库大小) ======
LDFLAGS += --specs=nano.specs

# ====== 半主机 (Semihosting) ======
# 启用: --specs=rdimon.specs (支持 printf 通过调试器输出)
# 注意: semihosting 的 printf 会阻塞 CPU 直到被调试器处理!
# 不推荐在量产代码中使用

# ====== Map 文件 ======
# -Map: 生成链接 Map 文件 (查看内存使用、符号地址)
LDFLAGS += -Wl,-Map=$(TARGET).map

# ====== 输出格式 ======
LDFLAGS += -Wl,--cref          # 交叉引用表
LDFLAGS += -Wl,--print-memory-usage  # 打印内存使用摘要
```

### 4.2 链接脚本

```bash
# 查看默认的链接脚本
arm-none-eabi-ld --verbose

# 自定义链接脚本 (从 STM32CubeIDE 获取模板)
# 或自己编写 (参考本知识库 系统架构 → 链接脚本详解)
```

---

## 5. Makefile 构建模板

### 5.1 完整嵌入式项目 Makefile

```makefile
# ====== 项目配置 ======
TARGET = firmware
BUILD_DIR = build

# ====== 工具链 ======
CROSS = arm-none-eabi-
CC    = $(CROSS)gcc
CXX   = $(CROSS)g++
AS    = $(CROSS)gcc -x assembler-with-cpp
LD    = $(CROSS)ld
OBJCOPY = $(CROSS)objcopy
OBJDUMP = $(CROSS)objdump
SIZE    = $(CROSS)size

# ====== 芯片配置 ======
CPU = -mcpu=cortex-m4
FPU = -mfpu=fpv4-sp-d16
FLOAT-ABI = -mfloat-abi=hard
MCU = $(CPU) -mthumb $(FPU) $(FLOAT-ABI)

# ====== 源文件 ======
C_SOURCES = $(wildcard Src/*.c) $(wildcard Src/*/*.c)
ASM_SOURCES = $(wildcard startup/*.s)
OBJECTS = $(patsubst %.c, $(BUILD_DIR)/%.o, $(notdir $(C_SOURCES)))
OBJECTS += $(patsubst %.s, $(BUILD_DIR)/%.o, $(notdir $(ASM_SOURCES)))

# ====== 编译选项 ======
CFLAGS  = $(MCU)
CFLAGS += -Og -g3
CFLAGS += -Wall -Wextra
CFLAGS += -ffunction-sections -fdata-sections
CFLAGS += -DSTM32F407xx -DUSE_HAL_DRIVER
CFLAGS += -Icmsis -Ihal/Inc -ISrc

# ====== 链接选项 ======
LDSCRIPT = stm32f407vgtx_flash.ld
LDFLAGS  = $(MCU)
LDFLAGS += --specs=nano.specs
LDFLAGS += -T$(LDSCRIPT)
LDFLAGS += -Wl,-Map=$(BUILD_DIR)/$(TARGET).map,--cref,--gc-sections

# ====== 构建 ======
all: $(BUILD_DIR)/$(TARGET).elf $(BUILD_DIR)/$(TARGET).hex $(BUILD_DIR)/$(TARGET).bin

$(BUILD_DIR)/%.o: Src/%.c
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: startup/%.s
	@mkdir -p $(BUILD_DIR)
	$(AS) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/$(TARGET).elf: $(OBJECTS)
	$(CC) $(LDFLAGS) $^ -o $@
	$(SIZE) $@

$(BUILD_DIR)/%.hex: $(BUILD_DIR)/%.elf
	$(OBJCOPY) -O ihex $< $@

$(BUILD_DIR)/%.bin: $(BUILD_DIR)/%.elf
	$(OBJCOPY) -O binary $< $@

# ====== 烧录 ======
flash:
	openocd -f interface/stlink.cfg -f target/stm32f4x.cfg \
		-c "program $(BUILD_DIR)/$(TARGET).elf verify reset exit"

# ====== 调试 ======
debug:
	openocd -f interface/stlink.cfg -f target/stm32f4x.cfg &
	arm-none-eabi-gdb $(BUILD_DIR)/$(TARGET).elf -ex "target extended-remote :3333"

# ====== 清理 ======
clean:
	rm -rf $(BUILD_DIR)
```

### 5.2 CMake 构建模板

```cmake
cmake_minimum_required(VERSION 3.21)

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(TOOLCHAIN_PREFIX arm-none-eabi-)
set(CMAKE_C_COMPILER ${TOOLCHAIN_PREFIX}gcc)
set(CMAKE_CXX_COMPILER ${TOOLCHAIN_PREFIX}g++)
set(CMAKE_ASM_COMPILER ${TOOLCHAIN_PREFIX}gcc)
set(CMAKE_OBJCOPY ${TOOLCHAIN_PREFIX}objcopy)
set(CMAKE_SIZE ${TOOLCHAIN_PREFIX}size)

set(CMAKE_EXECUTABLE_SUFFIX ".elf")

set(COMMON_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")
set(CMAKE_C_FLAGS "${COMMON_FLAGS} -Og -g3 -Wall -Wextra -ffunction-sections -fdata-sections")
set(CMAKE_EXE_LINKER_FLAGS "-T ${CMAKE_SOURCE_DIR}/stm32f407vgtx_flash.ld -Wl,--gc-sections -Wl,-Map=firmware.map --specs=nano.specs")

add_executable(firmware main.c startup.c)
```

---

## 6. 常见编译问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | `undefined reference to 'xxx'` | 链接时缺少 .o 或 .a 库 | 检查 Makefile 中的源文件是否全部加入 |
| 2 | `HardFault during startup` （优化后） | 编译器优化掉了看似无用的启动代码 | 启动文件中的关键代码加 `volatile` |
| 3 | `region FLASH overflowed by xxx bytes` | Flash 超了 | 用 `-Os` 替代 `-O2`；启用 LTO；检查链接脚本的 Flash 大小 |
| 4 | `incompatible floating point ABI` | FPU ABI 混合 (部分 .o 用 hard, 部分用 soft) | 全部统一为 `-mfloat-abi=hard` 或 `softfp` |
| 5 | 代码在 `-O0` 正常，`-O2` 异常 | 变量没加 `volatile`，优化器将其移除或重排 | ISR 与主循环共享的变量加 `volatile` |
| 6 | 浮点运算结果错误 | FPU 未启用 (CPACR 未配置) 或 ABI 不匹配 | 检查 SystemInit 中的 FPU 配置；统一 ABI |

---

## 7. 参考文档

1. GNU ARM Embedded Toolchain: https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain
2. GCC ARM Options: https://gcc.gnu.org/onlinedocs/gcc/ARM-Options.html
3. GNU Linker Manual: https://sourceware.org/binutils/docs/ld/
4. "Bare-metal C programming on ARM" — Vivonomicon Blog
5. STM32CubeIDE User Manual — 工具链配置章节
