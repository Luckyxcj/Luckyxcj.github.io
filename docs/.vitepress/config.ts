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
      ],
      '/rtos/': [
        {
          text: 'RTOS',
          collapsed: false,
          items: [
            { text: '概览', link: '/rtos/' },
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
          collapsed: false,
          items: [
            { text: 'CAN 网络基础', link: '/protocols/can/basics' },
            { text: 'STM32 CAN 指南', link: '/protocols/can/stm32' },
            { text: '故障排查', link: '/protocols/can/troubleshooting' },
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
      ],
      '/sensors/': [
        {
          text: '传感器',
          collapsed: false,
          items: [
            { text: '概览', link: '/sensors/' },
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
      ],
      '/algorithms/': [
        {
          text: '算法',
          collapsed: false,
          items: [
            { text: '概览', link: '/algorithms/' },
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
