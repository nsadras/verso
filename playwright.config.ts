import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8011', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'uv run python -m uvicorn tests.browser_server:app --host 127.0.0.1 --port 8011',
    wait: { stderr: /Uvicorn running on/ },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
