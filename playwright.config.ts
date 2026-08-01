import { defineConfig, devices } from '@playwright/test'
import { homedir } from 'os'
import { join } from 'path'

// 自动定位浏览器安装路径:优先 PLAYWRIGHT_BROWSERS_PATH,否则用默认缓存目录
// 避免 CI / 新机器需手动设 env
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(homedir(), 'Library', 'Caches', 'ms-playwright')

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // 注入假 apiKey/model:browser E2E 用 page.route 拦截 chat/completions 返回 mock SSE,
    // 但 ChatOpenAI 构造时若 apiKey 空(无 .env)会提前抛 "Missing credentials"(不发请求 → mock 无效);
    // 假值让构造通过,实际请求被 page.route 拦截,不连真 LLM
    env: { VITE_AI_API_KEY: 'sk-mock', VITE_AI_MODEL: 'gpt-3.5-turbo' },
  },
})
