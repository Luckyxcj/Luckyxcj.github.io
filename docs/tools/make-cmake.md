# Make / CMake 构建

> **文档说明**：本文档基于 GNU Make 手册、CMake 官方文档及嵌入式项目构建实践整理。

---

## 目录

1. [构建系统选型](#1-构建系统选型)
2. [Make 嵌入式最佳实践](#2-make-嵌入式最佳实践)
3. [CMake 嵌入式完整模板](#3-cmake-嵌入式完整模板)
4. [多目标/多平台构建](#4-多目标多平台构建)
5. [常见构建问题与排查](#5-常见构建问题与排查)
6. [参考文档](#6-参考文档)

---

## 1. 构建系统选型

| 构建系统 | 优点 | 缺点 | 适用场景 |
|---------|------|------|---------|
| **Make** | 通用、久经考验、精简易懂 | 手写规则繁琐、跨平台差 | 中小型项目 |
| **CMake** | 跨平台、IDE 集成好、模块化 | 语法诡异、学习曲线陡 | 中大型/多平台项目 |
| **CubeMX + Makefile** | 开箱即用 | 难以定制化 | STM32 简单项目 |
| **Bazel** | 极快增量构建、可重现 | 嵌入式支持不够 | 大型团队项目 |

**嵌入式推荐**：
- 简单的学习项目/单 MCU → **Make**
- 商业项目/多 MCU 平台 → **CMake + arm-none-eabi-gcc**
- ST 生态项目 → CubeMX 生成 Makefile 或 CMake 作为起点

---

## 2. Make 嵌入式最佳实践

### 2.1 自动源文件发现

```makefile
# 自动扫描所有 .c 文件，避免手动添加
C_SOURCES = $(shell find Src -name '*.c')
ASM_SOURCES = $(shell find startup -name '*.s')

C_OBJECTS = $(addprefix $(BUILD_DIR)/, $(notdir $(C_SOURCES:.c=.o)))
ASM_OBJECTS = $(addprefix $(BUILD_DIR)/, $(notdir $(ASM_SOURCES:.s=.o)))

OBJECTS = $(C_OBJECTS) $(ASM_OBJECTS)
```

### 2.2 增量编译与依赖跟踪

```makefile
# 自动生成 .d 依赖文件 (跟踪所有 #include)
DEPS = $(OBJECTS:.o=.d)

# 为每个 C 文件生成依赖
$(BUILD_DIR)/%.o: Src/%.c
	@mkdir -p $(BUILD_DIR)
	$(CC) $(CFLAGS) -MMD -MP -c $< -o $@

# 包含依赖文件 (-include 不会因为文件不存在而报错)
-include $(DEPS)
```

### 2.3 并行编译

```makefile
# make -j$(nproc) 可以并行编译，大幅加快构建速度
# 在 Makefile 中使用 MAKEFLAGS 传递
MAKEFLAGS += -j$(shell nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# 注意: 并行编译要求依赖关系正确，否则会出错
# 关键: 所有目标必须正确声明依赖
```

---

## 3. CMake 嵌入式完整模板

### 3.1 工具链文件 (arm-none-eabi.cmake)

```cmake
# toolchain.cmake — 在 CMake 调用时通过 -DCMAKE_TOOLCHAIN_FILE 指定
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(TOOLCHAIN arm-none-eabi)

set(CMAKE_C_COMPILER    ${TOOLCHAIN}-gcc)
set(CMAKE_CXX_COMPILER  ${TOOLCHAIN}-g++)
set(CMAKE_ASM_COMPILER  ${TOOLCHAIN}-gcc)
set(CMAKE_AR            ${TOOLCHAIN}-ar)
set(CMAKE_OBJCOPY       ${TOOLCHAIN}-objcopy)
set(CMAKE_OBJDUMP       ${TOOLCHAIN}-objdump)
set(CMAKE_SIZE          ${TOOLCHAIN}-size)

# 不在配置阶段尝试运行测试程序 (交叉编译无法运行目标程序)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# 查找程序/库时只在工具链路径中搜索
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

### 3.2 CMakeLists.txt 完整模板

```cmake
cmake_minimum_required(VERSION 3.21)
project(firmware C ASM)

# ====== MCU 配置 ======
set(MCU_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")
set(CMAKE_C_FLAGS   "${MCU_FLAGS} -Og -g3 -Wall -Wextra")
set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS} -ffunction-sections -fdata-sections")
set(CMAKE_ASM_FLAGS "${MCU_FLAGS} -g3")

# ====== 全局宏定义 ======
add_compile_definitions(STM32F407xx USE_HAL_DRIVER)

# ====== HAL 库 ======
add_library(hal STATIC
    hal/Src/stm32f4xx_hal.c
    hal/Src/stm32f4xx_hal_cortex.c
    hal/Src/stm32f4xx_hal_gpio.c
    hal/Src/stm32f4xx_hal_rcc.c
    hal/Src/stm32f4xx_hal_uart.c
)
target_include_directories(hal PUBLIC
    hal/Inc
    cmsis
)

# ====== 应用代码 ======
add_executable(${PROJECT_NAME}
    Src/main.c
    Src/stm32f4xx_it.c
    startup/startup_stm32f407xx.s
    ${CMAKE_SOURCE_DIR}/stm32f407vgtx_flash.ld  # 链接脚本 (依赖追踪)
)

target_include_directories(${PROJECT_NAME} PRIVATE Src)

# ====== 链接选项 ======
target_link_options(${PROJECT_NAME} PRIVATE
    -T${CMAKE_SOURCE_DIR}/stm32f407vgtx_flash.ld
    -Wl,-Map=${PROJECT_NAME}.map,--cref,--gc-sections
    -Wl,--print-memory-usage
    --specs=nano.specs
    --specs=nosys.specs
)

target_link_libraries(${PROJECT_NAME} hal)

# ====== 生成 .hex 和 .bin ======
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:${PROJECT_NAME}>
            ${PROJECT_NAME}.hex
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:${PROJECT_NAME}>
            ${PROJECT_NAME}.bin
    COMMAND ${CMAKE_SIZE} $<TARGET_FILE:${PROJECT_NAME}>
    COMMENT "Generating .hex and .bin files"
)

# ====== Flash 烧录目标 ======
add_custom_target(flash
    COMMAND openocd -f interface/stlink.cfg -f target/stm32f4x.cfg
            -c "program ${PROJECT_NAME}.hex verify reset exit"
    DEPENDS ${PROJECT_NAME}
    COMMENT "Flashing firmware to target"
)
```

### 3.3 使用 CMake 构建

```bash
# 配置 + 构建
cmake -B build -DCMAKE_TOOLCHAIN_FILE=arm-none-eabi.cmake -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j8

# 烧录
cmake --build build --target flash
```

---

## 4. 多目标/多平台构建

### 4.1 同一项目支持多个 MCU 型号

```cmake
# CMakeLists.txt — 通过 -DMCU=STM32F407 切换
if(NOT DEFINED MCU)
    message(FATAL_ERROR "请指定 MCU: -DMCU=STM32F407 或 STM32F103")
endif()

if(MCU STREQUAL "STM32F407")
    set(MCU_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard")
    add_compile_definitions(STM32F407xx)
    set(LD_SCRIPT "${CMAKE_SOURCE_DIR}/ld/stm32f407vgtx_flash.ld")
elseif(MCU STREQUAL "STM32F103")
    set(MCU_FLAGS "-mcpu=cortex-m3 -mthumb")
    add_compile_definitions(STM32F103xB)
    set(LD_SCRIPT "${CMAKE_SOURCE_DIR}/ld/stm32f103c8tx_flash.ld")
endif()
```

---

## 5. 常见构建问题与排查

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 修改了 .h 文件但 make 重新编译 | 没有生成 .d 依赖文件 | 确保 CFLAGS 中有 `-MMD -MP`，Makefile 中有 `-include $(DEPS)` |
| 2 | `make -j` 出错但 `make` 正常 | 并行构建时缺少依赖声明 | 检查 .o 目标是否遗漏了对 .h 的显式依赖 |
| 3 | CMake 找不到编译器 | 工具链前缀或 PATH 不对 | 设置绝对路径或确认 arm-none-eabi-gcc 在 PATH 中 |
| 4 | `recipe for target failed` 子 make 错误 | make 嵌套时变量没有传递 | 使用 `export VARIABLE` 导出变量 |
| 5 | CMake 缓存了错误的路径 | 上次配置的结果残留 | `rm -rf build && cmake -B build ...` (清缓存重新配置) |
| 6 | CubeMX 自动生成覆盖了手改的 Makefile | 重新生成会覆盖工程文件 | 将自定义规则放在独立的 .mk 文件中，用 `include` 引入 |

---

## 6. 参考文档

1. GNU Make Manual: https://www.gnu.org/software/make/manual/
2. CMake Documentation: https://cmake.org/documentation/
3. "Professional CMake" — Craig Scott 著
4. CMake Toolchain Files for ARM: https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html
5. STM32CubeMX Makefile/CMake 生成指南
