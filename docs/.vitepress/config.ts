import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '个人知识库',
  description: '个人技术知识积累与分享',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],

  themeConfig: {
    // 搜索
    search: {
      provider: 'local',
    },

    // 顶部导航
    nav: [
      { text: '首页', link: '/' },
      { text: '前端', link: '/frontend/' },
      { text: '后端', link: '/backend/' },
      { text: '工具', link: '/tools/' },
      { text: '笔记', link: '/notes/' },
    ],

    // 侧边栏
    sidebar: {
      '/frontend/': [
        {
          text: '前端开发',
          collapsed: false,
          items: [
            { text: '概览', link: '/frontend/' },
          ],
        },
      ],
      '/backend/': [
        {
          text: '后端开发',
          collapsed: false,
          items: [
            { text: '概览', link: '/backend/' },
          ],
        },
      ],
      '/tools/': [
        {
          text: '工具与效率',
          collapsed: false,
          items: [
            { text: '概览', link: '/tools/' },
          ],
        },
      ],
      '/notes/': [
        {
          text: '阅读笔记',
          collapsed: false,
          items: [
            { text: '概览', link: '/notes/' },
          ],
        },
      ],
    },

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Luckyxcj' },
    ],

    // 页脚
    footer: {
      message: '基于 VitePress 构建',
      copyright: `Copyright © ${new Date().getFullYear()} Luckyxcj`,
    },

    // 编辑链接
    editLink: {
      pattern: 'https://github.com/Luckyxcj/Luckyxcj.github.io/edit/master/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    // 最后更新时间
    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short',
      },
    },

    // 大纲
    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    // 文档页脚
    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    // 返回顶部
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
