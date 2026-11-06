import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/ui', workers: 1, fullyParallel: false, timeout: 20000,
  reporter: [['list']], use: { baseURL: 'http://127.0.0.1:4318', headless: true, viewport: { width: 1440, height: 1050 }, trace: 'retain-on-failure' },
  // Builds first: the server only serves dist/, so without this the browser checks would pass against old code.
  webServer: [
    { command: 'npm run build && npm start', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: false, timeout: 60000, env: { PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', ALLOW_SANDBOX_DRAFTS: '0' } },
    { command: 'node test/sandbox-harness.mjs', url: 'http://127.0.0.1:4319/api/health', reuseExistingServer: false, timeout: 60000 },
  ],
});
