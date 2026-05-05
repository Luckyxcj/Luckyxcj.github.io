# 块设备驱动 (blk-mq)

> **文档说明**：本文档基于 Linux 内核 blk-mq 文档及块设备驱动开发经验整理。

---

## 目录

1. [块设备基础](#1-块设备基础)
2. [blk-mq 框架](#2-blk-mq-框架)
3. [RAM Disk 实战](#3-ram-disk-实战)
4. [与字符设备的区别](#4-与字符设备的区别)
5. [常见问题](#5-常见问题)

---

## 1. 块设备基础

块设备与字符设备的关键区别在于 I/O 以固定大小的"块"为单位，支持随机访问和内核缓存。

```
块设备 I/O 栈 (Linux):

  用户空间
  ──────────────────────────
  VFS (虚拟文件系统)
  ├─ Page Cache (页缓存)
  ├─ 文件系统 (ext4/squashfs/...)
  ──────────────────────────
  Block Layer (通用块层)
  ├─ bio (Block I/O) 结构体
  ├─ I/O 调度器 (mq-deadline/kyber/bfq)
  ──────────────────────────
  块设备驱动 (blk-mq)
  ├─ request_queue
  ├─ tag_set (多队列标签集)
  ├─ hw_ctx (硬件队列)
  ──────────────────────────
  硬件 (NVMe/MMC/SATA/...)
```

| 特性 | 字符设备 | 块设备 |
|------|---------|--------|
| 访问方式 | 流式 (顺序) | 随机 (按块) |
| 缓冲 | 无 (直接) | 有 (Page Cache) |
| 最小 I/O 单元 | 1 字节 | 1 块 (512B/4KB) |
| 寻址 | 不支持 | 支持 (lseek) |
| 示例 | /dev/tty, /dev/gpio | /dev/mmcblk0, /dev/sda |

---

## 2. blk-mq 框架

blk-mq (Multi-Queue Block Layer) 是 Linux 3.13 引入的新块层框架，专为多核和高性能 SSD 优化。

```
blk-mq 架构:

  CPU 0  →  Software Queue 0  ──┐
  CPU 1  →  Software Queue 1  ──┤
  CPU 2  →  Software Queue 2  ──┼──→ Hardware Queue(s)
  CPU 3  →  Software Queue 3  ──┘      │
                                        ↓
                                    硬件 (NVMe)
  (每个 CPU 独立软件队列, 减少锁争用)
```

```c
// blk-mq 关键数据结构
#include <linux/blk-mq.h>

// 1. tag_set: 定义硬件队列数量 + 最大并发请求数
static struct blk_mq_tag_set tag_set = {
    .ops        = &my_queue_ops,
    .nr_hw_queues  = 1,           // 硬件队列数
    .queue_depth  = 64,            // 每队列最大并发请求
    .cmd_size     = sizeof(struct my_cmd),  // 每个 request 携带的私有数据
    .numa_node    = NUMA_NO_NODE,
};

// 2. queue_ops: blk-mq 操作回调
static struct blk_mq_ops my_queue_ops = {
    .queue_rq    = my_queue_rq,    // 核心: 执行 I/O 请求
    .init_request = my_init_cmd,   // 初始化 request 私有数据
    .timeout     = my_timeout,     // 超时处理
};

// 3. 硬件队列 (hw_ctx) 在 tag_set 分配时自动创建
```

---

## 3. RAM Disk 实战

```c
// 简单 RAM Disk (内存块设备) 驱动
#include <linux/module.h>
#include <linux/blkdev.h>
#include <linux/blk-mq.h>

#define RAMDISK_SIZE   (16 * 1024 * 1024)  // 16 MB
#define SECTOR_SIZE    512
#define RAMDISK_SECTORS (RAMDISK_SIZE / SECTOR_SIZE)

static uint8_t *ramdisk_buf;
static struct request_queue *queue;
static struct gendisk *disk;

// blk-mq 请求处理回调 (核心函数)
static blk_status_t ramdisk_queue_rq(struct blk_mq_hw_ctx *hctx,
                                     const struct blk_mq_queue_data *bd) {
    struct request *rq = bd->rq;
    struct bio_vec bvec;
    struct req_iterator iter;
    loff_t pos = blk_rq_pos(rq) * SECTOR_SIZE;  // 起始扇区 × 512

    blk_mq_start_request(rq);

    // 遍历 bio_vec 链, 完成数据拷贝
    rq_for_each_segment(bvec, rq, iter) {
        void *buf = page_address(bvec.bv_page) + bvec.bv_offset;
        unsigned len = bvec.bv_len;

        if (pos + len > RAMDISK_SIZE) {
            blk_mq_end_request(rq, BLK_STS_IOERR);
            return BLK_STS_IOERR;
        }

        if (rq_data_dir(rq) == WRITE) {
            memcpy(ramdisk_buf + pos, buf, len);  // 写入 RAM
        } else {
            memcpy(buf, ramdisk_buf + pos, len);  // 从 RAM 读
        }
        pos += len;
    }

    blk_mq_end_request(rq, BLK_STS_OK);
    return BLK_STS_OK;
}

// blk-mq 操作表
static struct blk_mq_ops ramdisk_mq_ops = {
    .queue_rq = ramdisk_queue_rq,
};

static int __init ramdisk_init(void) {
    // 1. 分配 RAM 缓冲区
    ramdisk_buf = kzalloc(RAMDISK_SIZE, GFP_KERNEL);
    if (!ramdisk_buf) return -ENOMEM;

    // 2. 配置 tag_set
    struct blk_mq_tag_set tag_set = {
        .ops = &ramdisk_mq_ops,
        .nr_hw_queues = 1,
        .queue_depth  = 64,
        .numa_node = NUMA_NO_NODE,
    };

    if (blk_mq_alloc_tag_set(&tag_set)) {
        kfree(ramdisk_buf);
        return -ENOMEM;
    }

    // 3. 创建请求队列
    queue = blk_mq_init_queue(&tag_set);
    if (IS_ERR(queue)) {
        blk_mq_free_tag_set(&tag_set);
        kfree(ramdisk_buf);
        return PTR_ERR(queue);
    }
    // 设置逻辑块大小
    blk_queue_logical_block_size(queue, SECTOR_SIZE);

    // 4. 创建 gendisk
    disk = alloc_disk(1);  // 1 个分区
    disk->major = 0;       // 自动分配 (或 register_blkdev)
    disk->first_minor = 0;
    disk->minors = 1;
    disk->fops = &ramdisk_fops;  // block_device_operations (open/release/ioctl)
    disk->private_data = NULL;
    disk->queue = queue;
    snprintf(disk->disk_name, DISK_NAME_LEN, "ramdisk");
    set_capacity(disk, RAMDISK_SECTORS);

    add_disk(disk);
    pr_info("ramdisk loaded: %d MB\n", RAMDISK_SIZE / (1024*1024));
    return 0;
}

static void __exit ramdisk_exit(void) {
    if (disk) {
        del_gendisk(disk);
        put_disk(disk);
    }
    if (queue) blk_cleanup_queue(queue);
    kfree(ramdisk_buf);
}

module_init(ramdisk_init);
module_exit(ramdisk_exit);
MODULE_LICENSE("GPL");
```

---

## 4. 与字符设备的区别

| 场景 | 推荐选择 |
|------|---------|
| 控制类 (GPIO, PWM, 配置) | 字符设备 + ioctl |
| 流式数据 (传感器, UART) | 字符设备 + read/write |
| 存储介质 (Flash, RAM, eMMC) | 块设备 |
| 大吞吐 DMA 数据 | 字符设备 + mmap |
| 需要文件系统支持 | 块设备 |

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 块设备注册后不出现 /dev 节点 | udev 未触发 | 手动 `mknod /dev/xxx b <major> <minor>` |
| 2 | `blk_mq_init_queue` 失败 | tag_set 配置错误 | 确认 `nr_hw_queues ≥ 1, queue_depth ≥ 1` |
| 3 | 写数据后读出不正确 | 缓冲未 flush 或读写偏移错误 | 检查 `blk_rq_pos(rq)` 和扇区/字节转换 |
| 4 | 大量 I/O 时卡死 | 请求队列满但未正确 `blk_mq_end_request` | 每个 request 必须 `blk_mq_end_request` |
| 5 | `gendisk` 没有分区表 | 未设置 `GENHD_FL_NO_PART` 时未调用分区扫描 | 添加 `GENHD_FL_NO_PART` (如果不需要分区) |
| 6 | 内核 panic `bio too big` | 请求超过设备容量 | 检查 `set_capacity` 是否正确; 边界检查 |

---

## 6. 参考文档

1. Linux Kernel 文档: `Documentation/block/blk-mq.rst`
2. "Linux Block Drivers: More Complex Than Expected" — Neil Brown (LCA 2018)
3. "Understanding Block Layer Multi-Queue" — Linux Plumbers Conference
4. LDD3 Chapter 16: Block Drivers
5. Linux Kernel 源码: `drivers/block/zram/` (zram 是最佳 blk-mq 参考实现)
