import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ZhuantiAgent',
      fileName: 'zhuanti-agent',
    },
    rollupOptions: {
      external: ['vue', 'langchain', /^@langchain\//],
      output: {
        exports: 'named',
        globals: {
          vue: 'Vue',
          '@langchain/openai': 'LangchainOpenAI',
          '@langchain/core/messages': 'LangchainCoreMessages',
          langchain: 'Langchain',
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
