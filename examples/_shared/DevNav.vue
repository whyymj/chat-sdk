<script setup lang="ts">
/**
 * 开发期导航 —— 折叠下拉式(避免链接过多超长),固定左上角浮动。
 * 默认收起(仅显示 brand 按钮 + 当前页标签),hover/focus 展开完整列表;点击链接跳转。
 * 纯客户端,基于 location.pathname 判定当前页。仅 dev 用,不影响 SDK 产物。
 */
import { ref, computed } from 'vue'

const LINKS = [
  { href: '/', label: '页面构建', match: (p: string) => p === '/' || p === '/index.html' },
  { href: '/examples/complex-demo/', label: '复杂页面', match: (p: string) => p.startsWith('/examples/complex-demo') },
  { href: '/examples/subagent-demo/', label: '子 Agent', match: (p: string) => p.startsWith('/examples/subagent-demo') },
  { href: '/examples/toolsets-demo/', label: '工具分离', match: (p: string) => p.startsWith('/examples/toolsets-demo') },
  { href: '/examples/nested-demo/', label: '嵌套树', match: (p: string) => p.startsWith('/examples/nested-demo') },
  { href: '/examples/dynamic-demo/', label: '动态注册', match: (p: string) => p.startsWith('/examples/dynamic-demo') },
  { href: '/examples/animation-demo/', label: '动画演示', match: (p: string) => p.startsWith('/examples/animation-demo') },
  { href: '/examples/multi-agent-demo/', label: '多 Agent', match: (p: string) => p.startsWith('/examples/multi-agent-demo') },
  { href: '/examples/human-confirm-demo/', label: '人工确认', match: (p: string) => p.startsWith('/examples/human-confirm-demo') },
  { href: '/examples/planner-demo/', label: '规划反思', match: (p: string) => p.startsWith('/examples/planner-demo') },
  { href: '/examples/mcp-demo/', label: 'MCP', match: (p: string) => p.startsWith('/examples/mcp-demo') },
  { href: '/demo/plain.html', label: 'CDN', match: (p: string) => p.includes('plain') },
]
const path = typeof location !== 'undefined' ? location.pathname : ''
const open = ref(false)
const current = computed(() => LINKS.find((l) => l.match(path)))
</script>

<template>
  <nav
    class="dev-nav"
    :class="{ 'dev-nav--open': open }"
    aria-label="demo 导航"
    @mouseenter="open = true"
    @mouseleave="open = false"
  >
    <button class="dev-nav__trigger" :aria-expanded="open" @click="open = !open">
      <span class="dev-nav__brand">🧪 demos</span>
      <span v-if="current" class="dev-nav__current">{{ current.label }}</span>
      <span class="dev-nav__arrow" :class="{ 'dev-nav__arrow--up': open }">▾</span>
    </button>
    <div v-show="open" class="dev-nav__menu">
      <a
        v-for="l in LINKS"
        :key="l.href"
        :href="l.href"
        class="dev-nav__link"
        :class="{ active: l.match(path) }"
      >{{ l.label }}</a>
    </div>
  </nav>
</template>

<style scoped>
.dev-nav {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10002;
  font-size: 12px;
  line-height: 1;
  user-select: none;
}
.dev-nav__trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: rgba(31, 41, 55, 0.94);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e7eb;
  cursor: pointer;
  border-radius: 999px;
  font: inherit;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: background 0.15s;
}
.dev-nav__trigger:hover { background: rgba(31, 41, 55, 1); }
.dev-nav__brand {
  font-weight: 600;
  white-space: nowrap;
}
.dev-nav__current {
  color: #c7d2fe;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  white-space: nowrap;
}
.dev-nav__arrow {
  font-size: 10px;
  opacity: 0.7;
  transition: transform 0.18s;
}
.dev-nav__arrow--up { transform: rotate(180deg); }
/* 下拉菜单:小圆角矩形卡片,与 trigger 分离(有 4px 间距),更像标准下拉 */
.dev-nav__menu {
  margin-top: 4px;
  display: grid;
  grid-template-columns: repeat(4, auto);
  gap: 3px;
  padding: 8px;
  background: rgba(31, 41, 55, 0.96);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.dev-nav__link {
  color: #d1d5db;
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 6px;
  white-space: nowrap;
  text-align: center;
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
