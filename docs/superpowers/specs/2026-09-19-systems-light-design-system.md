# MCPDevBench Systems Light Design System

Status: Approved for implementation

Date: 2026-09-19

## 1. Objective

Establish a coherent, accessible design system for MCPDevBench using shadcn-vue, Tailwind CSS v4, semantic OKLCH color tokens, and reusable application-shell and MCP domain components.

This work replaces the temporary hand-written scaffold styles. It does not add server persistence, MCP connection behavior, or other product workflows.

## 2. Visual Direction

The selected direction is **Systems Light**: a compact operational interface built from light steel and cool neutral surfaces, with cobalt reserved for commands and navigation emphasis.

The interface must not use black or green as a structural background. Green is limited to small success indicators such as text, icons, dots, and borders. Large surfaces remain neutral.

The design should feel:

- Precise rather than decorative.
- Dense enough for repeated debugging work.
- Calm during long trace-reading sessions.
- Familiar to developers without resembling a terminal skin.
- Structured through borders and surface contrast rather than floating cards or heavy shadows.

## 3. Component Strategy

Use selective shadcn-vue primitives with a separate MCPDevBench domain layer.

```text
src/renderer/
  components/
    ui/                 Source-owned shadcn-vue primitives
    domain/             Reusable MCPDevBench concepts
    shell/              Application navigation and workspace frame
  styles/
    tokens.css          Systems Light semantic tokens
    base.css            Typography, focus, selection, and scrollbars
```

The initial shadcn-vue primitives are:

- Button
- Badge
- Tooltip
- Separator
- Sidebar
- Table
- Empty
- Skeleton

The initial MCPDevBench components are:

- `AppSidebar`
- `ApplicationStatus`
- `ConnectionStatus`
- `Metric`
- `ServerTable`
- `EmptyServerState`

Generated shadcn-vue primitives may be adjusted for accessibility and desktop density. Domain terminology and MCP-specific states must not be added to `components/ui`.

## 4. Tooling

- Use Tailwind CSS v4 and `@tailwindcss/vite` in the renderer Vite configuration.
- Initialize shadcn-vue with CSS variables enabled.
- Configure `components.json` to use the existing `@/` alias.
- Keep component source under `src/renderer/components/ui`.
- Use Lucide Vue icons instead of hand-drawn SVGs.
- Package fonts with the application so typography does not depend on network access.
- Use Inter Variable for interface text.
- Use JetBrains Mono for JSON, traces, method names, identifiers, and timings.
- Keep dependency versions exact, consistent with the repository's existing policy.

## 5. Color Tokens

Use semantic tokens rather than raw palette values in components. The initial light theme is:

| Token | Value | Purpose |
| --- | --- | --- |
| `background` | `oklch(0.97 0.006 250)` | Application canvas |
| `foreground` | `oklch(0.25 0.018 255)` | Primary text and icons |
| `card` | `oklch(0.995 0.002 250)` | Raised or contained surface |
| `card-foreground` | `oklch(0.25 0.018 255)` | Text on contained surfaces |
| `popover` | `oklch(0.995 0.002 250)` | Menus and popovers |
| `popover-foreground` | `oklch(0.25 0.018 255)` | Text in menus and popovers |
| `primary` | `oklch(0.52 0.19 264)` | Primary commands and selected emphasis |
| `primary-foreground` | `oklch(0.985 0.003 250)` | Text on primary controls |
| `secondary` | `oklch(0.925 0.014 250)` | Secondary controls and sidebar surface |
| `secondary-foreground` | `oklch(0.31 0.025 255)` | Text on secondary controls |
| `muted` | `oklch(0.94 0.008 250)` | Subdued surfaces |
| `muted-foreground` | `oklch(0.50 0.018 250)` | Supporting text |
| `accent` | `oklch(0.90 0.025 255)` | Hover and selected navigation surface |
| `accent-foreground` | `oklch(0.29 0.04 258)` | Text on accent surfaces |
| `border` | `oklch(0.86 0.014 250)` | Dividers and component outlines |
| `input` | `oklch(0.84 0.016 250)` | Input outlines |
| `ring` | `oklch(0.58 0.17 264)` | Keyboard focus |
| `success` | `oklch(0.53 0.13 163)` | Successful and connected states |
| `warning` | `oklch(0.68 0.15 70)` | Degraded and caution states |
| `destructive` | `oklch(0.56 0.20 20)` | Errors and destructive actions |
| `info` | `oklch(0.61 0.14 230)` | Protocol and informational states |
| `sidebar` | `oklch(0.92 0.014 250)` | Sidebar background |
| `sidebar-foreground` | `oklch(0.31 0.025 255)` | Sidebar text and icons |
| `sidebar-accent` | `oklch(0.875 0.025 255)` | Active and hover navigation |
| `sidebar-border` | `oklch(0.82 0.018 250)` | Sidebar separation |

Semantic status colors should normally appear as foregrounds, icons, dots, or borders. When a status needs a background, use a low-chroma neutral tint rather than a saturated green, amber, or red field.

Only the light token set is implemented in v0.1. Components must consume semantic tokens so a later dark theme does not require component API changes.

## 6. Typography

- Interface family: Inter Variable.
- Code family: JetBrains Mono Variable.
- Base interface size: 14px.
- Supporting and metadata size: 12px.
- Compact control labels: 13px.
- Page title: 24px to 26px.
- Panel and table headings: 14px to 17px.
- Letter spacing is `0` except short uppercase metadata labels, which may use a small positive value.
- Do not scale font size with viewport width.

Monospace is reserved for protocol data. Ordinary navigation, labels, descriptions, and statuses remain in the interface family.

## 7. Spacing And Geometry

- Use a 4px base spacing unit and an 8px primary rhythm.
- Standard control height: 36px.
- Compact icon-button size: 32px.
- Prominent control height: 40px.
- Standard component radius: 6px.
- Maximum radius: 8px.
- Sidebar expanded width: 224px.
- Top toolbar height: 56px.
- Main workspace padding: 24px to 32px depending on density.

Do not use cards as page-section containers. Cards are reserved for repeated records, modals, and genuinely framed tools. Tables, inspectors, traces, and page sections use full-width layouts with borders or bands.

Shadows are reserved for menus, popovers, and dialogs. Static workspace hierarchy uses borders and surface changes.

## 8. Interaction And Motion

- Use Lucide icons for familiar actions.
- Icon-only controls require accessible names and tooltips when their meaning is not universal.
- Keyboard focus must be visible through the semantic ring token.
- Hover, pressed, expansion, and selection transitions use 120ms to 180ms durations.
- Avoid decorative animation.
- Respect `prefers-reduced-motion`.
- Persistent navigation state may use the shadcn-vue Sidebar provider's storage behavior.

## 9. Application Shell

The application shell uses the shadcn-vue Sidebar primitives but remains an MCPDevBench-owned composition.

Navigation is grouped as:

```text
Workspace
  Servers
  Inspector
  Playground

Quality
  Doctor
  Tests

Ship
  Client Config
```

Only implemented routes are interactive. Future destinations may be visible only when clearly marked unavailable; they must not behave like working navigation.

The top toolbar contains the current location, sidebar trigger, and compact application status. The workspace owns scrolling so navigation and toolbar remain stable.

## 10. Dashboard Demonstration

The dashboard is the first proof of the design system. It contains:

- Page title and concise supporting text.
- Primary and secondary command placement.
- Three compact metrics.
- A server table in populated demonstration state.
- A separately testable empty state.
- Connected, idle, degraded, and error status treatments.

Representative server data is static and clearly part of the UI demonstration. This work must not add server persistence, connection management, or fake Electron IPC behavior.

The Add Server command remains unavailable until the connection workflow is implemented. It must not silently do nothing.

## 11. State And Error Presentation

- Loading uses Skeleton components without changing layout dimensions.
- Empty views use the Empty primitive with one clear next action when that action exists.
- Errors use concise inline feedback close to the affected operation.
- Status is never communicated by color alone; pair color with text or an icon.
- Application startup continues to show `Starting` until the typed health call resolves.
- A failed health call shows `Unavailable` rather than leaving the interface indefinitely in `Starting`.

## 12. Accessibility

- Meet WCAG AA contrast for text, controls, focus, and status indicators.
- Preserve logical heading order.
- Navigation has an accessible name and active-page indication.
- Tables use semantic headers and captions or equivalent accessible descriptions.
- Icon-only buttons have accessible names.
- Disabled controls explain their unavailable state through adjacent context or a tooltip.
- The shell remains usable at the Electron minimum window size of 960 by 640.

## 13. Verification

Component tests verify:

- Product identity and application health state.
- Accessible names for navigation and icon controls.
- Active navigation state.
- Empty and populated server-table states.
- Status text for connected, idle, degraded, and error states.
- Startup health failure becoming `Unavailable`.

End-to-end verification covers:

- The packaged Electron application at 1280 by 800.
- The minimum supported window size of 960 by 640.
- Sidebar expansion and collapse.
- Keyboard focus visibility and tab order for shell controls.
- No clipping, overlap, incoherent layout shift, or unreadable text.

Screenshots from both target sizes are inspected before completion. Existing type checking, unit tests, packaging, and Electron smoke tests must remain green.

## 14. Out Of Scope

- Dark mode.
- Server persistence or connection forms.
- Real server metrics or discovery results.
- MCP Inspector, Playground, Doctor, and Tests feature implementations.
- Theme customization by the user.
- A standalone Storybook or component-documentation application.
