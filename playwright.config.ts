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
  },
})
