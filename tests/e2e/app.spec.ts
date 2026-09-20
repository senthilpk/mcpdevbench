import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { startProtectedMcpFixture } from '../fixtures/oauth/protected-mcp-server.mjs';

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

/**
 * Reads back the URL `shell.openExternal` was stubbed to capture (see the `app.evaluate`
 * stub in the test below), polling because the real interactive OAuth cascade runs a real
 * probe connect + discovery round trip before the coordinator ever calls it.
 */
async function waitForCapturedAuthorizationUrl(app: ElectronApplication): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const url = await app.evaluate(() => (globalThis as { __capturedAuthUrl?: string }).__capturedAuthUrl);
    if (url) return url;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('shell.openExternal was never called with an authorization URL');
}

/**
 * Drives the captured authorization URL exactly like the integration test's `driveBrowser`
 * (see tests/main/oauth-connection.integration.test.ts) -- plain loopback HTTP requests from
 * the TEST process, never a real OS browser. `Connection: close` avoids the same keep-alive
 * pooling hazard documented there.
 */
async function driveBrowserForE2e(authorizationUrl: string): Promise<void> {
  const fetchUrl = new URL(authorizationUrl);
  fetchUrl.protocol = 'http:';
  const authorizeResponse = await fetch(fetchUrl, { redirect: 'manual', headers: { Connection: 'close' } });
  if (authorizeResponse.status < 300 || authorizeResponse.status >= 400) {
    throw new Error(`fixture /authorize did not redirect (status ${authorizeResponse.status})`);
  }
  const location = authorizeResponse.headers.get('location');
  if (!location) throw new Error('fixture /authorize redirect is missing a Location header');
  const callbackResponse = await fetch(location, { redirect: 'manual', headers: { Connection: 'close' } });
  if (!callbackResponse.ok) {
    throw new Error(`loopback callback rejected the simulated browser redirect (status ${callbackResponse.status})`);
  }
}

test('completes SDK-native OAuth authorization through the real UI and signs out', async () => {
  const userDataDir = await createUserDataDir();
  const fixture = await startProtectedMcpFixture();
  const app = await electron.launch({
    args: ['.vite/build/main.js'],
    env: { ...process.env, MCPDEVBENCH_E2E_USER_DATA: userDataDir },
  });
  try {
    // Stub the system-browser boundary in the real Electron MAIN process -- never launches a
    // real OS browser. Captures the SDK-produced URL so the test can drive it itself.
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url: string) => {
        (globalThis as { __capturedAuthUrl?: string }).__capturedAuthUrl = url;
      };
    });

    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();

    await page.getByRole('button', { name: 'Add server' }).first().click();
    await page.getByLabel('Name').fill('Protected Fixture');
    await page.getByLabel('Transport').selectOption('streamable-http');
    await page.getByLabel('MCP endpoint URL').fill(fixture.resourceUrl);
    await page.getByRole('button', { name: 'Save server' }).click();

    const row = page.getByRole('row').filter({ hasText: 'Protected Fixture' });
    await expect(row).toContainText('Idle');
    await row.getByRole('button', { name: 'Connect Protected Fixture' }).click();

    await expect(row).toContainText('Waiting for browser');
    await expect(row.getByRole('button', { name: 'Open browser again for Protected Fixture' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Cancel authorization for Protected Fixture' })).toBeVisible();

    const authorizationUrl = await waitForCapturedAuthorizationUrl(app);
    expect(new URL(authorizationUrl).protocol).toBe('https:');
    await driveBrowserForE2e(authorizationUrl);

    await expect(row).toContainText('Connected');
    expect(fixture.discoveryHits.protectedResource).toBeGreaterThan(0);

    page.once('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: 'Sign out Protected Fixture' }).click();
    await expect(row).toContainText('Idle');
    await expect(row.getByRole('button', { name: 'Connect Protected Fixture' })).toBeVisible();

    expect(fixture.revocationCalls.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  } finally {
    await app.close();
    await fixture.close();
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
