# Systems Light Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaffold styling with a tested Systems Light application shell built from shadcn-vue primitives, semantic OKLCH tokens, and MCPDevBench-owned domain components.

**Architecture:** Tailwind CSS v4 and shadcn-vue provide source-owned interface primitives under `src/renderer/components/ui`. MCPDevBench shell and domain components consume those primitives and semantic tokens without leaking product concepts into the UI layer. The existing typed preload health API remains the only runtime dependency of the renderer.

**Tech Stack:** Electron Forge, Vue 3, TypeScript, Tailwind CSS v4, shadcn-vue, Reka UI, Lucide Vue, Inter Variable, JetBrains Mono Variable, Vitest, Vue Test Utils, Playwright

**Spec:** `docs/superpowers/specs/2026-09-19-systems-light-design-system.md`

## Global Constraints

- Use the Systems Light palette from the spec through semantic OKLCH tokens.
- Do not use black or green as a structural background.
- Green is limited to compact success text, icons, dots, and borders.
- Use shadcn-vue primitives only under `src/renderer/components/ui`.
- Keep MCP terminology and states under `src/renderer/components/domain`.
- Use Lucide Vue icons instead of hand-drawn SVGs.
- Package Inter Variable and JetBrains Mono Variable locally.
- Use a 4px base spacing unit, 6px controls, and an 8px maximum radius.
- Use borders and surface contrast for static hierarchy; reserve shadows for overlays.
- Keep all direct dependency versions exact and commit `package-lock.json`.
- Implement light theme only while consuming semantic tokens throughout.
- Preserve Electron's existing process isolation and typed preload boundary.
- Do not add server persistence, connection behavior, or fake IPC data.
- Keep the interface usable at 960 by 640 and 1280 by 800.
- Add `.superpowers/` to `.gitignore`; visual-companion artifacts remain local.

## Review Focus

- Health IPC rejection: the shell must settle on `Unavailable`, not remain on `Starting` or cause an unhandled rejection.
- Empty server collection: the table region must render an accessible empty state without dead controls.
- Mixed server states: connected, idle, degraded, and error must each have text or icons in addition to color.
- Minimum window size: navigation, toolbar, metrics, and server rows must not overlap or clip at 960 by 640.
- Keyboard operation: sidebar trigger, navigation, and available actions must have visible focus and logical tab order.

## Planned File Structure

```text
components.json
.npmrc
src/renderer/
  components/
    ui/                         shadcn-vue generated primitives
    domain/
      ApplicationStatus.vue
      ConnectionStatus.vue
      EmptyServerState.vue
      Metric.vue
      ServerTable.vue
    shell/
      AppSidebar.vue
      AppToolbar.vue
  features/dashboard/
    DashboardView.vue
    server-fixtures.ts
  lib/utils.ts                  shadcn-vue class merge utility
  styles/
    tokens.css
    base.css
  app/
    App.vue
    main.ts
tests/renderer/
  App.test.ts
  ApplicationStatus.test.ts
  ServerTable.test.ts
  DashboardView.test.ts
tests/e2e/
  app.spec.ts
  screenshots/
```

---

### Task 1: Install And Configure The shadcn-vue Foundation

**Files:**
- Create: `.npmrc`
- Create: `components.json`
- Create: `src/renderer/lib/utils.ts`
- Create: `src/renderer/components/ui/**`
- Create: `src/renderer/styles/tokens.css`
- Create: `src/renderer/styles/base.css`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.renderer.config.mts`
- Modify: `src/renderer/app/main.ts`
- Delete: `src/renderer/app/styles.css`

**Interfaces:**
- Consumes: Existing Vite renderer and `@/*` alias.
- Produces: Tailwind utilities, `cn(...inputs: ClassValue[]): string`, semantic design tokens, packaged fonts, and shadcn-vue primitive exports for later tasks.

- [ ] **Step 1: Pin npm generation and ignore local brainstorming artifacts**

Create `.npmrc`:

```ini
save-exact=true
```

Append to `.gitignore`:

```gitignore
.superpowers/
```

- [ ] **Step 2: Install the exact design-system dependencies**

Run:

```bash
npm install --save-exact reka-ui lucide-vue-next class-variance-authority clsx tailwind-merge @vueuse/core @fontsource-variable/inter @fontsource-variable/jetbrains-mono
npm install --save-dev --save-exact shadcn-vue tailwindcss @tailwindcss/vite tw-animate-css
```

Expected: all direct dependency values are exact versions without `^` or `~`.

- [ ] **Step 3: Configure Tailwind in the renderer build**

Update `vite.renderer.config.mts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue({}), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
```

- [ ] **Step 4: Create the shadcn-vue CLI configuration**

Create `components.json`:

```json
{
  "$schema": "https://shadcn-vue.com/schema.json",
  "style": "vega",
  "typescript": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/styles/base.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/renderer/components",
    "ui": "@/renderer/components/ui",
    "utils": "@/renderer/lib/utils",
    "lib": "@/renderer/lib",
    "composables": "@/renderer/composables"
  }
}
```

- [ ] **Step 5: Generate only the approved primitives**

Run:

```bash
npx shadcn-vue add -y button badge tooltip separator sidebar table empty skeleton
```

Expected: generated source is under `src/renderer/components/ui`; dependencies remain exact because `.npmrc` sets `save-exact=true`.

- [ ] **Step 6: Add Systems Light semantic tokens**

Create `src/renderer/styles/tokens.css`:

```css
:root {
  --radius: 0.375rem;
  --background: oklch(0.97 0.006 250);
  --foreground: oklch(0.25 0.018 255);
  --card: oklch(0.995 0.002 250);
  --card-foreground: oklch(0.25 0.018 255);
  --popover: oklch(0.995 0.002 250);
  --popover-foreground: oklch(0.25 0.018 255);
  --primary: oklch(0.52 0.19 264);
  --primary-foreground: oklch(0.985 0.003 250);
  --secondary: oklch(0.925 0.014 250);
  --secondary-foreground: oklch(0.31 0.025 255);
  --muted: oklch(0.94 0.008 250);
  --muted-foreground: oklch(0.50 0.018 250);
  --accent: oklch(0.90 0.025 255);
  --accent-foreground: oklch(0.29 0.04 258);
  --destructive: oklch(0.56 0.20 20);
  --border: oklch(0.86 0.014 250);
  --input: oklch(0.84 0.016 250);
  --ring: oklch(0.58 0.17 264);
  --success: oklch(0.53 0.13 163);
  --warning: oklch(0.68 0.15 70);
  --info: oklch(0.61 0.14 230);
  --sidebar: oklch(0.92 0.014 250);
  --sidebar-foreground: oklch(0.31 0.025 255);
  --sidebar-primary: oklch(0.52 0.19 264);
  --sidebar-primary-foreground: oklch(0.985 0.003 250);
  --sidebar-accent: oklch(0.875 0.025 255);
  --sidebar-accent-foreground: oklch(0.29 0.04 258);
  --sidebar-border: oklch(0.82 0.018 250);
  --sidebar-ring: oklch(0.58 0.17 264);
}

@theme inline {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: 0.5rem;
}
```

- [ ] **Step 7: Replace scaffold CSS with the Tailwind base**

Create `src/renderer/styles/base.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "./tokens.css";

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply bg-background font-sans text-foreground; }
  body { @apply m-0 min-h-screen min-w-[960px] bg-background text-sm antialiased; }
  button, input, textarea, select { font: inherit; }
  code, pre, kbd, samp { @apply font-mono; }
  ::selection { @apply bg-primary/15 text-foreground; }
  :focus-visible { @apply outline-2 outline-offset-2 outline-ring; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Update `src/renderer/app/main.ts` imports:

```ts
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@/renderer/styles/base.css';
```

Remove the old `@/renderer/app/styles.css` import and delete that file.

- [ ] **Step 8: Verify the generated foundation**

Run:

```bash
npm run typecheck
npm test
```

Expected: existing tests pass and generated components type-check.

- [ ] **Step 9: Commit the foundation**

```bash
git add .npmrc .gitignore components.json package.json package-lock.json vite.renderer.config.mts src/renderer/components/ui src/renderer/lib src/renderer/styles src/renderer/app/main.ts src/renderer/app/styles.css
git commit -m "build: add shadcn-vue design foundation"
```

### Task 2: Add Tested Application And Connection Status Components

**Files:**
- Create: `src/renderer/components/domain/ApplicationStatus.vue`
- Create: `src/renderer/components/domain/ConnectionStatus.vue`
- Create: `tests/renderer/ApplicationStatus.test.ts`
- Modify: `src/renderer/app/App.vue`
- Modify: `tests/renderer/App.test.ts`

**Interfaces:**
- Consumes: `Badge`, semantic `success`, `warning`, `destructive`, and `info` tokens.
- Produces: `ApplicationStatus` with `state: 'starting' | 'ready' | 'unavailable'`; `ConnectionStatus` with `state: 'connected' | 'idle' | 'degraded' | 'error'`.

- [ ] **Step 1: Write failing status tests**

Create `tests/renderer/ApplicationStatus.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ApplicationStatus from '@/renderer/components/domain/ApplicationStatus.vue';
import ConnectionStatus from '@/renderer/components/domain/ConnectionStatus.vue';

describe('ApplicationStatus', () => {
  it.each([
    ['starting', 'Starting'],
    ['ready', 'Ready'],
    ['unavailable', 'Unavailable'],
  ] as const)('labels the %s state', (state, label) => {
    const wrapper = mount(ApplicationStatus, { props: { state } });
    expect(wrapper.get('[role="status"]').text()).toContain(label);
  });
});

describe('ConnectionStatus', () => {
  it.each([
    ['connected', 'Connected'],
    ['idle', 'Idle'],
    ['degraded', 'Degraded'],
    ['error', 'Error'],
  ] as const)('communicates %s with text', (state, label) => {
    const wrapper = mount(ConnectionStatus, { props: { state } });
    expect(wrapper.text()).toContain(label);
  });
});
```

Update `tests/renderer/App.test.ts` with a health rejection case:

```ts
it('shows unavailable when the health query fails', async () => {
  vi.mocked(window.mcpdevbench.getHealth).mockRejectedValueOnce(new Error('offline'));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: DashboardView }] });
  const wrapper = mount(App, { global: { plugins: [router] } });
  await router.isReady();
  await flushPromises();
  expect(wrapper.get('[data-testid="app-status"]').text()).toContain('Unavailable');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- tests/renderer/ApplicationStatus.test.ts tests/renderer/App.test.ts
```

Expected: FAIL because the domain status components and unavailable state do not exist.

- [ ] **Step 3: Implement the status components**

`ApplicationStatus.vue` maps each state to visible text, a Lucide icon, and semantic foreground classes. `ConnectionStatus.vue` does the same for server state. Both use the shadcn-vue Badge primitive and `role="status"`; neither uses a saturated status background.

Use these exhaustive maps:

```ts
const applicationStates = {
  starting: { label: 'Starting', className: 'text-muted-foreground', icon: LoaderCircle },
  ready: { label: 'Ready', className: 'text-success', icon: CircleCheck },
  unavailable: { label: 'Unavailable', className: 'text-destructive', icon: CircleX },
} as const;

const connectionStates = {
  connected: { label: 'Connected', className: 'text-success', icon: CircleCheck },
  idle: { label: 'Idle', className: 'text-muted-foreground', icon: CirclePause },
  degraded: { label: 'Degraded', className: 'text-warning', icon: TriangleAlert },
  error: { label: 'Error', className: 'text-destructive', icon: CircleX },
} as const;
```

- [ ] **Step 4: Handle health failure in the application shell**

In `App.vue`, store `const applicationState = ref<ApplicationState>('starting')`, set it to `ready` on success and `unavailable` in `catch`, then render `<ApplicationStatus :state="applicationState" data-testid="app-status" />`.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
npm test -- tests/renderer/ApplicationStatus.test.ts tests/renderer/App.test.ts
npm run typecheck
```

Expected: all focused tests and type checking pass.

- [ ] **Step 6: Commit statuses**

```bash
git add src/renderer/components/domain/ApplicationStatus.vue src/renderer/components/domain/ConnectionStatus.vue src/renderer/app/App.vue tests/renderer/ApplicationStatus.test.ts tests/renderer/App.test.ts
git commit -m "feat: add accessible application statuses"
```

### Task 3: Add Tested Metrics And Server Table States

**Files:**
- Create: `src/renderer/components/domain/Metric.vue`
- Create: `src/renderer/components/domain/ServerTable.vue`
- Create: `src/renderer/components/domain/EmptyServerState.vue`
- Create: `src/renderer/features/dashboard/server-fixtures.ts`
- Create: `tests/renderer/ServerTable.test.ts`

**Interfaces:**
- Consumes: shadcn-vue Table, Empty, Button, and `ConnectionStatus`.
- Produces: `ServerSummary` and `ServerTable` with deterministic empty and populated states; `Metric` with label and value props.

- [ ] **Step 1: Write failing server-table tests**

Create `tests/renderer/ServerTable.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';

const servers = [
  { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected' as const },
  { id: 'search', name: 'Search MCP', transport: 'HTTP', tools: 8, state: 'idle' as const },
  { id: 'analytics', name: 'Analytics', transport: 'HTTP', tools: 4, state: 'degraded' as const },
  { id: 'broken', name: 'Broken Fixture', transport: 'STDIO', tools: 0, state: 'error' as const },
];

describe('ServerTable', () => {
  it('renders semantic headers and every server state', () => {
    const wrapper = mount(ServerTable, { props: { servers } });
    expect(wrapper.get('table').attributes('aria-label')).toBe('Configured servers');
    expect(wrapper.findAll('tbody tr')).toHaveLength(4);
    for (const label of ['Connected', 'Idle', 'Degraded', 'Error']) expect(wrapper.text()).toContain(label);
  });

  it('renders an accessible empty state without an active command', () => {
    const wrapper = mount(ServerTable, { props: { servers: [] } });
    expect(wrapper.get('[data-testid="empty-servers"]').text()).toContain('No servers configured');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/renderer/ServerTable.test.ts
```

Expected: FAIL because `ServerTable.vue` does not exist.

- [ ] **Step 3: Implement the server domain model and table**

Define and export:

```ts
export type ServerSummary = {
  id: string;
  name: string;
  transport: 'STDIO' | 'HTTP';
  tools: number;
  state: 'connected' | 'idle' | 'degraded' | 'error';
};
```

`ServerTable.vue` renders the shadcn-vue Table primitives with Server, Transport, Tools, and Status headers. It renders `EmptyServerState` when `servers.length === 0`. Server names are ordinary text because navigation is not implemented.

`Metric.vue` renders an unframed label/value pair with stable minimum dimensions. `EmptyServerState.vue` uses the Empty primitive, Server icon, and no button.

- [ ] **Step 4: Add representative fixtures**

Create `server-fixtures.ts` exporting the exact four records from the test as `demonstrationServers: ServerSummary[]` and three metrics: connected `1`, tools `24`, tests `18`. Add a comment stating the data is visual demonstration data, not runtime state.

- [ ] **Step 5: Run tests and type checking**

Run:

```bash
npm test -- tests/renderer/ServerTable.test.ts
npm run typecheck
```

Expected: tests and type checking pass.

- [ ] **Step 6: Commit the dashboard domain components**

```bash
git add src/renderer/components/domain src/renderer/features/dashboard/server-fixtures.ts tests/renderer/ServerTable.test.ts
git commit -m "feat: add server dashboard components"
```

### Task 4: Compose The Systems Light Shell And Dashboard

**Files:**
- Create: `src/renderer/components/shell/AppSidebar.vue`
- Create: `src/renderer/components/shell/AppToolbar.vue`
- Modify: `src/renderer/app/App.vue`
- Modify: `src/renderer/features/dashboard/DashboardView.vue`
- Create: `tests/renderer/DashboardView.test.ts`
- Modify: `tests/renderer/App.test.ts`

**Interfaces:**
- Consumes: shadcn-vue Sidebar, Button, Tooltip, Separator; domain statuses, metrics, table, and fixtures.
- Produces: The final Systems Light shell with one active Dashboard route, unavailable future destinations, collapsible navigation, and a compact dashboard.

- [ ] **Step 1: Write failing shell and dashboard tests**

Create `tests/renderer/DashboardView.test.ts`:

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DashboardView from '@/renderer/features/dashboard/DashboardView.vue';

describe('DashboardView', () => {
  it('renders metrics and demonstration servers', () => {
    const wrapper = mount(DashboardView);
    expect(wrapper.get('h2').text()).toBe('Servers');
    expect(wrapper.text()).toContain('24');
    expect(wrapper.text()).toContain('TVEyes Local');
  });

  it('marks Add server unavailable instead of exposing a dead action', () => {
    const wrapper = mount(DashboardView);
    const button = wrapper.get('button[disabled]');
    expect(button.attributes('aria-describedby')).toBe('add-server-unavailable');
    expect(wrapper.get('#add-server-unavailable').text()).toContain('available with connection setup');
  });
});
```

Extend `App.test.ts`:

```ts
expect(wrapper.get('nav[aria-label="Primary"]').text()).toContain('Servers');
expect(wrapper.get('[aria-current="page"]').text()).toContain('Servers');
expect(wrapper.get('button[aria-label="Toggle navigation"]').exists()).toBe(true);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
npm test -- tests/renderer/DashboardView.test.ts tests/renderer/App.test.ts
```

Expected: FAIL because the new shell and dashboard composition do not exist.

- [ ] **Step 3: Build the application sidebar**

`AppSidebar.vue` uses Sidebar Header, Content, Group, Menu, Footer, and Rail primitives. Use `Server`, `ScanSearch`, `SquareTerminal`, `Stethoscope`, `FlaskConical`, and `FileCode2` icons. Servers is the only active route and uses `aria-current="page"`; future items render disabled with `aria-disabled="true"` and do not use links.

- [ ] **Step 4: Build the toolbar and shell**

`AppToolbar.vue` uses a 56px border-bottom band with the Sidebar trigger labeled `Toggle navigation`, a Separator, breadcrumb text `Workspace / Servers`, and `ApplicationStatus` aligned to the end.

`App.vue` wraps the shell in `SidebarProvider`, renders `AppSidebar`, `SidebarInset`, `AppToolbar`, and `RouterView`. The workspace uses `min-w-0 overflow-auto`; no page-level card wraps the route.

- [ ] **Step 5: Build the operational dashboard**

`DashboardView.vue` renders:

- `Workspace` eyebrow and `Servers` heading.
- Disabled Add server Button with Plus icon and `aria-describedby="add-server-unavailable"`.
- Secondary disabled Run doctor control only if it has the same unavailable explanation.
- Three unframed Metric components.
- A full-width ServerTable with the demonstration fixtures.

Use constrained widths and grid tracks so content does not shift when statuses change.

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
npm test -- tests/renderer/DashboardView.test.ts tests/renderer/App.test.ts
npm test
npm run typecheck
```

Expected: all tests and type checking pass.

- [ ] **Step 7: Commit shell composition**

```bash
git add src/renderer/components/shell src/renderer/app/App.vue src/renderer/features/dashboard/DashboardView.vue tests/renderer/App.test.ts tests/renderer/DashboardView.test.ts
git commit -m "feat: apply Systems Light application shell"
```

### Task 5: Verify Desktop Layout And Package Integrity

**Files:**
- Modify: `tests/e2e/app.spec.ts`
- Create: `tests/e2e/screenshots/.gitkeep`

**Interfaces:**
- Consumes: Complete Systems Light shell from Tasks 1-4.
- Produces: Automated minimum-size, standard-size, collapse, focus, and package verification.

- [ ] **Step 1: Expand the Electron end-to-end test**

Replace `tests/e2e/app.spec.ts` with tests that launch Electron once per test and always close it in `finally`. Add these cases:

```ts
test('renders Systems Light at the standard desktop size', async () => {
  const app = await electron.launch({ args: ['.vite/build/main.js'] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('heading', { name: 'MCPDevBench' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Configured servers' })).toBeVisible();
    await page.screenshot({ path: 'tests/e2e/screenshots/systems-light-1280x800.png', fullPage: true });
  } finally { await app.close(); }
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
  } finally { await app.close(); }
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
  } finally { await app.close(); }
});
```

- [ ] **Step 2: Build renderer bundles and run the expanded tests**

Run:

```bash
npm run package
npm run test:e2e
```

Expected: packaging passes and all Electron tests pass.

- [ ] **Step 3: Inspect screenshots**

Open both generated PNG files and verify:

- No horizontal overflow at 960 by 640.
- No overlap between sidebar, toolbar, metrics, table, or status.
- Text and icons remain legible.
- Sidebar and canvas use light neutral backgrounds.
- Green appears only in compact status indicators.
- Disabled actions are visibly unavailable without looking like primary enabled commands.

If a defect is visible, add the closest behavioral regression assertion before changing production code, then rerun package and end-to-end tests.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm run typecheck
npm test
npm run package
npm run test:e2e
```

Expected: every command exits with status 0.

- [ ] **Step 5: Commit desktop verification**

```bash
git add tests/e2e/app.spec.ts tests/e2e/screenshots
git commit -m "test: verify Systems Light desktop layout"
```

## Completion Criteria

- Systems Light semantic tokens are the only palette used by renderer components.
- shadcn-vue primitives are source-owned under `src/renderer/components/ui`.
- MCPDevBench domain and shell components remain separate from generated primitives.
- Application health failure settles on `Unavailable`.
- Empty and populated server states are accessible and tested.
- Connected, idle, degraded, and error are communicated without relying on color alone.
- The shell is usable at 960 by 640 and 1280 by 800.
- Screenshot inspection finds no overlap, clipping, or black/green structural background.
- Type checking, unit/component tests, packaging, and Electron end-to-end tests pass.
