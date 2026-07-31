// 用途:代理连接 —— 防 apiKey 泄露(浏览器只持 userToken,代理注入真 key;需 npm run proxy:mock)
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
