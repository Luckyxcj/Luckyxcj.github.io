# 字符设备驱动

> **文档说明**：本文档基于 Linux 内核 LDD3 经典教材及实际字符设备驱动开发经验整理。

---

## 目录

1. [Linux 驱动模型基础](#1-linux-驱动模型基础)
2. [file_operations 详解](#2-file_operations-详解)
3. [中断与 IOCTL](#3-中断与-ioctl)
4. [mmap 零拷贝](#4-mmap-零拷贝)
5. [完整驱动模板](#5-完整驱动模板)
6. [常见问题](#6-常见问题)

---

## 1. Linux 驱动模型基础

Linux 将设备分为三大类：字符设备、块设备、网络设备。

```
设备驱动模型:

  用户空间:  应用程序 (open/read/write/ioctl/mmap/close)
  ─────────── 系统调用 ──────────────
  内核空间:
    字符设备驱动
    ├─ file_operations (操作函数表)
    ├─ cdev (字符设备结构体)
    ├─ device number (主设备号 + 次设备号)
    └─ /dev 节点 (udev 自动创建)
  ─────────── 硬件抽象 ──────────────
  硬件:      GPIO / UART / I2C / SPI / ...
```

```c
// 最简单的字符设备驱动
#include <linux/module.h>
#include <linux/fs.h>
#include <linux/cdev.h>
#include <linux/device.h>

#define DEVICE_NAME "mychardev"
#define CLASS_NAME  "mychar"

static int major_number;
static struct class *char_class = NULL;
static struct device *char_device = NULL;
static struct cdev my_cdev;

// open 实现
static int my_open(struct inode *inode, struct file *file) {
    pr_info("Device opened\n");
    return 0;
}

// release 实现
static int my_release(struct inode *inode, struct file *file) {
    pr_info("Device closed\n");
    return 0;
}

// read 实现
static ssize_t my_read(struct file *file, char __user *buf,
                       size_t len, loff_t *offset) {
    const char *msg = "Hello from kernel!\n";
    size_t msg_len = strlen(msg);

    if (*offset >= msg_len) return 0;  // EOF

    if (len > msg_len - *offset) len = msg_len - *offset;
    if (copy_to_user(buf, msg + *offset, len)) return -EFAULT;
    *offset += len;

    return len;
}

// file_operations 表
static struct file_operations my_fops = {
    .owner   = THIS_MODULE,
    .open    = my_open,
    .release = my_release,
    .read    = my_read,
};

static int __init my_init(void) {
    // 1. 分配主设备号
    major_number = register_chrdev(0, DEVICE_NAME, &my_fops);
    if (major_number < 0) {
        pr_err("Failed to register chrdev\n");
        return major_number;
    }

    // 2. 创建 device class
    char_class = class_create(CLASS_NAME);
    if (IS_ERR(char_class)) {
        unregister_chrdev(major_number, DEVICE_NAME);
        return PTR_ERR(char_class);
    }

    // 3. 创建 device (→ /dev/mychardev)
    char_device = device_create(char_class, NULL,
                                MKDEV(major_number, 0),
                                NULL, DEVICE_NAME);
    if (IS_ERR(char_device)) {
        class_destroy(char_class);
        unregister_chrdev(major_number, DEVICE_NAME);
        return PTR_ERR(char_device);
    }

    pr_info("mychardev loaded, major=%d\n", major_number);
    return 0;
}

static void __exit my_exit(void) {
    device_destroy(char_class, MKDEV(major_number, 0));
    class_destroy(char_class);
    unregister_chrdev(major_number, DEVICE_NAME);
    pr_info("mychardev unloaded\n");
}

module_init(my_init);
module_exit(my_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("Simple character device driver");
```

---

## 2. file_operations 详解

```c
struct file_operations {
    struct module *owner;

    // 基本操作
    int (*open)(struct inode *, struct file *);
    int (*release)(struct inode *, struct file *);
    ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);

    // 高级操作
    long (*unlocked_ioctl)(struct file *, unsigned int, unsigned long);
    long (*compat_ioctl)(struct file *, unsigned int, unsigned long);
    int (*mmap)(struct file *, struct vm_area_struct *);
    int (*flush)(struct file *, fl_owner_t id);

    // 非阻塞 I/O
    unsigned int (*poll)(struct file *, struct poll_table_struct *);

    // 异步通知
    int (*fasync)(int, struct file *, int);

    // 定位
    loff_t (*llseek)(struct file *, loff_t, int);
};
```

### write 实现

```c
#define BUF_SIZE  256
static char device_buf[BUF_SIZE];
static size_t buf_len = 0;

static ssize_t my_write(struct file *file, const char __user *buf,
                        size_t len, loff_t *offset) {
    if (len > BUF_SIZE) len = BUF_SIZE;

    if (copy_from_user(device_buf, buf, len)) {
        return -EFAULT;  // 用户空间指针无效
    }

    buf_len = len;
    pr_info("Wrote %zu bytes: %.*s\n", len, (int)len, device_buf);
    return len;
}
```

---

## 3. 中断与 IOCTL

```c
#include <linux/interrupt.h>
#include <linux/gpio.h>

static int irq_number;
static volatile int irq_count = 0;

// ISR (中断服务程序)
static irqreturn_t my_irq_handler(int irq, void *dev_id) {
    irq_count++;
    pr_info("IRQ %d triggered, count=%d\n", irq, irq_count);
    return IRQ_HANDLED;
}

// IOCTL 命令定义
#define MY_IOC_MAGIC  'k'
#define MY_IOC_GET_COUNT    _IOR(MY_IOC_MAGIC, 1, int)
#define MY_IOC_RESET_COUNT  _IO(MY_IOC_MAGIC, 2)
#define MY_IOC_SET_VALUE    _IOW(MY_IOC_MAGIC, 3, int)

static long my_ioctl(struct file *file, unsigned int cmd, unsigned long arg) {
    int value, ret = 0;

    switch (cmd) {
    case MY_IOC_GET_COUNT:
        ret = put_user(irq_count, (int __user *)arg);
        break;

    case MY_IOC_RESET_COUNT:
        irq_count = 0;
        break;

    case MY_IOC_SET_VALUE:
        ret = get_user(value, (int __user *)arg);
        if (ret == 0) {
            // 使用 value 控制硬件...
        }
        break;

    default:
        return -ENOTTY;  // 无效命令
    }
    return ret;
}

// 驱动初始化时注册中断
static int __init my_init(void) {
    // ... 注册字符设备 ...

    // 请求 GPIO 中断
    int gpio = 17;  // GPIO 17
    irq_number = gpio_to_irq(gpio);
    if (request_irq(irq_number, my_irq_handler,
                    IRQF_TRIGGER_RISING, "my_device", NULL)) {
        pr_err("Failed to request IRQ %d\n", irq_number);
        return -EIO;
    }

    return 0;
}

static void __exit my_exit(void) {
    free_irq(irq_number, NULL);
    // ...
}
```

---

## 4. mmap 零拷贝

```c
// mmap: 将内核缓冲区映射到用户空间, 避免 copy_to/from_user 的开销
// 适用于: 大吞吐量数据采集 (ADC/DMA 缓冲)

static int my_mmap(struct file *file, struct vm_area_struct *vma) {
    unsigned long pfn;
    unsigned long size = vma->vm_end - vma->vm_start;

    // dma_alloc_coherent 分配的物理连续内存
    pfn = virt_to_phys(dma_buffer) >> PAGE_SHIFT;

    // 设置 VMA 标志: 禁用 cache (对 DMA 缓冲很重要)
    vma->vm_page_prot = pgprot_noncached(vma->vm_page_prot);

    // 映射物理内存到用户空间
    if (remap_pfn_range(vma, vma->vm_start, pfn,
                        size, vma->vm_page_prot)) {
        return -EAGAIN;
    }

    return 0;
}

// 用户空间使用:
// fd = open("/dev/mychardev", O_RDWR);
// buf = mmap(NULL, BUF_SIZE, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
// 之后直接读写 buf, 无需系统调用!
```

---

## 5. 完整驱动模板

```c
// 完整 GPIO 控制驱动模板 (控制 LED)
#include <linux/module.h>
#include <linux/fs.h>
#include <linux/gpio.h>
#include <linux/device.h>
#include <linux/uaccess.h>

#define DRV_NAME  "gpio_led"
#define LED_GPIO  23

static dev_t dev_num;
static struct class *drv_class;
static struct device *drv_device;

static int led_open(struct inode *inode, struct file *file) { return 0; }
static int led_release(struct inode *inode, struct file *file) { return 0; }

static ssize_t led_read(struct file *file, char __user *buf,
                        size_t len, loff_t *off) {
    int val = gpio_get_value(LED_GPIO) ? '1' : '0';
    if (*off > 0) return 0;
    if (put_user(val, buf)) return -EFAULT;
    *off = 1;
    return 1;
}

static ssize_t led_write(struct file *file, const char __user *buf,
                         size_t len, loff_t *off) {
    char cmd;
    if (get_user(cmd, buf)) return -EFAULT;
    gpio_set_value(LED_GPIO, (cmd == '1') ? 1 : 0);
    return 1;
}

static const struct file_operations led_fops = {
    .owner   = THIS_MODULE,
    .open    = led_open,
    .release = led_release,
    .read    = led_read,
    .write   = led_write,
};

static int __init led_init(void) {
    int ret;

    ret = gpio_request(LED_GPIO, "led_gpio");
    if (ret) return ret;
    gpio_direction_output(LED_GPIO, 0);

    ret = alloc_chrdev_region(&dev_num, 0, 1, DRV_NAME);
    if (ret) goto err_gpio;

    drv_class = class_create(DRV_NAME);
    drv_device = device_create(drv_class, NULL, dev_num, NULL, DRV_NAME);
    return 0;

err_gpio:
    gpio_free(LED_GPIO);
    return ret;
}

static void __exit led_exit(void) {
    device_destroy(drv_class, dev_num);
    class_destroy(drv_class);
    unregister_chrdev_region(dev_num, 1);
    gpio_free(LED_GPIO);
}

module_init(led_init);
module_exit(led_exit);
MODULE_LICENSE("GPL");
```

---

## 6. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | `insmod` 失败 `Unknown symbol` | 依赖的导出符号未加载 | 先加载依赖模块; 使用 `modprobe` 自动解决 |
| 2 | `copy_to_user` 返回非 0 | 用户空间地址无效 | 使用 `access_ok()` 预先检查; 返回 -EFAULT |
| 3 | 中断频繁触发 (ISR 风暴) | 硬件未清除中断标志 | ISR 开头读/写状态寄存器清除中断 |
| 4 | `mmap` 后数据不对 | Cache 不一致 | 使用 `pgprot_noncached` 或 `dma_alloc_coherent` |
| 5 | `rmmod` 失败 `module is in use` | 进程仍持有设备引用 | `lsof /dev/xxx` 查看占用进程 |
| 6 | 内核 Oops/NULL pointer dereference | 访问未初始化的指针 | 检查所有 err 路径的资源释放 |
| 7 | 设备树 compatible 不匹配 | 驱动程序 compatible table 与 dts 不一致 | 确认驱动 `of_match_table` 与 dts `compatible` 匹配 |

---

## 7. 参考文档

1. "Linux Device Drivers" 3rd Ed. (LDD3) — Corbet, Rubini, Kroah-Hartman
2. Linux Kernel 源码: `Documentation/driver-model/`, `samples/`
3. "Linux Kernel Module Programming Guide" — https://sysprog21.github.io/lkmpg/
4. Bootlin 字符驱动培训资料: https://bootlin.com/doc/training/linux-kernel/
5. "Essential Linux Device Drivers" — Sreekrishnan Venkateswaran
