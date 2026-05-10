import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '嵌入式知识库',
  description: '嵌入式软件开发知识积累与分享',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],

  themeConfig: {
    search: {
      provider: 'local',
    },

    nav: [
      { text: '首页', link: '/' },
      { text: '架构', link: '/architecture/' },
      { text: 'RTOS', link: '/rtos/' },
      { text: 'Linux', link: '/linux/' },
      {
        text: '更多',
        items: [
          { text: '通信协议', link: '/protocols/' },
          { text: '外设驱动', link: '/peripherals/' },
          { text: '传感器', link: '/sensors/' },
          { text: '执行机构', link: '/actuators/' },
          { text: '算法', link: '/algorithms/' },
          { text: '工具链', link: '/tools/' },
        ],
      },
    ],

    sidebar: {
      '/architecture/': [
        {
          text: '系统架构',
          collapsed: false,
          items: [
            { text: '概览', link: '/architecture/' },
          ],
        },
        {
          text: 'MCU 选型',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/mcu-selection/' },
            { text: 'STM32 系列详解', link: '/architecture/mcu-selection/stm32-guide' },
            { text: '厂商对比', link: '/architecture/mcu-selection/vendor-comparison' },
          ],
        },
        {
          text: '中断系统',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/interrupt/' },
            { text: 'NVIC 深度解析', link: '/architecture/interrupt/nvic' },
            { text: '中断设计模式', link: '/architecture/interrupt/design-patterns' },
          ],
        },
        {
          text: '启动与 Bootloader',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/boot/' },
            { text: '启动文件分析', link: '/architecture/boot/startup' },
            { text: '自定义 Bootloader', link: '/architecture/boot/bootloader' },
          ],
        },
        {
          text: '内存管理',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/memory-management/' },
            { text: '链接脚本分析', link: '/architecture/memory-management/linker-script' },
            { text: '堆与栈管理', link: '/architecture/memory-management/heap-stack' },
          ],
        },
        {
          text: '时钟系统',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/clock/' },
            { text: '时钟配置实战', link: '/architecture/clock/configuration' },
          ],
        },
        {
          text: '电源管理',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/power-management/' },
            { text: '低功耗模式', link: '/architecture/power-management/low-power-modes' },
            { text: '功耗设计实践', link: '/architecture/power-management/design-practice' },
          ],
        },
        {
          text: '看门狗',
          collapsed: true,
          items: [
            { text: '概览', link: '/architecture/watchdog/' },
            { text: 'IWDG / WWDG 实战', link: '/architecture/watchdog/iwdg-wwdg' },
          ],
        },
      ],
      '/rtos/': [
        {
          text: 'RTOS',
          collapsed: false,
          items: [
            { text: '概览', link: '/rtos/' },
          ],
        },
        {
          text: 'FreeRTOS 任务调度',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/freertos-task-scheduling/' },
          ],
        },
        {
          text: 'IPC 通信',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/ipc/' },
          ],
        },
        {
          text: '软件定时器',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/software-timers/' },
          ],
        },
        {
          text: '事件与任务通知',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/events-notifications/' },
          ],
        },
        {
          text: '内存管理',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/memory-management/' },
          ],
        },
        {
          text: 'RT-Thread',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/rt-thread/' },
          ],
        },
        {
          text: '多核与 SMP',
          collapsed: true,
          items: [
            { text: '概览', link: '/rtos/multicore-smp/' },
          ],
        },
      ],
      '/linux/': [
        {
          text: '嵌入式 Linux',
          collapsed: false,
          items: [
            { text: '概览', link: '/linux/' },
          ],
        },
        {
          text: '内核裁剪与编译',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/kernel-build/' },
          ],
        },
        {
          text: '设备树开发',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/device-tree/' },
          ],
        },
        {
          text: '字符设备驱动',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/char-driver/' },
          ],
        },
        {
          text: '块设备驱动',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/block-driver/' },
          ],
        },
        {
          text: '文件系统构建',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/filesystem/' },
          ],
        },
        {
          text: 'Buildroot / Yocto',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/build-systems/' },
          ],
        },
        {
          text: 'U-Boot 移植',
          collapsed: true,
          items: [
            { text: '概览', link: '/linux/u-boot/' },
          ],
        },
      ],
      '/protocols/': [
        {
          text: '通信协议',
          collapsed: false,
          items: [
            { text: '概览', link: '/protocols/' },
          ],
        },
        {
          text: 'CAN 总线',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/can/' },
            { text: 'CAN 网络基础', link: '/protocols/can/basics' },
            { text: 'STM32 CAN 指南', link: '/protocols/can/stm32' },
            { text: '故障排查', link: '/protocols/can/troubleshooting' },
          ],
        },
        {
          text: 'Modbus',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/modbus/' },
          ],
        },
        {
          text: 'MQTT',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/mqtt/' },
          ],
        },
        {
          text: 'BLE 低功耗蓝牙',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/ble/' },
          ],
        },
        {
          text: 'LwIP 网络协议栈',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/lwip/' },
          ],
        },
        {
          text: 'USB 设备开发',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/usb/' },
          ],
        },
        {
          text: 'SPI / I2C / UART 对比',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/spi-i2c-uart/' },
          ],
        },
        {
          text: 'MCU 自定义通信协议',
          collapsed: true,
          items: [
            { text: '概览', link: '/protocols/custom-frame-protocol/' },
            { text: '转义协议', link: '/protocols/custom-frame-protocol/escape-protocol' },
            { text: 'ITLV 协议设计', link: '/protocols/custom-frame-protocol/itlv-protocol' },
            { text: '流式 vs 批量解析', link: '/protocols/custom-frame-protocol/stream-vs-batch-parsing' },
          ],
        },
      ],
      '/peripherals/': [
        {
          text: '外设驱动',
          collapsed: false,
          items: [
            { text: '概览', link: '/peripherals/' },
          ],
        },
        {
          text: 'GPIO',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/gpio/' },
            { text: '高级应用', link: '/peripherals/gpio/advanced' },
          ],
        },
        {
          text: 'UART',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/uart/' },
            { text: 'DMA-UART 实战', link: '/peripherals/uart/dma-uart' },
          ],
        },
        {
          text: 'I2C',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/i2c/' },
            { text: '故障排查', link: '/peripherals/i2c/troubleshooting' },
          ],
        },
        {
          text: 'SPI',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/spi/' },
          ],
        },
        {
          text: 'ADC / DAC',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/adc-dac/' },
          ],
        },
        {
          text: 'PWM',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/pwm/' },
          ],
        },
        {
          text: '定时器',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/timer/' },
          ],
        },
        {
          text: 'DMA',
          collapsed: true,
          items: [
            { text: '概览', link: '/peripherals/dma/' },
          ],
        },
      ],
      '/sensors/': [
        {
          text: '传感器',
          collapsed: false,
          items: [
            { text: '概览', link: '/sensors/' },
          ],
        },
        {
          text: '温湿度传感器',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/temp-humidity' },
          ],
        },
        {
          text: 'IMU 惯性测量',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/imu' },
          ],
        },
        {
          text: '超声波传感器',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/ultrasonic' },
          ],
        },
        {
          text: '激光雷达',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/lidar' },
          ],
        },
        {
          text: '摄像头',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/camera' },
          ],
        },
        {
          text: '红外与光电传感器',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/ir-opto' },
          ],
        },
        {
          text: '压力传感器',
          collapsed: true,
          items: [
            { text: '概览', link: '/sensors/pressure' },
          ],
        },
      ],
      '/actuators/': [
        {
          text: '执行机构',
          collapsed: false,
          items: [
            { text: '概览', link: '/actuators/' },
          ],
        },
        {
          text: '液压控制',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/hydraulic/' },
            { text: '比例阀技术说明', link: '/actuators/hydraulic/proportional-valve' },
          ],
        },
        {
          text: '直流有刷电机',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/dc-motor/' },
          ],
        },
        {
          text: '步进电机',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/stepper/' },
          ],
        },
        {
          text: '舵机',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/servo/' },
          ],
        },
        {
          text: 'BLDC / FOC',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/bldc/' },
          ],
        },
        {
          text: '电磁阀与继电器',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/solenoid-relay/' },
          ],
        },
        {
          text: '减速器选型',
          collapsed: true,
          items: [
            { text: '概览', link: '/actuators/reducer/' },
          ],
        },
      ],
      '/algorithms/': [
        {
          text: '算法',
          collapsed: false,
          items: [
            { text: '概览', link: '/algorithms/' },
          ],
        },
        {
          text: '数字滤波 (IIR / FIR)',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/digital-filters/' },
          ],
        },
        {
          text: '卡尔曼滤波',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/kalman/' },
          ],
        },
        {
          text: 'PID 控制算法',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/pid/' },
          ],
        },
        {
          text: '传感器融合',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/sensor-fusion/' },
          ],
        },
        {
          text: '信号处理 (FFT)',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/signal-processing/' },
          ],
        },
        {
          text: '运动控制算法',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/motion-control/' },
          ],
        },
        {
          text: 'CRC 与纠错码',
          collapsed: true,
          items: [
            { text: '概览', link: '/algorithms/crc/' },
          ],
        },
      ],
      '/tools/': [
        {
          text: '工具链与调试',
          collapsed: false,
          items: [
            { text: '概览', link: '/tools/' },
          ],
        },
        {
          text: 'JTAG / SWD 调试',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/jtag-swd' },
          ],
        },
        {
          text: '逻辑分析仪',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/logic-analyzer' },
          ],
        },
        {
          text: '示波器',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/oscilloscope' },
          ],
        },
        {
          text: '交叉编译工具链',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/cross-compile-toolchain' },
          ],
        },
        {
          text: 'Make / CMake',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/make-cmake' },
          ],
        },
        {
          text: '串口工具',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/serial-tools' },
          ],
        },
        {
          text: 'Git 工作流',
          collapsed: true,
          items: [
            { text: '概览', link: '/tools/git' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Luckyxcj' },
    ],

    footer: {
      message: '基于 VitePress 构建',
      copyright: `Copyright © ${new Date().getFullYear()} Luckyxcj`,
    },

    editLink: {
      pattern: 'https://github.com/Luckyxcj/Luckyxcj.github.io/edit/master/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '深色模式',
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    lineNumbers: true,
  },
})
