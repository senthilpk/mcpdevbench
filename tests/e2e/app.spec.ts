import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const fixturePath = resolve('tests/fixtures/mcp/catalog-server.mjs');

async function createUserDataDir(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), 'mcpdevbench-e2e-'));
}

test('discovers a real STDIO server and preserves its profile across restart', async () => {
  const userDataDir = await createUserDataDir();
  const launch = () => electron.launch({
    args: ['.vite/build/main.js'],
    env: { ...process.env, MCPDEVBENCH_E2E_USER_DATA: userDataDir },
  });

  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: 'MCPDevBench' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();

    await page.getByRole('button', { name: 'Add server' }).first().click();
    await page.getByLabel('Name').fill('Catalog Fixture');
    await page.getByLabel('Command').fill(process.execPath);
    await page.getByLabel('Arguments').fill(fixturePath);
    await page.getByRole('button', { name: 'Save server' }).click();

    const row = page.getByRole('row').filter({ hasText: 'Catalog Fixture' });
    await expect(row).toContainText('Idle');
    await row.getByRole('button', { name: 'Connect Catalog Fixture' }).click();
    await expect(row).toContainText('Connected');
    await expect(row).toContainText('2');
    await expect(row).toContainText('1 resources · 1 templates · 1 prompts');
    await row.getByRole('button', { name: 'Refresh Catalog Fixture' }).click();
    await expect(row).toContainText('Connected');
    await page.screenshot({ path: 'tests/e2e/screenshots/systems-light-1280x800.png', fullPage: true });

    await row.getByRole('button', { name: 'Disconnect Catalog Fixture' }).click();
    await expect(row).toContainText('Idle');
    await app.close();

    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 960, height: 640 });
    const restoredRow = page.getByRole('row').filter({ hasText: 'Catalog Fixture' });
    await expect(restoredRow).toContainText('Idle');
    await expect(restoredRow.getByRole('button', { name: 'Connect Catalog Fixture' })).toBeVisible();
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    await page.screenshot({ path: 'tests/e2e/screenshots/systems-light-960x640.png', fullPage: true });
  } finally {
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('supports keyboard navigation and sidebar collapse', async () => {
  const userDataDir = await createUserDataDir();
  const app = await electron.launch({
    args: ['.vite/build/main.js'],
    env: { ...process.env, MCPDEVBENCH_E2E_USER_DATA: userDataDir },
  });
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
    await rm(userDataDir, { recursive: true, force: true });
  }
});
