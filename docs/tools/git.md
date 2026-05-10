# Git 版本控制

> **文档说明**：本文档涵盖 Git 通用操作与嵌入式项目版本控制实践，从基础配置到进阶技巧，帮助开发者高效管理代码。

---

## 目录

1. [环境配置与准备](#1-环境配置与准备)
2. [日常开发核心命令流](#2-日常开发核心命令流)
3. [推荐的 Git 工作流](#3-推荐的-git-工作流)
4. [Git 进阶操作](#4-git-进阶操作)
5. [.gitignore 最佳实践](#5-gitignore-最佳实践)
6. [子模块管理 SDK/库](#6-子模块管理-sdk库)
7. [固件版本标记（嵌入式专属）](#7-固件版本标记嵌入式专属)
8. [合并冲突解决](#8-合并冲突解决)
9. [撤销与回滚](#9-撤销与回滚)
10. [实用技巧与常见踩坑](#10-实用技巧与常见踩坑)
11. [Git 命令速查表](#11-git-命令速查表)
12. [常见问题](#12-常见问题)
13. [参考文档](#13-参考文档)

---

## 1. 环境配置与准备

### 1.1 基础配置

```bash
# 配置全局用户信息（提交记录会显示，需和仓库平台账号一致）
git config --global user.name "你的用户名"
git config --global user.email "你的注册邮箱"

# 克隆远程仓库到本地
git clone https://github.com/xxx/xxx.git

# 进入项目目录（后续所有命令都在该目录下执行）
cd 项目文件夹名称
```

### 1.2 实用配置

```bash
# 设置默认分支名为 main（Git 2.28+）
git config --global init.defaultBranch main

# 设置默认编辑器（如 VS Code）
git config --global core.editor "code --wait"

# 开启颜色显示（让命令输出更易读）
git config --global color.ui auto

# 设置 pull 时默认使用 rebase（避免多余的 merge commit）
git config --global pull.rebase true

# 查看当前所有配置
git config --list

# 设置换行符处理规则
git config --global core.autocrlf true   # Windows
git config --global core.autocrlf input  # Linux/Mac
```

### 1.3 SSH Key 配置

使用 SSH 方式克隆仓库可以免去每次输入密码的麻烦：

```bash
# 1. 生成 SSH 密钥
ssh-keygen -t ed25519 -C "你的注册邮箱"

# 2. 查看公钥内容
cat ~/.ssh/id_ed25519.pub

# 3. 将公钥添加到 GitHub/GitLab 等平台的 SSH Keys 设置中
#    GitHub: Settings → SSH and GPG keys → New SSH key

# 4. 测试连接
ssh -T git@github.com    # GitHub
ssh -T git@gitlab.com    # GitLab

# 5. 之后使用 SSH 地址克隆
git clone git@github.com:xxx/xxx.git
```

### 1.4 Git 配置文件层级

```
系统级（所有用户）  →  /etc/gitconfig
全局级（当前用户）  →  ~/.gitconfig 或 ~/.config/git/config
仓库级（当前项目）  →  .git/config

# 查看各层级的配置
git config --system --list
git config --global --list
git config --local --list
```

---

## 2. 日常开发核心命令流

日常开发建议遵循「主分支不直接开发，功能分支独立开发」的原则。

### 2.1 核心流程

```bash
# 步骤1：拉取主分支最新代码
git checkout main
git pull origin main

# 步骤2：创建并切换到功能分支（分支命名建议规范）
git checkout -b feature/user-login
# 或使用更现代的 switch 命令（Git 2.23+）
git switch -c feature/user-login

# 步骤3：开发过程中
git status                              # 查看文件修改状态（高频命令）
git add .                               # 将修改加入暂存区
git add src/login.vue                   # 仅添加指定文件
git commit -m "feat(登录): 实现登录功能" # 提交代码
git commit --amend                      # 补充提交（修改最近一次提交）

# 步骤4：推送分支到远程仓库
git push -u origin feature/user-login   # 第一次推送，-u 关联远程分支
git push                                # 后续推送（已关联分支）

# 步骤5：功能完成后合并到主分支
# 方式1：本地合并（适合小型团队）
git checkout main && git pull origin main
git merge feature/user-login
git push origin main

# 方式2：提 MR/PR（推荐团队协作）
# 推送功能分支后，在 Git 平台提交合并请求，审核通过后由管理员合并

# 步骤6：清理分支
git branch -d feature/user-login              # 删除本地分支
git push origin --delete feature/user-login    # 删除远程分支
```

### 2.2 查看差异

```bash
# 查看工作区与暂存区的差异（未 add 的修改）
git diff

# 查看暂存区与最近一次提交的差异（已 add 未 commit 的修改）
git diff --staged

# 查看两个分支之间的差异
git diff main..feature/user-login

# 查看某个文件的差异
git diff src/login.vue

# 查看简洁的差异统计（哪些文件改了多少行）
git diff --stat
```

### 2.3 查看提交日志

```bash
# 一行显示所有提交
git log --oneline

# 图形化显示分支历史（非常直观）
git log --oneline --graph --all

# 查看最近 N 次提交
git log -5

# 查看某个作者的提交
git log --author="用户名"

# 查看某个时间段的提交
git log --since="2024-01-01" --until="2024-12-31"

# 查看包含某个关键字的提交
git log --grep="登录"

# 查看某个文件的修改历史（包含每次修改的内容）
git log -p src/main.c

# 查看某行代码是谁修改的（追责利器）
git blame src/main.c
```

---

## 3. 推荐的 Git 工作流

### 3.1 嵌入式简化 Git Flow

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

### 3.2 主流分支策略对比

#### Git Flow（适合版本发布型项目）

```
main          ──────────────────────────────────────  生产环境
              \                                       /
release/*     ──────── 准备发布 ──────── 合并到 main ─
              /                                       \
develop       ───────────────────────────────────────  开发主线
             /          \
feature/*   ── 功能开发 ── 合并到 develop
            /
hotfix/*   ── 紧急修复 ── 合并到 main + develop
```

**分支说明：**
- `main`：生产环境代码，每次合并打 Tag
- `develop`：开发主线，集成所有功能
- `feature/*`：功能开发分支，从 develop 创建，完成后合并回 develop
- `release/*`：发布准备分支，测试通过后合并到 main 和 develop
- `hotfix/*`：紧急修复分支，从 main 创建，修复后合并到 main 和 develop

#### GitHub Flow（适合持续部署型项目）

```
main  ────── ────── ────── ──────  始终可部署
       \       /       /       /
feature ─── PR ─── PR ─── PR    功能分支通过 PR 合并
```

**核心原则：**
- `main` 分支始终可部署
- 所有开发在功能分支进行
- 通过 Pull Request 进行代码审查
- 合并后立即部署

#### Trunk-Based Development（适合高频发布团队）

```
main  ────── ────── ────── ──────  频繁提交，频繁部署
       │       │       │       │
       └─ feature flag 控制未完成功能
```

**核心原则：**
- 所有开发者直接在 main（或极短生命周期的分支）上提交
- 使用 Feature Flag 控制未完成功能对用户不可见
- 依赖自动化测试和 CI/CD

### 3.3 分支命名规范

```
feature/功能描述    # 新功能开发
bugfix/问题描述    # Bug 修复
hotfix/问题描述    # 紧急修复
release/版本号     # 版本发布准备
docs/文档描述      # 文档更新
refactor/重构描述  # 代码重构
test/测试描述      # 测试相关

# 示例
feature/user-login
bugfix/fix-login-timeout
hotfix/memory-leak-fix
release/v1.2.0
```

### 3.4 Commit Message 规范（Conventional Commits）

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(uart): add DMA idle-line receive for UART2` |
| `fix` | 修复 Bug | `fix(can): correct baudrate prescaler for 500kbps on F407` |
| `docs` | 文档变更 | `docs: update README installation instructions` |
| `style` | 代码格式（不影响逻辑） | `style: unify indentation to 2 spaces` |
| `refactor` | 重构（不新增功能也不修 Bug） | `refactor(uart): extract baudrate calculation` |
| `perf` | 性能优化 | `perf(adc): use DMA for batch sampling` |
| `test` | 测试相关 | `test(uart): add unit tests for DMA receive` |
| `build` | 构建系统/工具链修改 | `build: upgrade arm-none-eabi-gcc to v13` |
| `ci` | CI/CD 配置变更 | `ci: add GitHub Actions build pipeline` |
| `hw` | 硬件相关（嵌入式专属） | `hw(pcb): add pull-up resistors for I2C bus on Rev 2.1` |
| `chore` | 其他杂项 | `chore: update .gitignore` |
| `revert` | 回退提交 | `revert: revert feat(uart) commit` |

---

## 4. Git 进阶操作

### 4.1 Git Stash — 暂存工作进度

当你正在开发功能，突然需要切换分支修复紧急 bug，但当前修改还不想提交时：

```bash
# 暂存当前工作区的修改
git stash

# 暂存时附带说明信息（推荐）
git stash save "正在开发用户登录功能，进度50%"

# 查看所有暂存记录
git stash list

# 恢复最近一次暂存（并从暂存列表中删除）
git stash pop

# 恢复指定暂存（不删除暂存记录）
git stash apply stash@{0}

# 查看暂存的具体修改内容
git stash show -p stash@{0}

# 删除所有暂存记录
git stash clear

# 删除指定暂存记录
git stash drop stash@{0}
```

**使用场景示例：**

```bash
# 场景：正在开发功能，突然需要紧急修复 bug
git stash save "开发登录功能中"    # 1. 暂存当前修改
git checkout main                  # 2. 切到主分支
git checkout -b bugfix/urgent-fix  # 3. 创建修复分支
# ... 修复 bug，提交，合并 ...
git checkout feature/user-login    # 4. 切回功能分支
git stash pop                      # 5. 恢复之前的修改，继续开发
```

### 4.2 Git Rebase — 变基操作

Rebase 可以让提交历史更加线性、整洁：

```bash
# 将当前分支的提交"重放"到目标分支最新代码之上
git rebase main

# 交互式 rebase（修改最近 3 次提交）
git rebase -i HEAD~3
```

**交互式 rebase 常用操作：**

```bash
# 执行后会打开编辑器，每个提交前有操作选项：
# pick   = 保留该提交（默认）
# squash = 将该提交合并到上一个提交
# reword = 保留提交但修改提交信息
# edit   = 暂停到该提交，可以修改文件
# drop   = 丢弃该提交

# 示例：将最近 3 次提交合并为 1 次
# 编辑器中显示：
# pick a1b2c3d feat(登录): 添加页面
# squash d4e5f6g feat(登录): 添加逻辑
# squash h7i8j9k feat(登录): 修复bug
# 保存后，Git 会让你编辑合并后的提交信息
```

**merge vs rebase 对比：**

| 特性 | `git merge` | `git rebase` |
|------|------------|--------------|
| 提交历史 | 保留完整的分支历史（有合并节点） | 线性历史，更整洁 |
| 安全性 | 不改写历史，安全 | 改写提交历史，需谨慎 |
| 适用场景 | 团队协作、公共分支 | 个人分支整理提交 |
| 冲突处理 | 一次性解决所有冲突 | 逐个提交解决冲突 |

> ⚠️ **黄金法则**：不要对已推送到远程的公共分支执行 rebase，否则会导致协作者的历史混乱。

### 4.3 Git Tag — 版本标签

Tag 用于标记发布版本，方便追踪和回溯：

```bash
# 创建轻量标签（仅引用，不含额外信息）
git tag v1.0.0

# 创建附注标签（推荐，包含标签信息、日期、作者）
git tag -a v1.0.0 -m "发布 v1.0.0 版本：完成用户登录和注册功能"

# 给历史提交打标签
git tag -a v0.9.0 版本号 -m "补打 v0.9.0 标签"

# 查看所有标签
git tag

# 查看标签详细信息
git show v1.0.0

# 推送标签到远程
git push origin v1.0.0           # 推送单个标签
git push origin --tags           # 推送所有标签

# 删除标签
git tag -d v1.0.0                # 删除本地标签
git push origin --delete v1.0.0  # 删除远程标签

# 基于标签创建分支
git checkout -b release/v1.0.0 v1.0.0
```

### 4.4 Git Cherry-pick — 精选提交

将某个分支上的特定提交应用到当前分支：

```bash
# 将指定提交应用到当前分支
git cherry-pick 版本号

# 应用多个提交
git cherry-pick 版本号1 版本号2

# 应用一个范围内的提交（不含版本号1）
git cherry-pick 版本号1..版本号2

# 如果 cherry-pick 出现冲突，解决后：
git add .
git cherry-pick --continue

# 放弃 cherry-pick
git cherry-pick --abort
```

**典型场景：**

```bash
# 场景：hotfix 分支修复了一个紧急 bug，需要同步到开发分支
git checkout feature/user-login   # 切到开发分支
git cherry-pick abc1234           # 将 bugfix 的提交"摘"过来
```

### 4.5 Git Fetch vs Pull

```bash
# git fetch：只拉取远程信息，不自动合并（更安全）
git fetch origin

# 查看远程分支和本地分支的差异
git log HEAD..origin/main --oneline

# 确认无误后再合并
git merge origin/main

# git pull = git fetch + git merge（自动合并）
git pull origin main

# 推荐：使用 pull --rebase 避免多余的 merge commit
git pull --rebase origin main
```

### 4.6 Git Bisect — 二分查找 Bug

通过二分法快速定位引入 bug 的提交：

```bash
# 1. 启动二分查找
git bisect start

# 2. 标记当前提交为有 bug
git bisect bad

# 3. 标记一个已知没问题的旧版本
git bisect good v1.0.0

# 4. Git 会自动检出中间版本，你测试后标记 good 或 bad
git bisect good  # 这个版本没问题
git bisect bad   # 这个版本有 bug
# ... 重复此过程，直到 Git 找到引入 bug 的提交 ...

# 5. 找到后结束查找
git bisect reset
```

### 4.7 Git Remote — 远程仓库管理

```bash
# 查看远程仓库
git remote -v

# 添加远程仓库
git remote add origin https://github.com/xxx/xxx.git

# 修改远程仓库地址
git remote set-url origin git@github.com:xxx/xxx.git

# 重命名远程仓库
git remote rename origin upstream

# 删除远程仓库
git remote remove origin
```

---

## 5. .gitignore 最佳实践

### 5.1 通用 .gitignore

```gitignore
# ====== 通用 .gitignore ======

# 编译产物
build/
dist/
*.o
*.class

# 依赖目录
node_modules/
vendor/

# IDE 配置文件
.idea/
.vscode/
*.swp

# 系统文件
.DS_Store
Thumbs.db

# 环境配置（含敏感信息）
.env
.env.local

# 日志文件
*.log
```

### 5.2 嵌入式项目 .gitignore

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

### 5.3 .gitattributes 配置

```gitattributes
# 自动检测文本文件并转换换行符
* text=auto

# 指定特定文件使用 LF 换行（避免 Windows CRLF 问题）
*.sh text eol=lf
*.py text eol=lf

# 指定特定文件使用 CRLF
*.bat text eol=crlf

# 二进制文件不做换行转换
*.png binary
*.jpg binary
*.pdf binary
```

```bash
# 如果文件已经被 Git 跟踪，需要先从缓存中移除
git rm --cached 文件名
git rm -r --cached 目录名/
```

---

## 6. 子模块管理 SDK/库

```bash
# 添加子模块 (如 CMSIS)
git submodule add https://github.com/ARM-software/CMSIS_5.git lib/CMSIS

# 克隆带子模块的项目
git clone --recursive <repo_url>

# 如果已经克隆但忘记 --recursive
git submodule update --init --recursive

# 更新子模块到最新提交
git submodule update --remote

# 查看子模块状态
git submodule status

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

## 7. 固件版本标记（嵌入式专属）

### 7.1 版本号嵌入固件

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

### 7.2 自动生成版本号 (Makefile)

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

## 8. 合并冲突解决

合并冲突最核心、最常见的触发时机就是执行 `git merge` 或 `git pull` 时。

**触发条件：** 当两段代码修改了**同一个文件的同一行（或相邻行）**，Git 无法判断保留哪一份修改，就会中断 merge 流程，提示冲突。

> `git pull` = `git fetch` + `git merge`，因此 `git pull` 也常触发冲突。

### 8.1 解决步骤

```bash
# 1. 冲突发生后，查看冲突文件
git status  # 会标注「both modified」的冲突文件

# 2. 打开冲突文件，手动修改（冲突标记如下）
# <<<<<<< HEAD （当前分支的代码）
# 你的代码
# ======= （待合并分支的代码）
# 对方的代码
# >>>>>>> feature/user-login

# 3. 修改后标记为已解决
git add 冲突文件名

# 4. 完成合并提交
git commit -m "merge: 解决登录功能合并冲突，统一验证码逻辑"

# 如果合并到一半想放弃：
git merge --abort  # 回到合并前的状态，不会保留任何修改
```

### 8.2 完整示例

```bash
# 1. 切到主分支，拉取最新代码
git checkout main
git pull origin main

# 2. 执行合并，触发冲突
git merge feature/user-login
# 命令行输出：Automatic merge failed; fix conflicts and then commit the result.

# 3. 查看冲突文件
git status
# 输出：both modified:   src/login.c

# 4. 手动解决冲突：打开 src/login.c，找到冲突标记并编辑
# <<<<<<< HEAD
# 主分支的验证码逻辑
# =======
# 功能分支的验证码逻辑
# >>>>>>> feature/user-login

# 5. 修改后保存，标记为「冲突已解决」
git add src/login.c

# 6. 完成合并提交
git commit -m "merge: 解决登录功能合并冲突，统一验证码逻辑"
```

### 8.3 使用 VS Code 解决冲突

VS Code 内置冲突解决工具，打开冲突文件后：
1. 文件中会显示冲突标记和快捷按钮
2. 点击 **"Accept Current Change"** 保留当前分支的代码
3. 点击 **"Accept Incoming Change"** 保留待合并分支的代码
4. 点击 **"Accept Both Changes"** 保留两边的代码
5. 也可以手动编辑选择保留的内容

---

## 9. 撤销与回滚

### 9.1 撤销工作区修改（未 add 的文件）

```bash
# 传统方式
git checkout -- 文件名

# 推荐方式（Git 2.23+，语义更清晰）
git restore 文件名
git restore .  # 恢复所有工作区修改
```

### 9.2 撤销暂存区修改（已 add 但未 commit）

```bash
# 传统方式
git reset HEAD 文件名

# 推荐方式（Git 2.23+）
git restore --staged 文件名
git restore --staged .  # 取消所有暂存
```

### 9.3 回滚已提交的代码

```bash
# 查看提交日志，找到要回滚的版本号
git log --oneline

# 软回滚（保留修改，可重新提交，推荐）
git reset --soft 版本号

# 硬回滚（彻底放弃后续所有修改，谨慎！）
git reset --hard 版本号
# 若已推送到远程，需强制推送（团队协作前务必沟通）
git push -f origin main
```

### 9.4 更安全的回滚方式

```bash
# git revert：创建一个新的提交来撤销指定提交，不改写历史（团队协作推荐）
git revert 版本号

# 撤销最近一次提交（安全，不影响远程）
git revert HEAD

# 撤销多个提交
git revert 版本号1 版本号2
```

**reset vs revert 对比：**

| 特性 | `git reset --hard` | `git revert` |
|------|-------------------|--------------|
| 原理 | 回退历史指针 | 新增反向提交 |
| 历史记录 | 改写历史 | 不改写历史 |
| 远程同步 | 需要 force push | 正常 push |
| 安全性 | 危险 | 安全（推荐团队使用） |

### 9.5 git reflog — 恢复误删的提交

`git reflog` 记录了 HEAD 的所有移动历史，即使提交被删除也能找回：

```bash
# 查看所有操作记录（包括已删除的提交）
git reflog

# 输出示例：
# a1b2c3d HEAD@{0}: reset: moving to HEAD~1
# e4f5g6h HEAD@{1}: commit: feat(登录): 添加验证码功能
# b2c3d4e HEAD@{2}: commit: feat(登录): 添加登录页面

# 找到误删的提交版本号，恢复它
git reset --hard e4f5g6h

# 或者创建一个新分支指向该提交
git branch recovered-login e4f5g6h
```

> 💡 **提示**：`git reflog` 是你的"后悔药"，几乎所有误操作都可以通过它恢复。

---

## 10. 实用技巧与常见踩坑

### 10.1 Git 别名配置

```bash
# 设置常用别名，提升效率
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.lg "log --oneline --graph --all"
git config --global alias.last "log -1 HEAD"
git config --global alias.amend "commit --amend"
git config --global alias.unstage "restore --staged ."
git config --global alias.undo "checkout --"

# 使用示例
git st          # 等同于 git status
git lg          # 图形化查看日志
git last        # 查看最近一次提交
git unstage     # 取消所有暂存
```

### 10.2 暂存部分文件（交互式添加）

```bash
# 交互式选择要暂存的修改（逐个 hunk 选择）
git add -p

# 交互式选择要暂存的文件
git add -i
```

### 10.3 清理工作区

```bash
# 查看哪些文件会被清理（不实际删除）
git clean -n

# 清理未跟踪的文件
git clean -f

# 清理未跟踪的文件和目录
git clean -fd

# 清理未跟踪的文件和 .gitignore 中忽略的文件（极其危险！）
git clean -fdx
```

### 10.4 浅克隆（节省空间）

```bash
# 只获取最近一次提交（速度快，节省空间）
git clone --depth=1 https://github.com/xxx/xxx.git

# 浅克隆指定分支
git clone --depth=1 --branch main https://github.com/xxx/xxx.git

# 后续需要完整历史时转换
git fetch --unshallow
```

### 10.5 常见踩坑与解决方案

#### 坑1：不小心在 main 分支上开发了

```bash
git stash                           # 暂存当前修改
git checkout -b feature/user-login  # 创建并切换到功能分支
git stash pop                       # 恢复暂存的修改
# 继续正常开发...
```

#### 坑2：提交信息写错了

```bash
# 还没 push：直接修改
git commit --amend -m "正确的提交信息"

# 已经 push 了（个人分支）：修改后强制推送
git commit --amend -m "正确的提交信息"
git push -f origin feature/user-login

# 已经 push 了（公共分支）：不要 amend，用新提交修正
git commit -m "docs: 修正上一条提交信息中的描述错误"
```

#### 坑3：不小心 push 了敏感信息

```bash
# 推荐：使用 git-filter-repo 工具
# pip install git-filter-repo
git filter-repo --path 文件路径 --invert-paths

# 传统方式（较慢）
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch 文件路径" \
  --prune-empty --tag-name-filter cat -- --all

# 清理本地缓存
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

#### 坑4：合并后想撤销

```bash
# 撤销最近一次 merge（保留所有修改在工作区）
git reset --soft HEAD~1

# 如果 merge 后已经 push，使用 revert 撤销
git revert -m 1 HEAD
# -m 1 表示保留主分支的版本
```

#### 坑5：修改历史提交信息

```bash
# 修改最近一次提交信息
git commit --amend -m "新的提交信息"

# 修改历史中某次提交的信息（交互式 rebase）
git rebase -i HEAD~3
# 将对应提交的 pick 改为 reword，保存后编辑提交信息
```

---

## 11. Git 命令速查表

### 基础操作

| 命令 | 说明 |
|------|------|
| `git init` | 初始化仓库 |
| `git clone <url>` | 克隆远程仓库 |
| `git status` | 查看工作区状态 |
| `git add <file>` | 添加到暂存区 |
| `git add .` | 添加所有修改到暂存区 |
| `git commit -m "msg"` | 提交暂存区修改 |
| `git diff` | 查看工作区差异 |
| `git diff --staged` | 查看暂存区差异 |
| `git log --oneline` | 简洁查看提交日志 |
| `git log --oneline --graph --all` | 图形化查看分支历史 |

### 分支操作

| 命令 | 说明 |
|------|------|
| `git branch` | 查看本地分支 |
| `git branch -a` | 查看所有分支（含远程） |
| `git branch <name>` | 创建分支 |
| `git checkout <name>` | 切换分支 |
| `git switch -c <name>` | 创建并切换分支 |
| `git merge <name>` | 合并分支 |
| `git branch -d <name>` | 删除分支 |
| `git push -u origin <name>` | 推送并关联远程分支 |

### 远程操作

| 命令 | 说明 |
|------|------|
| `git remote -v` | 查看远程仓库 |
| `git fetch origin` | 拉取远程信息 |
| `git pull origin main` | 拉取并合并 |
| `git push origin main` | 推送到远程 |
| `git push -f origin main` | 强制推送（谨慎） |

### 撤销与回滚

| 命令 | 说明 |
|------|------|
| `git restore <file>` | 撤销工作区修改 |
| `git restore --staged <file>` | 取消暂存 |
| `git reset --soft <hash>` | 软回滚 |
| `git reset --hard <hash>` | 硬回滚（危险） |
| `git revert <hash>` | 安全回滚（推荐） |
| `git commit --amend` | 修改最近一次提交 |
| `git reflog` | 查看操作历史 |

### 进阶操作

| 命令 | 说明 |
|------|------|
| `git stash` | 暂存工作区修改 |
| `git stash pop` | 恢复暂存 |
| `git rebase main` | 变基操作 |
| `git rebase -i HEAD~3` | 交互式变基 |
| `git cherry-pick <hash>` | 精选提交 |
| `git tag -a v1.0 -m "msg"` | 创建标签 |
| `git bisect start` | 二分查找 Bug |
| `git blame <file>` | 查看文件每行修改者 |
| `git clean -fd` | 清理未跟踪文件 |

---

## 12. 常见问题

| # | 问题 | 解决方法 |
|---|------|---------|
| 1 | 同事的 CubeMX 版本不同，生成的代码有差异 | 固定 CubeMX 版本；或在 .gitignore 中排除 CubeMX 生成的非必要文件 |
| 2 | 二进制固件 (.bin) 在仓库中使体积暴增 | .bin/.hex 不在仓库中。固件发布用 GitHub Releases 或独立存储 |
| 3 | 合并 HAL 更新时冲突大量 | CubeMX 生成的代码放在单独的目录，减少修改。建议在 CubeMX 生成的注释区间编辑 |
| 4 | 忘记某次提交改了什么，导致硬件版本不匹配 | 在 commit message 中用 `hw:` 标记硬件相关修改；贴 PCB 版本号 |
| 5 | 不小心提交了 .env 文件（含密码/密钥） | `git filter-repo` 或 BFG Repo-Cleaner 彻底删除；之后将 .env 加入 .gitignore |
| 6 | `git push` 被拒绝（远程有新提交） | 先 `git pull --rebase origin main`，再 `git push` |
| 7 | 误删了分支或提交 | 使用 `git reflog` 找到版本号，`git reset --hard <hash>` 恢复 |
| 8 | clone 的仓库太大 | 使用 `git clone --depth=1` 浅克隆，或 `git clone --single-branch` 只克隆指定分支 |

---

## 13. 参考文档

1. Pro Git Book: https://git-scm.com/book/zh/v2
2. Conventional Commits: https://www.conventionalcommits.org/zh-hans/
3. Git Submodules: https://git-scm.com/book/en/v2/Git-Tools-Submodules
4. "A successful Git branching model" — Vincent Driessen: https://nvie.com/posts/a-successful-git-branching-model/
5. Semantic Versioning (SemVer): https://semver.org/lang/zh-CN/
6. GitHub 官方 .gitignore 模板集合: https://github.com/github/gitignore
7. GitHub Flow 工作流: https://docs.github.com/en/get-started/quickstart/github-flow
8. Git 交互式学习（Learn Git Branching）: https://learngitbranching.js.org/?locale=zh_CN
9. git-filter-repo 工具: https://github.com/newren/git-filter-repo
10. 原文参考：[搞软件开发，如果你不会用Git，可能会被这个时代淘汰](https://mp.weixin.qq.com/s/VHksvxYn1EArOF8h7u96Tw)
