import { _electron as electron, expect, test } from '@playwright/test';

test('renders Systems Light at the standard desktop size', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: 'MCPDevBench' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Configured servers' })).toBeVisible();
    await page.screenshot({ path: 'tests/e2e/screenshots/systems-light-1280x800.png', fullPage: true });
  } finally {
    await app.close();
  }
});

test('remains usable at the minimum window size', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 960, height: 640 });
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Configured servers' })).toBeVisible();
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
    await page.screenshot({ path: 'tests/e2e/screenshots/systems-light-960x640.png', fullPage: true });
  } finally {
    await app.close();
  }
});

test('supports keyboard navigation and sidebar collapse', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  try {
    const page = await app.firstWindow();
    const trigger = page.getByRole('button', { name: 'Toggle navigation' });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(page.locator('[data-state="collapsed"]')).toBeVisible();
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  } finally {
    await app.close();
  }
});
