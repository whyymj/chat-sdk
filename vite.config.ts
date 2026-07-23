import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  publicDir: false, // 库构建不含 public 静态资源(避免 vite.svg 进发布产物)
  build: {
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      name: 'PageAgent',
      fileName: 'page-agent',
    },
    rollupOptions: {
      // vue 打包进 SDK(框架无关);zod / @langchain/* 保持 external(peerDep)
      external: ['zod', /^@langchain\//],
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
  server: {
    port: 3000,
    open: true,
  },
})
