<script setup lang="ts">
/**
 * 开发期导航 —— 收起态左上角圆按钮(不遮挡 demo 内容主体),悬停展开为左侧侧栏(176px,垂直全链接)。
 * 用纯 CSS :hover 控制(非 JS 状态),避免展开/收起 transition 期间 mouseenter/mouseleave 抖动闪烁。
 * 纯客户端,基于 location.pathname 判定当前页。仅 dev 用,不影响 SDK 产物。
 */
import { computed } from 'vue'

const LINKS = [
  { href: '/', label: '页面构建', match: (p: string) => p === '/' || p === '/index.html' },
  { href: '/examples/minimal-demo/', label: '最简集成', match: (p: string) => p.startsWith('/examples/minimal-demo') },
  { href: '/examples/rag-demo/', label: 'RAG 异步文档', match: (p: string) => p.startsWith('/examples/rag-demo') },
  { href: '/examples/headless-demo/', label: 'Headless', match: (p: string) => p.startsWith('/examples/headless-demo') },
  { href: '/examples/complex-demo/', label: '复杂页面', match: (p: string) => p.startsWith('/examples/complex-demo') },
  { href: '/examples/subagent-demo/', label: '子 Agent', match: (p: string) => p.startsWith('/examples/subagent-demo') },
  { href: '/examples/toolsets-demo/', label: '工具分离', match: (p: string) => p.startsWith('/examples/toolsets-demo') },
  { href: '/examples/nested-demo/', label: '嵌套树', match: (p: string) => p.startsWith('/examples/nested-demo') },
  { href: '/examples/dynamic-demo/', label: '动态注册', match: (p: string) => p.startsWith('/examples/dynamic-demo') },
  { href: '/examples/animation-demo/', label: '动画演示', match: (p: string) => p.startsWith('/examples/animation-demo') },
  { href: '/examples/multi-agent-demo/', label: '多 Agent', match: (p: string) => p.startsWith('/examples/multi-agent-demo') },
  { href: '/examples/session-history-demo/', label: '会话历史', match: (p: string) => p.startsWith('/examples/session-history-demo') },
  { href: '/examples/human-confirm-demo/', label: '人工确认', match: (p: string) => p.startsWith('/examples/human-confirm-demo') },
  { href: '/examples/planner-demo/', label: '规划反思', match: (p: string) => p.startsWith('/examples/planner-demo') },
  { href: '/examples/mcp-demo/', label: 'MCP', match: (p: string) => p.startsWith('/examples/mcp-demo') },
  { href: '/examples/proxy-demo/', label: '代理连接', match: (p: string) => p.startsWith('/examples/proxy-demo') },
  { href: '/examples/anthropic-demo/', label: 'Anthropic', match: (p: string) => p.startsWith('/examples/anthropic-demo') },
  { href: '/demo/plain.html', label: 'CDN', match: (p: string) => p.includes('plain') },
]
const path = typeof location !== 'undefined' ? location.pathname : ''
const current = computed(() => LINKS.find((l) => l.match(path)))
</script>

<template>
  <nav class="dev-nav" aria-label="demo 导航">
    <div class="dev-nav__brand">
      <span class="dev-nav__brand-icon">🧪</span>
      <span class="dev-nav__brand-label">demos</span>
    </div>
    <a
      v-for="l in LINKS"
      :key="l.href"
      :href="l.href"
      class="dev-nav__link"
      :class="{ active: l.match(path), current: current && l.href === current.href }"
      :title="l.label"
    >{{ l.label }}</a>
  </nav>
</template>

<style scoped>
/* 收起态:左上角小圆按钮(50×50,不遮挡内容);:hover 时浏览器稳定判定,transition 期间不抖动 */
.dev-nav {
  position: fixed; top: 10px; left: 10px; bottom: 10px;   /* 位置固定:top+bottom 始终拉伸,展开不切换 bottom → 盒模型稳定,hover 不抖 */
  width: 50px; max-height: 50px; overflow: hidden;   /* 收起 max-height 限到 50(圆按钮);展开释放到 100vh(可平滑过渡,无 height:auto 瞬变) */
  display: flex; flex-direction: column;
  background: linear-gradient(135deg, #8b7ff0, #6c5ce7 55%, #5a4bd6);   /* 收起:紫色渐变,深色背景上的精致醒目入口 */
  border: 1.5px solid rgba(255, 255, 255, 0.4); border-radius: 18px;   /* 18px 圆角(非 50% 整圆):角部歧义区小,hit-box 全程稳定不脱离 hover */
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 0 0 4px rgba(108, 92, 231, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.2);   /* 外光晕 + 顶部内高光,立体感 */
  z-index: 10002; font-size: 12px; line-height: 1.2; user-select: none;
  transition: width 0.2s ease 0.15s, max-height 0.2s ease 0.15s, border-radius 0.2s ease 0.15s, padding 0.2s ease 0.15s, box-shadow 0.2s ease 0.15s;   /* 收起方向 delay 0.15s:鼠标瞬间脱离不立即收起,防闪烁 */
}
/* 悬停展开:max-height 释放到满高(top+bottom 拉伸),侧栏转深灰链接可读;所有属性平滑过渡无瞬变 */
.dev-nav:hover {
  width: 176px; max-height: 100vh; border-radius: 12px; padding: 8px 6px;
  background: rgba(31, 41, 55, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  transition: width 0.2s ease, max-height 0.2s ease, border-radius 0.2s ease, padding 0.2s ease, box-shadow 0.2s ease;   /* 展开方向 delay 0:即时响应 */
}
.dev-nav__brand {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 50px; padding: 0; color: #e5e7eb; font-weight: 600; white-space: nowrap;
}
.dev-nav:hover .dev-nav__brand { justify-content: flex-start; height: auto; padding: 4px 8px 8px; }
.dev-nav__brand-icon { font-size: 18px; }
.dev-nav__brand-label { display: none; }   /* 收起:不占位,避免挤压 icon */
.dev-nav:hover .dev-nav__brand-label { display: inline; opacity: 0.7; }
.dev-nav__link {
  color: #d1d5db; text-decoration: none; padding: 7px 8px; border-radius: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background 0.15s, color 0.15s;
}
.dev-nav:not(:hover) .dev-nav__link { display: none; }   /* 收起:链接移出布局,避免被圆角裁剪变形 */
.dev-nav__link:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.dev-nav__link.active { background: #6366f1; color: #fff; font-weight: 600; }
</style>
