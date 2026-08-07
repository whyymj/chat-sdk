<script setup lang="ts">
/**
 * RAG 异步文档 demo:
 * - memory 传异步函数,首次对话前后台加载知识库文档
 * - 演示切换知识库(setMemory 换异步函数)+ 强制刷新(refreshMemory)
 * - 演示同步函数 source 读运行时变量
 *
 * 知识库文档为内联 mock(无真实 fetch 依赖),实际使用时替换为 fetch('/kb/xxx.md')。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 三个 mock 知识库(实际用 fetch('/kb/faq.md') 等替换)
const KB = {
  faq: `## 产品 FAQ
- 价格:基础版 ¥99/月,专业版 ¥299/月,企业版联系销售
- 退款:购买 7 天内无理由退款,联系 support@example.com
- 限制:基础版最多 3 个项目,专业版不限
- 数据导出:支持 JSON / CSV 导出,在「设置 → 数据」操作`,
  product: `## 产品规格 v2
- 型号:PageAgent Pro
- CPU:8 核 / 内存 16GB / 存储 512GB SSD
- 接口:HDMI 2.1 × 2,USB-C × 3,千兆网口
- 系统:预装 Agent OS 2.0,支持远程升级`,
  guide: `## 使用指南
- 首次开机:长按电源键 3 秒,指示灯变绿后松手
- 连接网络:设置 → 网络 → 选择 WiFi → 输入密码
- 绑定账号:打开「我的 → 绑定」,扫码登录
- 故障排查:指示灯红色 = 过热,请关机冷却后重启`,
}

const currentKb = ref<keyof typeof KB>('faq')
const loadStatus = ref<'loading' | 'ready' | 'error'>('loading')
const lastLoaded = ref('')

// 模拟异步加载(实际替换为 fetch)
function loadKb(name: keyof typeof KB): () => Promise<string> {
  return async () => {
    await new Promise((r) => setTimeout(r, 400)) // 模拟网络延迟
    return KB[name]
  }
}

onMounted(() => {
  agent = createChatSdk({
    id: 'rag-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是知识库问答助手。只依据 memory 中的资料作答,资料未覆盖就说「知识库中未提及」。回答时引用资料来源段落。',
    storage: 'memory',
    // memory 传异步函数:后台预求值,首次对话前尽量就绪
    memory: async () => {
      loadStatus.value = 'loading'
      try {
        const text = await loadKb(currentKb.value)()
        lastLoaded.value = text
        loadStatus.value = 'ready'
        return text
      } catch (e) {
        loadStatus.value = 'error'
        return ''
      }
    },
    dialog: {
      title: 'RAG 知识库问答',
      placeholder: '问我关于产品的问题...',
    },
  })
  agent.mount('#chat-root')
})

onUnmounted(() => agent?.unmount())

function switchKb(name: keyof typeof KB) {
  currentKb.value = name
  // setMemory 传新的异步函数:清缓存 + 后台重新求值
  agent?.setMemory(loadKb(name))
  // 也可显式 await refresh 强制刷新(此处后台触发即可,UI 状态由 memory 函数内部更新)
  void agent?.refreshMemory().then((text) => {
    lastLoaded.value = text
    loadStatus.value = 'ready'
  })
  loadStatus.value = 'loading'
}
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>RAG 异步文档问答</h1>
    <p>memory 支持异步函数:首次对话前后台加载知识库,加载完成后 agent 自动可用。</p>

    <div class="kb-switcher">
      <span class="label">当前知识库:</span>
      <button
        v-for="name in (['faq', 'product', 'guide'] as const)"
        :key="name"
        :class="['kb-btn', { active: currentKb === name }]"
        @click="switchKb(name)"
      >
        {{ name }}
      </button>
      <span class="status" :data-status="loadStatus">
        {{ loadStatus === 'loading' ? '加载中…' : loadStatus === 'ready' ? '已就绪' : '加载失败' }}
      </span>
    </div>

    <details class="kb-preview">
      <summary>查看当前 memory 内容(已加载的文档)</summary>
      <pre>{{ lastLoaded || '(尚未加载)' }}</pre>
    </details>

    <section id="chat-root" ref="root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 80px auto 0;
  padding: 0 20px;
  font-family: system-ui, sans-serif;
  color: var(--ark-fg);
}
h1 {
  font-size: 24px;
  margin-bottom: 12px;
}
p {
  line-height: 1.6;
  color: var(--ark-muted);
  margin-bottom: 16px;
}
.kb-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.label {
  font-size: 14px;
  color: var(--ark-muted);
}
.kb-btn {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--ark-panel);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ark-fg);
}
.kb-btn.active {
  background: var(--ark-accent);
  color: #fff;
  border-color: var(--ark-accent);
}
.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--ark-panel);
  color: var(--ark-muted);
}
.status[data-status='ready'] {
  color: #16a34a;
  background: #dcfce7;
}
.status[data-status='loading'] {
  color: #2563eb;
  background: #dbeafe;
}
.status[data-status='error'] {
  color: #dc2626;
  background: #fee2e2;
}
.kb-preview {
  margin-bottom: 16px;
}
.kb-preview summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--ark-muted);
}
.kb-preview pre {
  margin-top: 8px;
  padding: 12px;
  background: var(--ark-bg);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  color: var(--ark-fg);
}
.chat-mount {
  margin-top: 24px;
  height: 600px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}
.chat-mount > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
