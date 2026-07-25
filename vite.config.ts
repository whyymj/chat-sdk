import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  publicDir: false, // 库构建不含 public 静态资源(避免 vite.svg 进发布产物)
  build: {
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      name: 'ChatSdk',
      fileName: 'page-agent-sdk',
    },
    rollupOptions: {
      // vue 打包进 SDK(框架无关);zod / @langchain/* 保持 external(peerDep)
      external: ['zod', /^@langchain\//, /^@modelcontextprotocol\//],
      output: {
        exports: 'named',
        globals: {
          zod: 'Zod',
          '@langchain/openai': 'LangchainOpenAI',
          '@langchain/core/messages': 'LangchainCoreMessages',
          '@langchain/core/tools': 'LangchainCoreTools',
          '@langchain/textsplitters': 'LangchainTextsplitters',
        },
      },
    },
  },
  optimizeDeps: {
    // MCP SDK 经「动态 import 深子路径」加载(client/streamableHttp.js 等)。
    // 此处预声明 → vite 启动即预构建,避免 dev 首次访问时运行时才发现新依赖,
    // 导致首次 MCP 注入失败(表现为「注入 0 个工具」,reload 后才正常)。
    // 仅影响 dev/preview,不影响库构建(库构建 external 掉该包)。
    include: [
      '@modelcontextprotocol/sdk/client',
      '@modelcontextprotocol/sdk/client/streamableHttp.js',
      '@modelcontextprotocol/sdk/client/sse.js',
      '@modelcontextprotocol/sdk/client/websocket.js',
    ],
  },
  server: {
    port: 3000,
    open: true,
  },
})
