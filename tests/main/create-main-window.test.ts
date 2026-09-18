import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '@/main/app/create-main-window';

describe('createMainWindowOptions', () => {
  it('enforces renderer isolation', () => {
    const options = createMainWindowOptions('/tmp/preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});
