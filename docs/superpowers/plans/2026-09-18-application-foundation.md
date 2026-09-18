# MCPDevBench Application Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, packaged Electron Forge application with a Vue 3 renderer, runtime-validated typed IPC, and automated tests proving the desktop shell works.

**Architecture:** Electron's main process owns all privileged capabilities and exposes one narrow health query through a sandboxed preload bridge. The Vue renderer consumes only shared application contracts; a small service and adapter boundary keeps Electron details out of the UI and establishes the structure later MCP services will follow.

**Tech Stack:** Electron, Electron Forge, Vite, TypeScript, Vue 3, Vue Router, Pinia, Zod, Vitest, Vue Test Utils, Playwright, npm

**Spec:** `docs/superpowers/specs/2026-09-18-mcpdevbench-v0.1-design.md`

## Global Constraints

- Use Electron Forge for development, packaging, installers, signing, and publishing.
- Use Electron Forge's Vite TypeScript plugin and pin every direct dependency with `--save-exact`.
- Use TypeScript in the main, preload, renderer, and shared source trees.
- Use Vue 3 Composition API with `<script setup>`.
- Use npm and commit `package-lock.json`.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Do not expose Electron, Node.js, filesystem, process, or generic IPC primitives to the renderer.
- Do not add the MCP SDK, SQLite, persistence, or secret storage in this foundation plan.
- Preserve the existing `docs/` tree and untracked `docs/prd.md`.
- Run on Node.js 24.13.1 or a compatible active LTS version.

## Planned File Structure

```text
.
├── forge.config.ts                 Forge packaging and Vite plugin configuration
├── index.html                      Renderer HTML entry
├── package.json                    Scripts and pinned direct dependencies
├── package-lock.json               Resolved dependency graph
├── playwright.config.ts            Electron end-to-end test defaults
├── tsconfig.json                   Shared strict TypeScript settings
├── tsconfig.main.json              Main and preload type-checking boundary
├── tsconfig.renderer.json          Vue renderer type-checking boundary
├── vite.main.config.ts             Main-process bundle configuration
├── vite.preload.config.ts          Sandboxed preload bundle configuration
├── vite.renderer.config.ts         Vue renderer bundle configuration
├── vitest.config.ts                Unit/component test configuration
├── src/
│   ├── main/
│   │   ├── app/create-main-window.ts  Secure BrowserWindow construction
│   │   ├── app/lifecycle.ts           Electron lifecycle orchestration
│   │   ├── health/get-health.ts       Foundation health service
│   │   ├── ipc/register-health-ipc.ts Validated health IPC handler
│   │   └── index.ts                   Main-process entry
│   ├── preload/api.ts              Narrow contextBridge API
│   ├── renderer/
│   │   ├── app/App.vue             Application shell
│   │   ├── app/main.ts             Vue bootstrap
│   │   ├── app/router.ts           Feature routes
│   │   ├── app/styles.css          Global visual tokens and shell styles
│   │   ├── env.d.ts                Vue and preload global types
│   │   └── features/dashboard/DashboardView.vue  First usable screen
│   └── shared/
│       ├── contracts/health.ts     Runtime and TypeScript health contract
│       └── domain/health.ts        Transport-neutral health type
└── tests/
    ├── e2e/app.spec.ts             Packaged desktop smoke test
    ├── main/create-main-window.test.ts Security option regression test
    ├── main/get-health.test.ts      Health service unit test
    ├── renderer/App.test.ts         Vue shell component test
    └── setup/renderer.ts            DOM test setup
```

---

### Task 1: Establish The Electron Forge And TypeScript Build

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `forge.config.ts`
- Create: `vite.main.config.ts`
- Create: `vite.preload.config.ts`
- Create: `vite.renderer.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `tsconfig.renderer.json`
- Create: `index.html`
- Create: `.gitignore`

**Interfaces:**
- Consumes: Existing repository and `docs/` tree.
- Produces: `npm start`, `npm run typecheck`, `npm test`, `npm run package`, and `npm run make`; Forge globals `MAIN_WINDOW_VITE_DEV_SERVER_URL` and `MAIN_WINDOW_VITE_NAME` for Task 3.

- [ ] **Step 1: Initialize npm metadata without replacing existing files**

Run:

```bash
npm init -y
npm pkg set name=mcpdevbench productName=MCPDevBench version=0.1.0 main=.vite/build/main.js
npm pkg set private=true --json
npm pkg set scripts.start="electron-forge start" scripts.package="electron-forge package" scripts.make="electron-forge make" scripts.typecheck="vue-tsc --noEmit -p tsconfig.renderer.json && tsc --noEmit -p tsconfig.main.json" scripts.test="vitest run" scripts.test:watch="vitest" scripts.test:e2e="playwright test"
```

Expected: `package.json` contains the named scripts and `docs/` remains untouched.

- [ ] **Step 2: Install exact runtime and development dependencies**

Run:

```bash
npm install --save-exact vue vue-router pinia zod
npm install --save-dev --save-exact electron @electron-forge/cli @electron-forge/plugin-vite @electron-forge/maker-zip @electron-forge/maker-squirrel @electron-forge/maker-deb @electron-forge/maker-rpm vite @vitejs/plugin-vue typescript@5.9.3 vue-tsc vitest jsdom @vue/test-utils @playwright/test
```

Expected: direct dependency versions contain no `^` or `~`, and `package-lock.json` exists.

- [ ] **Step 3: Add strict TypeScript project configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useDefineForClassFields": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

Create `tsconfig.main.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node", "electron"]
  },
  "include": ["src/main/**/*.ts", "src/preload/**/*.ts", "src/shared/**/*.ts", "forge.config.ts", "vite.*.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

Create `tsconfig.renderer.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/renderer/**/*.ts", "src/renderer/**/*.vue", "src/shared/**/*.ts", "tests/renderer/**/*.ts", "tests/setup/**/*.ts"]
}
```

- [ ] **Step 4: Configure Forge, Vite, and the renderer entry**

Create `forge.config.ts` with ASAR packaging, platform makers, and one Vite main/preload/renderer pipeline:

```ts
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: { asar: true },
  rebuildConfig: {},
  makers: [new MakerSquirrel({}), new MakerZIP({}, ['darwin']), new MakerDeb({}), new MakerRpm({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/api.ts', config: 'vite.preload.config.ts' }
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }]
    })
  ]
};

export default config;
```

Create `vite.main.config.ts` and `vite.preload.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({ resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } });
```

Create `vite.renderer.config.ts`:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } }
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MCPDevBench</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/renderer/app/main.ts"></script>
  </body>
</html>
```

Create `.gitignore`:

```gitignore
node_modules/
.vite/
out/
coverage/
test-results/
playwright-report/
*.log
.DS_Store
```

- [ ] **Step 5: Verify configuration parsing**

Run:

```bash
npm run typecheck
```

Expected: FAIL only because application entry files from later tasks do not exist yet; no JSON or Forge configuration error.

- [ ] **Step 6: Commit the build foundation**

```bash
git add .gitignore package.json package-lock.json forge.config.ts vite.main.config.ts vite.preload.config.ts vite.renderer.config.ts tsconfig.json tsconfig.main.json tsconfig.renderer.json index.html
git commit -m "build: configure Electron Forge and Vue toolchain"
```

### Task 2: Define And Test The First Shared Service Contract

**Files:**
- Create: `src/shared/domain/health.ts`
- Create: `src/shared/contracts/health.ts`
- Create: `src/main/health/get-health.ts`
- Create: `tests/main/get-health.test.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: Zod and Vitest from Task 1.
- Produces: `HealthStatus`, `healthStatusSchema`, `healthChannels.get`, and `getHealth(): HealthStatus` for Tasks 3 and 4.

- [ ] **Step 1: Write the failing health-service test**

Create `tests/main/get-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getHealth } from '@/main/health/get-health';
import { healthStatusSchema } from '@/shared/contracts/health';

describe('getHealth', () => {
  it('returns a contract-valid ready status', () => {
    const result = getHealth();
    expect(healthStatusSchema.parse(result)).toEqual({ status: 'ready', app: 'MCPDevBench' });
  });
});
```

Create `vitest.config.ts`:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { environment: 'node', environmentMatchGlobs: [['tests/renderer/**', 'jsdom']] }
});
```

- [ ] **Step 2: Run the test and verify the missing modules fail**

Run:

```bash
npm test -- tests/main/get-health.test.ts
```

Expected: FAIL because `get-health` and `health` contract modules do not exist.

- [ ] **Step 3: Implement the domain type, runtime schema, and service**

Create `src/shared/domain/health.ts`:

```ts
export type HealthStatus = { status: 'ready'; app: 'MCPDevBench' };
```

Create `src/shared/contracts/health.ts`:

```ts
import { z } from 'zod';
import type { HealthStatus } from '@/shared/domain/health';

export const healthChannels = { get: 'health:get' } as const;
export const healthStatusSchema = z.object({ status: z.literal('ready'), app: z.literal('MCPDevBench') });
export type HealthStatusContract = z.infer<typeof healthStatusSchema>;
const _contractMatchesDomain: HealthStatus = {} as HealthStatusContract;
void _contractMatchesDomain;
```

Create `src/main/health/get-health.ts`:

```ts
import type { HealthStatus } from '@/shared/domain/health';

export const getHealth = (): HealthStatus => ({ status: 'ready', app: 'MCPDevBench' });
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm test -- tests/main/get-health.test.ts
```

Expected: PASS with one test.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/shared src/main/health tests/main/get-health.test.ts vitest.config.ts
git commit -m "feat: add typed application health contract"
```

### Task 3: Add The Secure Main Process And Preload Bridge

**Files:**
- Create: `src/main/app/create-main-window.ts`
- Create: `src/main/app/lifecycle.ts`
- Create: `src/main/ipc/register-health-ipc.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/api.ts`
- Create: `tests/main/create-main-window.test.ts`

**Interfaces:**
- Consumes: `healthChannels.get`, `healthStatusSchema`, and `getHealth()` from Task 2; Forge globals from Task 1.
- Produces: `createMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions`, `registerHealthIpc()`, and `window.mcpdevbench.getHealth(): Promise<HealthStatusContract>`.

- [ ] **Step 1: Write the failing BrowserWindow security test**

Create `tests/main/create-main-window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from '@/main/app/create-main-window';

describe('createMainWindowOptions', () => {
  it('enforces renderer isolation', () => {
    const options = createMainWindowOptions('/tmp/preload.js');
    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/main/create-main-window.test.ts
```

Expected: FAIL because `create-main-window.ts` does not exist.

- [ ] **Step 3: Implement secure window options and creation**

Create `src/main/app/create-main-window.ts`:

```ts
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';

export const createMainWindowOptions = (preloadPath: string): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  backgroundColor: '#f5f6f7',
  show: false,
  webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true }
});

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow(createMainWindowOptions(path.join(__dirname, 'preload.js')));
  window.once('ready-to-show', () => window.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  return window;
};
```

- [ ] **Step 4: Add validated IPC registration and the preload API**

Create `src/main/ipc/register-health-ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { getHealth } from '@/main/health/get-health';
import { healthChannels, healthStatusSchema } from '@/shared/contracts/health';

export const registerHealthIpc = (): void => {
  ipcMain.handle(healthChannels.get, () => healthStatusSchema.parse(getHealth()));
};
```

Create `src/preload/api.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { healthChannels, healthStatusSchema, type HealthStatusContract } from '@/shared/contracts/health';

export type MCPDevBenchApi = { getHealth(): Promise<HealthStatusContract> };

const api: MCPDevBenchApi = {
  getHealth: async () => healthStatusSchema.parse(await ipcRenderer.invoke(healthChannels.get))
};

contextBridge.exposeInMainWorld('mcpdevbench', api);
```

- [ ] **Step 5: Add Electron lifecycle orchestration**

Create `src/main/app/lifecycle.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from '@/main/app/create-main-window';
import { registerHealthIpc } from '@/main/ipc/register-health-ipc';

export const startApplication = async (): Promise<void> => {
  await app.whenReady();
  registerHealthIpc();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
};
```

Create `src/main/index.ts`:

```ts
import { startApplication } from '@/main/app/lifecycle';

void startApplication();
```

- [ ] **Step 6: Run main-process tests and type checking**

Run:

```bash
npm test -- tests/main
npm run typecheck
```

Expected: main tests PASS. Type checking may still report missing renderer entry files, which Task 4 supplies; no main or preload errors remain.

- [ ] **Step 7: Commit the secure Electron boundary**

```bash
git add src/main src/preload tests/main
git commit -m "feat: add secure Electron process boundary"
```

### Task 4: Build The Vue Application Shell

**Files:**
- Create: `src/renderer/env.d.ts`
- Create: `src/renderer/app/main.ts`
- Create: `src/renderer/app/router.ts`
- Create: `src/renderer/app/App.vue`
- Create: `src/renderer/app/styles.css`
- Create: `src/renderer/features/dashboard/DashboardView.vue`
- Create: `tests/setup/renderer.ts`
- Create: `tests/renderer/App.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `window.mcpdevbench.getHealth()` from Task 3.
- Produces: A routable desktop shell and dashboard that visibly proves the main/preload/renderer path is ready.

- [ ] **Step 1: Declare the renderer's preload API type**

Create `src/renderer/env.d.ts`:

```ts
/// <reference types="vite/client" />

import type { MCPDevBenchApi } from '@/preload/api';

declare global {
  interface Window { mcpdevbench: MCPDevBenchApi }
}

export {};
```

- [ ] **Step 2: Write the failing application-shell test**

Create `tests/setup/renderer.ts`:

```ts
import { vi } from 'vitest';

Object.defineProperty(window, 'mcpdevbench', {
  configurable: true,
  value: { getHealth: vi.fn().mockResolvedValue({ status: 'ready', app: 'MCPDevBench' }) }
});
```

Update `vitest.config.ts` so renderer tests load the browser API stub:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    setupFiles: ['tests/setup/renderer.ts']
  }
});
```

Create `tests/renderer/App.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import App from '@/renderer/app/App.vue';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

describe('App', () => {
  it('shows the product identity and ready status', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }] });
    const wrapper = mount(App, { global: { plugins: [router] } });
    await router.isReady();
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('MCPDevBench');
    expect(wrapper.get('[data-testid="app-status"]').text()).toBe('Ready');
  });
});
```

- [ ] **Step 3: Run the test and verify the missing components fail**

Run:

```bash
npm test -- tests/renderer/App.test.ts
```

Expected: FAIL because `App.vue` and `DashboardView.vue` do not exist.

- [ ] **Step 4: Implement the router, dashboard, and application bootstrap**

Create `src/renderer/app/router.ts`:

```ts
import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

export const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: DashboardView }] });
```

Create `src/renderer/app/main.ts`:

```ts
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '@/renderer/app/App.vue';
import { router } from '@/renderer/app/router';
import '@/renderer/app/styles.css';

createApp(App).use(createPinia()).use(router).mount('#app');
```

Create `src/renderer/app/App.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';

const ready = ref(false);
onMounted(async () => { ready.value = (await window.mcpdevbench.getHealth()).status === 'ready'; });
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <h1>MCPDevBench</h1>
      <nav aria-label="Primary"><RouterLink to="/">Dashboard</RouterLink></nav>
    </aside>
    <main class="workspace">
      <div class="topbar"><span data-testid="app-status" class="status">{{ ready ? 'Ready' : 'Starting' }}</span></div>
      <RouterView />
    </main>
  </div>
</template>
```

Create `src/renderer/features/dashboard/DashboardView.vue`:

```vue
<template>
  <section class="dashboard">
    <header><p class="eyebrow">Workspace</p><h2>Servers</h2></header>
    <div class="empty-state">
      <h3>No servers configured</h3>
      <p>Add a local command or Streamable HTTP endpoint to begin.</p>
      <button type="button" disabled>Add server</button>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Add restrained desktop shell styling**

Create `src/renderer/app/styles.css` with explicit layout dimensions and a neutral operational palette:

```css
:root { color: #18212b; background: #f4f6f8; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-synthesis: none; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 960px; min-height: 640px; }
button, input { font: inherit; }
.app-shell { display: grid; grid-template-columns: 224px minmax(0, 1fr); min-height: 100vh; }
.sidebar { padding: 24px 16px; color: #f8fafc; background: #202831; }
.sidebar h1 { margin: 0 0 28px; font-size: 18px; letter-spacing: 0; }
.sidebar a { display: block; padding: 8px 10px; color: #dbe4ec; text-decoration: none; border-radius: 6px; }
.sidebar a.router-link-active { color: #10222d; background: #b8e1db; }
.workspace { min-width: 0; }
.topbar { display: flex; justify-content: flex-end; align-items: center; height: 56px; padding: 0 24px; border-bottom: 1px solid #d9e0e6; background: #fff; }
.status { color: #176b58; font-size: 13px; font-weight: 600; }
.dashboard { padding: 32px; }
.dashboard header { margin-bottom: 28px; }
.dashboard h2 { margin: 4px 0 0; font-size: 26px; letter-spacing: 0; }
.eyebrow { margin: 0; color: #5c6975; font-size: 12px; text-transform: uppercase; }
.empty-state { max-width: 560px; padding: 28px; border: 1px solid #d5dde4; border-radius: 8px; background: #fff; }
.empty-state h3 { margin: 0 0 8px; font-size: 17px; }
.empty-state p { margin: 0 0 20px; color: #5c6975; }
.empty-state button { padding: 8px 12px; border: 1px solid #aeb8c2; border-radius: 6px; }
```

- [ ] **Step 6: Run component tests and full type checking**

Run:

```bash
npm test -- tests/renderer/App.test.ts
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit the Vue shell**

```bash
git add src/renderer tests/renderer tests/setup vitest.config.ts
git commit -m "feat: add MCPDevBench desktop shell"
```

### Task 5: Verify Development, Packaging, And Electron Startup

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/app.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: The complete application from Tasks 1-4.
- Produces: Repeatable package and Electron smoke verification for later feature plans.

- [ ] **Step 1: Add the Electron end-to-end test**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: 'tests/e2e', timeout: 30_000, fullyParallel: false, workers: 1 });
```

Create `tests/e2e/app.spec.ts`:

```ts
import { _electron as electron, expect, test } from '@playwright/test';

test('launches a sandboxed MCPDevBench window', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'MCPDevBench' })).toBeVisible();
  await expect(page.getByTestId('app-status')).toHaveText('Ready');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await app.close();
});
```

- [ ] **Step 2: Build the Forge bundles without launching the UI**

Run:

```bash
npm run package
```

Expected: Forge exits successfully and creates an application under `out/` plus `.vite/build/main.js`.

- [ ] **Step 3: Run the Electron smoke test**

Run:

```bash
npm run test:e2e
```

Expected: PASS; the app title is visible, health is Ready, and `window.require` is unavailable.

- [ ] **Step 4: Run the full foundation verification suite**

Run:

```bash
npm run typecheck
npm test
npm run package
npm run test:e2e
```

Expected: every command exits with status 0.

- [ ] **Step 5: Commit end-to-end verification**

```bash
git add playwright.config.ts tests/e2e/app.spec.ts package.json package-lock.json
git commit -m "test: verify packaged Electron application"
```

## Completion Criteria

- `npm start` opens MCPDevBench with the Vue dashboard.
- The renderer reports `Ready` through the typed preload health API.
- The BrowserWindow security regression test proves isolation, disabled Node integration, and sandboxing.
- Unit and component tests pass.
- `npm run typecheck` passes.
- `npm run package` produces a launchable application.
- The Playwright Electron smoke test passes.
- Existing documentation remains unchanged except for this plan.
