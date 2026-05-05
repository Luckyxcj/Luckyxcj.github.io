# 自定义 Bootloader 设计

> **文档说明**：本文档基于 ST AN2606 (Bootloader 协议)、开源 MCUBoot 项目及 IAP 实践经验整理。

---

## 目录

1. [Bootloader 是什么](#1-bootloader-是什么)
2. [Flash 分区设计](#2-flash-分区设计)
3. [跳转逻辑详解](#3-跳转逻辑详解)
4. [通信协议设计](#4-通信协议设计)
5. [安全与校验](#5-安全与校验)
6. [完整代码实现](#6-完整代码实现)
7. [常见问题与调试](#7-常见问题与调试)
8. [参考文档](#8-参考文档)

---

## 1. Bootloader 是什么

Bootloader 是固化在 Flash 起始地址的一段特殊程序，负责：
1. 检查是否有新固件需要更新
2. 接收新固件 (通过 UART/USB/CAN/SD卡等)
3. 将新固件写入指定的 Flash 区域
4. 校验固件完整性 (CRC/SHA256/签名验证)
5. 跳转到应用程序 (Application)

```
Flash 布局 (典型双分区):

 0x0800 0000 ┌─────────────┐
             │ Bootloader   │  32-64KB (不更新自身，或通过独立机制更新)
 0x0800 8000 ├─────────────┤
             │ App V1       │  主应用 (运行区)
 0x0804 0000 ├─────────────┤
             │ App V2       │  新固件 (下载区, OTA 时会用到)
 0x0807 8000 ├─────────────┤
             │ Config/EEPROM│  配置参数 (器件序列号, 校准数据, OTA 标志)
 0x0808 0000 └─────────────┘
```

---

## 2. Flash 分区设计

### 2.1 链接脚本修改

**Bootloader 的链接脚本 (bootloader.ld)**:

```ld
MEMORY
{
  FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K    /* Bootloader 64KB */
  RAM   (rwx): ORIGIN = 0x20000000, LENGTH = 128K
}
```

**Application 的链接脚本 (app.ld)**:

```ld
MEMORY
{
  FLASH (rx) : ORIGIN = 0x08010000, LENGTH = 448K   /* App 从 64KB 开始 */
  RAM   (rwx): ORIGIN = 0x20000000, LENGTH = 128K
}
```

### 2.2 App 的 VTOR 重映射

```c
// 在 SystemInit() 中或 main() 的第一行:
SCB->VTOR = 0x08010000;  // 向量表偏移到 App 的起始位置
```

---

## 3. 跳转逻辑详解

Bootloader → Application 的跳转是嵌入式开发中最需要仔细处理的环节之一。

```c
// ==========================================
// Bootloader 跳转到 Application 的完整实现
// ==========================================

typedef void (*pFunction)(void);  // 函数指针类型
pFunction JumpToApplication;

void Bootloader_JumpToApp(uint32_t app_addr) {
    uint32_t app_sp;
    uint32_t app_reset_handler;

    // ========== 1. 读 App 的向量表 ==========
    // 向量表第一项 (偏移 0x00) = 初始栈指针 MSP
    app_sp = *((volatile uint32_t *)app_addr);
    // 向量表第二项 (偏移 0x04) = Reset_Handler 地址
    app_reset_handler = *((volatile uint32_t *)(app_addr + 4));

    // ========== 2. 基本校验 ==========
    // 检查栈指针是否在 RAM 范围内

    if ((app_sp < 0x20000000) || (app_sp > (0x20000000 + 128 * 1024))) {
        // 栈地址不合法，App 可能不存在或损坏
        return;
    }

    // ========== 3. 关闭所有中断 ==========
    __disable_irq();

    // ========== 4. 复位所有正在使用的外设 ==========
    // 这是最关键的一步！如果 Bootloader 使用了 USART/TIM/DMA，
    // 不关闭它们会干扰 App 的初始化
    HAL_RCC_DeInit();          // 复位所有时钟到默认值
    HAL_DeInit();               // 复位 HAL 全局状态
    SysTick->CTRL = 0;         // 停止 SysTick
    SysTick->LOAD = 0;
    SysTick->VAL = 0;

    // ========== 5. 设置 App 的栈指针 ==========
    __set_MSP(app_sp);         // 这是跳转前最关键的一行！

    // ========== 6. 设置 VTOR ==========
    SCB->VTOR = app_addr;      // 中断向量表指向 App

    // ========== 7. 跳转 ==========
    JumpToApplication = (pFunction)app_reset_handler;
    JumpToApplication();        // 不再返回！

    // 理论上不会运行到这里，如果运行到了说明跳转失败
    while (1);
}
```

::: danger 跳转前最易遗漏的步骤
1. **忘记 MSP 设置** → App 的局部变量使用错误的位置 → 栈溢出 → HardFault
2. **忘记关闭外设** → 外设仍在运行 → App 初始化失败 (如 USART 锁死)
3. **忘记关闭 SysTick** → SysTick 中断在 App 未初始化时就触发 → HardFault
4. **忘记 VTOR** → App 的中断处理仍然跳转到 Bootloader 的向量表
:::

---

## 4. 通信协议设计

### 4.1 简单帧协议 (基于 YModem 简化版)

```c
// 固件更新帧结构
#define FRAME_HEADER    0xAA55
#define CMD_ERASE       0x01
#define CMD_WRITE       0x02
#define CMD_VERIFY      0x03
#define CMD_JUMP        0x04
#define CMD_ACK         0x80
#define CMD_NACK        0x81

typedef struct __attribute__((packed)) {
    uint16_t header;       // 0xAA55
    uint8_t  command;      // 命令字
    uint32_t address;      // Flash 写入地址
    uint16_t data_len;     // 数据长度 (最大 256)
    uint8_t  data[256];    // 数据段
    uint32_t crc;          // CRC32 校验 (整个帧)
} Boot_Frame_t;

// Bootloader 主循环
void Bootloader_Main(void) {
    Boot_Frame_t frame;

    while (1) {
        // 等待接收一帧
        if (Receive_Frame(&frame, 5000) != HAL_OK) {  // 5s 超时
            // 超时：检查 App 是否存在，存在则跳转
            if (Check_App_Valid(APP_START_ADDR)) {
                Bootloader_JumpToApp(APP_START_ADDR);
            }
            continue;
        }

        // 校验 CRC
        if (!Validate_CRC(&frame)) {
            Send_Response(CMD_NACK);
            continue;
        }

        switch (frame.command) {
            case CMD_ERASE:
                Flash_Erase_App_Region();
                Send_Response(CMD_ACK);
                break;

            case CMD_WRITE:
                Flash_Write(frame.address, frame.data, frame.data_len);
                Send_Response(CMD_ACK);
                break;

            case CMD_VERIFY:
                if (Verify_CRC32(APP_START_ADDR, APP_SIZE)) {
                    Send_Response(CMD_ACK);
                } else {
                    Send_Response(CMD_NACK);
                }
                break;

            case CMD_JUMP:
                Send_Response(CMD_ACK);
                HAL_Delay(100);  // 等待 ACK 发送完成
                Bootloader_JumpToApp(APP_START_ADDR);
                break;
        }
    }
}
```

---

## 5. 安全与校验

```c
// CRC32 校验 (硬件 CRC 加速)
uint32_t Calculate_App_CRC32(void) {
    __HAL_RCC_CRC_CLK_ENABLE();
    CRC_HandleTypeDef hcrc;
    hcrc.Instance = CRC;
    hcrc.Init.DefaultPolynomialUse = DEFAULT_POLYNOMIAL_ENABLE;
    // ... 其他配置 ...
    HAL_CRC_Init(&hcrc);

    // 使用 DMA 计算大块 Flash 的 CRC
    return HAL_CRC_Calculate(&hcrc,
        (uint32_t *)APP_START_ADDR,
        APP_SIZE_WORDS);
}

// 检查 App 是否有效 (简单的魔术字检查)
int Check_App_Valid(uint32_t app_addr) {
    uint32_t sp = *(uint32_t *)app_addr;
    uint32_t pc = *(uint32_t *)(app_addr + 4);

    // 1. 检查栈指针合理 (在 RAM 范围内)
    if (sp < 0x20000000 || sp > 0x20020000) return 0;

    // 2. 检查 Reset_Handler 在 Flash 范围内
    if (pc < app_addr || pc > (0x08000000 + 1024 * 1024)) return 0;

    // 3. 检查 Reset_Handler 的最低 bit 是 1 (Thumb 模式)
    if (!(pc & 1)) return 0;

    return 1;
}
```

---

## 6. 完整代码实现

以下是基于 STM32F4 + UART 的完整 Bootloader 实现 (精简版)：

```c
// bootloader.c - 精简但功能完整的 Bootloader
#include "stm32f4xx_hal.h"
#include <string.h>

#define BOOT_HEADER      0xAA55
#define APP_START_ADDR   0x08010000
#define APP_MAX_SIZE     (448 * 1024)
#define FLASH_SECTOR_SIZE (16 * 1024)

UART_HandleTypeDef huart1;
CRC_HandleTypeDef   hcrc;

// ====== Flash 操作 ======
static void Erase_App_Region(void) {
    FLASH_EraseInitTypeDef erase = {0};
    uint32_t sector_error = 0;

    HAL_FLASH_Unlock();
    __HAL_FLASH_CLEAR_FLAG(FLASH_FLAG_EOP | FLASH_FLAG_OPERR
                          | FLASH_FLAG_WRPERR | FLASH_FLAG_PGAERR
                          | FLASH_FLAG_PGPERR | FLASH_FLAG_PGSERR);

    erase.TypeErase = FLASH_TYPEERASE_SECTORS;
    erase.Sector = FLASH_SECTOR_4;   // 从 Sector 4 开始 (64KB+)
    erase.NbSectors = 7;             // 448KB = 7 sectors
    erase.VoltageRange = FLASH_VOLTAGE_RANGE_3;

    HAL_FLASHEx_Erase(&erase, &sector_error);
    HAL_FLASH_Lock();
}

static void Write_To_Flash(uint32_t addr, uint8_t *data, uint32_t len) {
    HAL_FLASH_Unlock();
    for (uint32_t i = 0; i < len; i += 4) {
        uint32_t word = *(uint32_t *)&data[i];
        HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, addr + i, word);
    }
    HAL_FLASH_Lock();
}

// ====== UART 通信 ======
static HAL_StatusTypeDef Receive_Frame(uint8_t *buf, uint32_t timeout) {
    uint32_t tickstart = HAL_GetTick();

    // 等待帧头 0xAA 0x55
    while (HAL_UART_Receive(&huart1, &buf[0], 1, 1) != HAL_OK) {
        if ((HAL_GetTick() - tickstart) > timeout) return HAL_TIMEOUT;
    }
    if (buf[0] != 0xAA) return HAL_ERROR;

    while (HAL_UART_Receive(&huart1, &buf[1], 1, 1) != HAL_OK) {
        if ((HAL_GetTick() - tickstart) > timeout) return HAL_TIMEOUT;
    }
    if (buf[1] != 0x55) return HAL_ERROR;

    // 读取剩余帧
    // ... (省略具体实现)

    return HAL_OK;
}

// ====== 跳转 ======
static void Jump_To_App(uint32_t addr) {
    uint32_t sp = *(volatile uint32_t *)addr;
    uint32_t pc = *(volatile uint32_t *)(addr + 4);
    pFunction app_entry = (pFunction)pc;

    // 检查有效性
    if (sp < 0x20000000 || sp > 0x20020000) return;
    if ((pc & 0xFF000000) != 0x08000000) return;

    __disable_irq();
    HAL_RCC_DeInit();
    HAL_DeInit();
    SysTick->CTRL = 0;
    __set_MSP(sp);
    SCB->VTOR = addr;
    app_entry();  // 跳转
}

// ====== 主入口 ======
int main(void) {
    HAL_Init();
    SystemClock_Config();
    MX_GPIO_Init();
    MX_USART1_UART_Init();

    uint8_t frame[264];

    // 5 秒内等不到固件更新命令就跳转到 App
    if (Receive_Frame(frame, 5000) != HAL_OK) {
        goto jump_to_app;
    }

    if (frame[2] == CMD_ERASE) Erase_App_Region();
    // ... 处理其他命令 ...

jump_to_app:
    if (Check_App_Valid(APP_START_ADDR)) {
        Jump_To_App(APP_START_ADDR);
    }

    // App 不存在，留在 Bootloader 循环
    while (1) {
        if (Receive_Frame(frame, 0xFFFFFFFF) == HAL_OK) {
            // 处理固件更新
        }
    }
}
```

---

## 7. 常见问题与调试

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 跳转后 HardFault | MSP 没设置或 VTOR 没更新 | 逐条检查 Jump_To_App 的每个步骤 |
| 2 | App 中某个外设无法初始化 | Bootloader 使用了该外设且未 DeInit | 在跳转前对每个使用的模块调用 HAL_xxx_DeInit() |
| 3 | OTA 后 App 校验失败 | Flash 写入期间断电或写入地址不对齐 | 加 CRC 校验 + 双分区备份 (A/B 交换) |
| 4 | Bootloader 自身如何更新 | 不能在 Flash 上修改正在执行的代码 | 方案 A: 在 SRAM 中执行 Flash 擦写操作; 方案 B: 使用系统的 ROM Bootloader (内嵌在 STM32) |
| 5 | 中断向量表重映射后仍然中断异常 | 有些 Cortex-M 型号的 VTOR 最低位必须对齐 TBLOFF | 检查 SCB->VTOR 的值是否等于 app_addr |
| 6 | Flash 擦除失败 | Flash 被写保护 (WRP) 或 RDP 级别限制 | 检查选项字节中的 WRP 和 RDP 配置 |

---

## 8. 参考文档

1. ST AN2606: STM32 系统存储器启动模式 — 描述了片内 ROM Bootloader 的协议
2. ST AN3155: STM32 USART Bootloader 协议 — 与片内 Bootloader 通信的协议
3. ST AN4657: STM32F4 系列 IAP 应用笔记
4. MCUBoot: https://github.com/mcu-tools/mcuboot — 开源安全 Bootloader (支持 SWAP/Overwrite 策略)
5. OpenBLT: https://www.feaser.com/openblt/ — 开源 Bootloader (支持 CAN/USB/Ethernet)
