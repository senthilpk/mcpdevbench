import { _electron as electron, expect, test } from '@playwright/test';

test('launches a sandboxed MCPDevBench window', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  const page = await app.firstWindow();

  await expect(
    page.getByRole('heading', { name: 'MCPDevBench' }),
  ).toBeVisible();
  await expect(page.getByTestId('app-status')).toHaveText('Ready');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');

  await app.close();
});
