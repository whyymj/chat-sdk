<script setup lang="ts">
/**
 * 开发期导航胶囊 —— 在各 demo 页之间快速跳转(仅 dev 用,不影响 SDK 产物)。
 * 固定左上角浮动,当前页高亮。纯客户端,基于 location.pathname 判定。
 */
const LINKS = [
  { href: '/', label: '页面构建', match: (p: string) => p === '/' || p === '/index.html' },
  { href: '/subagent.html', label: '子 Agent', match: (p: string) => p.startsWith('/subagent') },
  { href: '/toolsets.html', label: '工具分离', match: (p: string) => p.startsWith('/toolsets') },
  { href: '/nested.html', label: '嵌套树', match: (p: string) => p.startsWith('/nested') },
  { href: '/human-confirm.html', label: '人工确认', match: (p: string) => p.startsWith('/human-confirm') },
  { href: '/planner.html', label: '规划反思', match: (p: string) => p.startsWith('/planner') },
  { href: '/mcp.html', label: 'MCP', match: (p: string) => p.startsWith('/mcp') },
  { href: '/demo/plain.html', label: 'CDN', match: (p: string) => p.includes('plain') },
]
const path = typeof location !== 'undefined' ? location.pathname : ''
</script>

<template>
  <nav class="dev-nav" aria-label="demo 导航">
    <span class="dev-nav__brand">🧪 demos</span>
    <a
      v-for="l in LINKS"
      :key="l.href"
      :href="l.href"
      class="dev-nav__link"
      :class="{ active: l.match(path) }"
    >{{ l.label }}</a>
  </nav>
</template>

<style scoped>
.dev-nav {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(31, 41, 55, 0.92);
  backdrop-filter: blur(6px);
  padding: 5px 6px;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  font-size: 12px;
  line-height: 1;
  user-select: none;
}
.dev-nav__brand {
  color: #e5e7eb;
  padding: 0 8px 0 4px;
  border-right: 1px solid rgba(255, 255, 255, 0.15);
  margin-right: 4px;
  white-space: nowrap;
}
.dev-nav__link {
  color: #d1d5db;
  text-decoration: none;
  padding: 5px 10px;
  border-radius: 999px;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.dev-nav__link:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.dev-nav__link.active {
  background: #6366f1;
  color: #fff;
  font-weight: 600;
}
</style>
