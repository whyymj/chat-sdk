// 用途:RAG 异步文档集成 —— memory 支持异步函数,演示三种 RAG 形态:
//   1) 异步加载小文档注入 memory(本 demo 主线)
//   2) 切换知识库(setMemory 换异步函数 + refreshMemory 强制刷新)
//   3) 大文档走 VFS + vfs_grep 检索(见 doc/usage-guide.md §6.4 / §6.11)
import { createApp } from 'vue'
import App from './App.vue'
import '../_shared/theme.css'

createApp(App).mount('#app')
