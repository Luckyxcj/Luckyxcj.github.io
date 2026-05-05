# 链接脚本详解

> **文档说明**：本文档基于 GNU ld 链接器手册及 STM32 标准链接脚本范例整理。

---

## 目录

1. [链接脚本的作用](#1-链接脚本的作用)
2. [基础语法与关键指令](#2-基础语法与关键指令)
3. [内存映射定义](#3-内存映射定义)
4. [段布局详解](#4-段布局详解)
5. [自定义段的添加与使用](#5-自定义段的添加与使用)
6. [调试链接问题](#6-调试链接问题)
7. [参考文档](#7-参考文档)

---

## 1. 链接脚本的作用

链接脚本 (Linker Script, .ld 文件) 告诉链接器：
- 芯片的内存布局 (Flash 在哪、SRAM 在哪、大小是多少)
- 各个段应该放在哪里 (.text 去 Flash, .data 去 SRAM, .bss 去 SRAM)
- 程序的入口点是什么
- 栈和堆的大小

---

## 2. 基础语法与关键指令

```ld
/* ENTRY: 指定程序的入口符号 (不是 main, 是 Reset_Handler!) */
ENTRY(Reset_Handler)

/* MEMORY: 定义物理内存区域 */
MEMORY
{
  FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 512K
  RAM   (rwx): ORIGIN = 0x20000000, LENGTH = 128K
}

/* 符号 = 地址标记 (不占用内存, 仅标记位置) */
_sidata = LOADADDR(.data);  /* .data 在 Flash 中的加载地址 */
```

---

## 3. 内存映射定义

```ld
/* STM32F407VGT6 链接脚本的内存定义 */
MEMORY
{
  /* FLASH: 读+执行, 起始 0x08000000, 大小 1MB */
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1024K

  /* CCM SRAM: 读+写+执行, 起始 0x10000000, 大小 64KB */
  /* CCM 是内核紧耦合内存，只能被 CPU 访问，不能用于 DMA */
  CCMRAM (rwx) : ORIGIN = 0x10000000, LENGTH = 64K

  /* 主 SRAM: 读+写+执行, 起始 0x20000000, 大小 128KB */
  RAM (rwx)   : ORIGIN = 0x20000000, LENGTH = 128K

  /* 备用 SRAM: 在备份域中, 4KB (需要使能 BKPSRAM 时钟) */
  BKPSRAM (rw) : ORIGIN = 0x40024000, LENGTH = 4K
}
```

::: tip CCM SRAM 的陷阱
CCM (Core Coupled Memory) 是内核专用的紧耦合 SRAM。它的优点是 0 等待、不与 DMA 竞争总线。但**DMA 不能访问 CCM**，如果 DMA 传输的源/目标地址在 CCM 中，数据会静默失败 (DMA 传输全零)。通常把 RTOS 的核心数据结构 (任务栈、就绪列表) 放在 CCM。
:::

---

## 4. 段布局详解

### 4.1 完整链接脚本剖析

```ld
/* ====== 栈和堆大小 ====== */
_Min_Heap_Size  = 0x200;   /* 512 bytes */
_Min_Stack_Size = 0x400;   /* 1024 bytes */

/* ====== SECTIONS: 定义所有输出段 ====== */
SECTIONS
{
  /* ---- .isr_vector: 中断向量表, 必须在 Flash 最前面 ---- */
  .isr_vector :
  {
    . = ALIGN(4);
    KEEP(*(.isr_vector))     /* KEEP = 即使未引用也保留 */
    . = ALIGN(4);
  } >FLASH

  /* ---- .text: 程序代码 ---- */
  .text :
  {
    . = ALIGN(4);
    *(.text)                  /* 所有 .text 段 */
    *(.text*)                 /* 所有 .text.xxx 段 (如 .text.foo) */
    *(.glue_7)                /* ARM/Thumb 互调用的胶水代码 */
    *(.glue_7t)
    *(.rodata)                /* 只读数据 (const 变量, 字符串常量) */
    *(.rodata*)
    . = ALIGN(4);
    _etext = .;               /* 代码段结束 */
  } >FLASH

  /* ---- .data: 已初始化的可读写数据 ---- */
  _sidata = LOADADDR(.data);  /* Flash 中的加载地址 (存放初始值) */

  .data :
  {
    . = ALIGN(4);
    _sdata = .;               /* data 段在 SRAM 中的起始地址 */
    *(.data)                  /* 已初始化的全局/静态变量 */
    *(.data*)
    . = ALIGN(4);
    _edata = .;               /* data 段在 SRAM 中的结束地址 */
  } >RAM AT> FLASH            /* VMA = RAM, LMA = Flash */

  /* ---- .bss: 未初始化/零初始化的可读写数据 ---- */
  .bss :
  {
    . = ALIGN(4);
    _sbss = .;
    *(.bss)
    *(.bss*)
    *(COMMON)                  /* 未分类的公共符号 */
    . = ALIGN(4);
    _ebss = .;
  } >RAM

  /* ---- ._user_heap_stack: 堆和栈 ---- */
  ._user_heap_stack :
  {
    . = ALIGN(8);
    PROVIDE(end = .);         /* 堆的起始位置 */
    PROVIDE(_end = .);
    . = . + _Min_Heap_Size;
    . = . + _Min_Stack_Size;
    . = ALIGN(8);
  } >RAM
}
```

### 4.2 段与 C 变量的对应关系

```c
// 以下变量各自落入哪个段？

const char version[] = "v1.0";     // .rodata (只读常量区，在 Flash)
const int lut[256] = {1,2,3,...};  // .rodata (在 Flash)
int global_init = 42;              // .data   (在 SRAM, 初始值在 Flash)
static int file_scope = 100;       // .data
int global_zero;                   // .bss    (在 SRAM, 上电后被清零)
static int local_zero;             // .bss
char *message = "Hello";           // .data (指针在 SRAM, "Hello" 在 .rodata)
```

---

## 5. 自定义段的添加与使用

### 5.1 将特定数据放入自定义段

```c
// 方法1: 使用 __attribute__((section("...")))
// 将 DMA 缓冲区放在指定段 (避免 Cache 一致性问题的新手做法)
uint8_t dma_tx_buffer[1024] __attribute__((section(".dma_buffers"))) __attribute__((aligned(32)));

// 方法2: 将关键函数放在 RAM 中以加速执行
// (Flash 有等待周期, SRAM 0 等待)
__attribute__((section(".ramfunc"))) __attribute__((long_call))
void Time_Critical_ISR(void) {
    // 此函数将从 Flash 加载到 SRAM 中执行
}
```

对应的链接脚本修改：

```ld
SECTIONS
{
  /* ... 其他段定义 ... */

  /* DMA 缓冲区段: 32 字节对齐，放在 SRAM */
  .dma_buffers (NOLOAD) :
  {
    . = ALIGN(32);
    *(.dma_buffers)
    *(.dma_buffers*)
    . = ALIGN(32);
  } >RAM

  /* RAM 函数段: 加载地址在 Flash, 运行地址在 SRAM */
  .ramfunc :
  {
    . = ALIGN(4);
    _sramfunc = .;
    *(.ramfunc)
    *(.ramfunc*)
    . = ALIGN(4);
    _eramfunc = .;
  } >RAM AT> FLASH
  _siramfunc = LOADADDR(.ramfunc);
}
```

然后在启动代码中添加 RAM 函数的搬运：

```c
// 在 SystemInit() 中搬运 .ramfunc 段
extern uint32_t _sramfunc, _eramfunc, _siramfunc;

void Load_RamFunctions(void) {
    uint32_t *src = &_siramfunc;
    uint32_t *dst = &_sramfunc;
    uint32_t size = &_eramfunc - &_sramfunc;

    for (uint32_t i = 0; i < size / 4; i++) {
        dst[i] = src[i];
    }
}
```

---

## 6. 调试链接问题

### 6.1 常用分析命令

```bash
# 查看所有段的布局
arm-none-eabi-objdump -h firmware.elf

# 查看所有符号及其地址
arm-none-eabi-nm firmware.elf | sort

# 按大小排序 (查找谁在吃 Flash/SRAM)
arm-none-eabi-nm --size-sort -S firmware.elf | tail -20

# 生成详细的 Map 文件 (链接器会报告内存使用详情)
arm-none-eabi-gcc ... -Wl,-Map=output.map

# 查看某个符号属于哪个段
arm-none-eabi-objdump -t firmware.elf | grep my_variable
```

### 6.2 Map 文件关键信息

```
Memory Configuration         ← 你的 MEMORY 区域定义

Linker script and memory map ← 每个 .o 文件占用的地址

Cross Reference Table        ← 符号的引用关系

Symbol Table                 ← 所有符号 (函数名/变量名) 及其地址
```

### 6.3 常见链接错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `section .text will not fit in region FLASH` | Flash 超出 | 优化代码、减小库、或换更大 Flash 的芯片 |
| `section .bss will not fit in region RAM` | SRAM 不足 | 减小缓冲区、使用动态分配、或优化全局变量 |
| `undefined reference to 'xxx'` | 缺少函数实现或库链接 | 检查 Makefile 中的库路径和 -l 参数 |
| `multiple definition of 'xxx'` | 同一符号在多个 .o 中定义 | 用 static 限制作用域或改实现 |

---

## 7. 参考文档

1. GNU Linker (ld) Manual: https://sourceware.org/binutils/docs/ld/
2. STM32CubeIDE Linker Script Guide (内置帮助)
3. ARM IHI 0044: ELF for the ARM Architecture
4. "Linker Scripts in STM32" — ST Community Wiki
5. GNU Binary Utilities (binutils) Documentation
