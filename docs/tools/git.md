# Git 版本控制（嵌入式专属）

> **文档说明**：本文档基于 Git 官方文档及嵌入式项目版本控制实践整理，重点关注嵌入式项目特有的 Git 工作流。

---

## 目录

1. [嵌入式项目的 Git 挑战](#1-嵌入式项目的-git-挑战)
2. [推荐的 Git 工作流](#2-推荐的-git-工作流)
3. [.gitignore 最佳实践](#3-gitignore-最佳实践)
4. [子模块管理 SDK/库](#4-子模块管理-sdk库)
5. [固件版本标记](#5-固件版本标记)
6. [常见问题](#6-常见问题)
7. [参考文档](#7-参考文档)

---

## 1. 嵌入式项目的 Git 挑战

嵌入式项目与纯软件项目在版本控制上面临不同挑战：

| 挑战 | 说明 |
|------|------|
| **二进制文件** | .bin/.hex 固件、PCB 文件、数据手册无法 diff |
| **IDE 生成文件** | CubeMX/IAR/Keil 生成大量中间文件，不能提交但不能丢 |
| **第三方库** | HAL/SDK/RTOS 源码体积大，是独立维护还是复制到项目中？ |
| **硬件依赖** | 同一份代码在不同 PCB 版本间切换 |
| **工具链差异** | 不同开发者可能用不同版本的 arm-none-eabi-gcc |

---

## 2. 推荐的 Git 工作流

### 2.1 嵌入式简化 Git Flow

```
master (生产分支)
  │
  ├── develop (开发主分支)
  │     │
  │     ├── feature/uart-dma      (功能分支)
  │     ├── feature/can-fd
  │     │
  │     └── bugfix/watchdog-reset (修复分支)
  │
  └── release/v1.2 (发布分支)
```

### 2.2 嵌入式常用命令

```bash
# --- 分支管理 ---
git branch feature/xxx              # 从当前分支创建
git checkout -b feature/xxx         # 创建并切换
git merge --no-ff feature/xxx       # 合并时保留分支历史

# --- 查看历史 ---
git log --oneline --graph --all     # 漂亮的提交图
git log -p src/main.c               # 查看某个文件的修改历史
git blame src/main.c                # 谁最后修改了每一行

# --- 暂存操作 ---
git stash                           # 暂存当前修改
git stash pop                       # 恢复暂存
git stash list                      # 查看所有暂存

# --- 撤销操作 ---
git reset HEAD src/main.c           # 取消暂存
git checkout -- src/main.c          # 丢弃修改 (危险!)
git revert HEAD                     # 撤销最近一次提交 (安全)
git reset --soft HEAD~1             # 撤销提交但保留修改

# --- 比较差异 ---
git diff                            # 工作区 vs 暂存区
git diff --staged                   # 暂存区 vs HEAD
git diff HEAD~1                     # HEAD vs HEAD~1
git diff master...feature/xxx       # feature 分支 vs 从 master fork 后的所有修改

# --- 标签 (固件版本) ---
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
git tag -l                          # 列出所有标签
```

### 2.3 Commit Message 规范

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]

类型 (type):
  feat:     新功能 (feature)
  fix:      修复 bug
  refactor: 代码重构 (不改变功能)
  perf:     性能优化
  docs:     文档修改
  test:     测试相关
  build:    构建系统/工具链修改
  hw:       硬件相关 (PCB 版本对应修改)

示例:
  feat(uart): add DMA idle-line receive for UART2
  fix(can): correct baudrate prescaler for 500kbps on F407
  hw(pcb): add pull-up resistors for I2C bus on Rev 2.1
```

---

## 3. .gitignore 最佳实践

```gitignore
# ====== 嵌入式项目标准 .gitignore ======

# --- 编译产物 ---
build/
Debug/
Release/
*.o
*.d
*.elf
*.hex
*.bin
*.map
*.lst
*.out

# --- IDE 生成文件 (保留模板, 忽略用户特定) ---
# STM32CubeIDE
.cproject
.project
.settings/
Debug/
.settings/

# Keil
*.uvguix.*
*.scvd
Listings/
Objects/

# IAR
Debug/
Release/
settings/

# VS Code
.vscode/
!.vscode/tasks.json
!.vscode/launch.json

# --- 临时文件 ---
*.swp
*.swo
*~
*.log
.temp/

# --- 工具链 ---
# (不提交工具链本身—通过 README 说明需要的版本)

# --- 固件/数据手册 (二进制) ---
# 小文件 (< 1MB) 可以提交
# 大文件 (> 1MB) 建议用 Git LFS 或单独存储
```

---

## 4. 子模块管理 SDK/库

```bash
# 添加子模块 (如 CMSIS)
git submodule add https://github.com/ARM-software/CMSIS_5.git lib/CMSIS

# 克隆带子模块的项目
git clone --recursive <repo_url>

# 更新子模块到最新提交
git submodule update --remote

# 删除子模块
git submodule deinit lib/CMSIS
git rm lib/CMSIS
```

::: tip 子模块 vs 直接复制
- 使用子模块: SDK/库需要独立维护，有多个项目共享使用
- 直接复制: 只在一个项目用，或需要对库进行本地修改
- 推荐: 将稳定的第三方库 (CMSIS, FreeRTOS) 作为子模块；将项目特定的 HAL 配置直接复制
:::

---

## 5. 固件版本标记

### 5.1 版本号嵌入固件

```c
// version.h — 由构建系统自动生成
#define FW_VERSION_MAJOR   1
#define FW_VERSION_MINOR   2
#define FW_VERSION_PATCH   0
#define FW_GIT_HASH        "a3f2b1c"

// 将版本信息存储在固定地址 (方便外部工具读取)
__attribute__((section(".fw_info"))) __attribute__((used))
const struct {
    uint8_t  magic[4];      // "FWIF" (Firmware Info)
    uint16_t version_major;
    uint16_t version_minor;
    uint16_t version_patch;
    uint8_t  git_hash[8];
    uint32_t build_time;    // Unix timestamp
} fw_info = {
    .magic = {'F','W','I','F'},
    .version_major = FW_VERSION_MAJOR,
    .version_minor = FW_VERSION_MINOR,
    .version_patch = FW_VERSION_PATCH,
    .git_hash = FW_GIT_HASH,
    .build_time = BUILD_TIMESTAMP,
};
```

### 5.2 自动生成版本号 (Makefile)

```makefile
# 从 Git 自动获取版本信息
FW_VERSION = $(shell git describe --tags --always --dirty)
FW_GIT_HASH = $(shell git rev-parse --short HEAD)
BUILD_TIME = $(shell date +%s)

CFLAGS += -DFW_VERSION=\"$(FW_VERSION)\"
CFLAGS += -DFW_GIT_HASH=\"$(FW_GIT_HASH)\"
CFLAGS += -DBUILD_TIMESTAMP=$(BUILD_TIME)
```

---

## 6. 常见问题

| # | 问题 | 解决方法 |
|---|------|---------|
| 1 | 同事的 CubeMX 版本不同，生成的代码有差异 | 固定 CubeMX 版本；或在 .gitignore 中排除 CubeMX 生成的非必要文件 |
| 2 | 二进制固件 (.bin) 在仓库中使体积暴增 | .bin/.hex 不在仓库中。固件发布用 GitHub Releases 或独立存储 |
| 3 | 合并 HAL 更新时冲突大量 | CubeMX 生成的代码放在单独的目录，减少修改。建议在 CubeMX 生成的注释区间编辑 |
| 4 | 忘记某次提交改了什么，导致硬件版本不匹配 | 在 commit message 中用 `hw:` 标记硬件相关修改；贴 PCB 版本号 |
| 5 | 不小心提交了 .env 文件（含密码/密钥） | `git filter-branch` 或 BFG Repo-Cleaner 彻底删除；之后将 .env 加入 .gitignore |

---

## 7. 参考文档

1. Pro Git Book: https://git-scm.com/book/zh/v2
2. Conventional Commits: https://www.conventionalcommits.org/
3. Git Submodules: https://git-scm.com/book/en/v2/Git-Tools-Submodules
4. "A successful Git branching model" — Vincent Driessen
5. Semantic Versioning (SemVer): https://semver.org/lang/zh-CN/
