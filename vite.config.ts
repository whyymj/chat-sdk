import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/core/index.ts'),
      name: 'ZhuantiAgent',
      fileName: 'zhuanti-agent',
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
