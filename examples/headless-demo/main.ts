// 用途:Headless 模式 —— ui:false 不渲染内置对话框,用 sdk.messages + sdk.send 自建极简 UI(原生 DOM)
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
