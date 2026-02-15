# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Terminal is a Windows-only Electron desktop application (v0.9.2) for managing Claude Code projects with an integrated terminal, chat UI, git management, and plugin ecosystem. Built for Windows 10/11 with NSIS installer distribution.

**Repository:** `github.com/Sterll/claude-terminal` | **License:** GPL-3.0 | **Author:** Yanis

## Build & Development Commands

```bash
npm install              # Install dependencies (Node >=18 required)
npm start                # Build renderer + run app
npm start -- --dev       # Run with DevTools enabled
npm run watch            # Build renderer in watch mode (esbuild)
npm run build:renderer   # Build renderer only → dist/renderer.bundle.js
npm run build            # Build Windows NSIS installer → build/
npm run publish          # Build and publish installer to update server
npm test                 # Run Jest tests (jsdom environment)
npm run test:watch       # Jest in watch mode
```

**Important:** Always run `npm run build:renderer` after modifying any file in `src/renderer/` or `renderer.js`.

## Architecture Overview

```
Electron Main Process (Node.js)
├── main.js                          # Bootstrap, lifecycle, single-instance lock
├── src/main/preload.js              # IPC bridge (110+ channels exposed as electron_api)
├── src/main/ipc/                    # IPC handlers (14 handler files)
├── src/main/services/               # Business logic (12 services)
├── src/main/windows/                # Window managers (5 windows)
└── src/main/utils/                  # Git operations, paths, AI commit generator

Electron Renderer Process (Browser)
├── renderer.js                      # Entry point (bundled by esbuild → dist/)
├── src/renderer/index.js            # Module loader & initialization
├── src/renderer/state/              # Observable state management (11 state modules)
├── src/renderer/services/           # IPC wrappers & business logic (11 services)
├── src/renderer/ui/components/      # UI components (14 components)
├── src/renderer/features/           # Keyboard shortcuts, quick picker, drag-drop
├── src/renderer/events/             # Claude event bus + hook/scraping providers
├── src/renderer/i18n/               # EN/FR internationalization
└── src/renderer/utils/              # DOM, color, format, paths, icons, syntax highlighting

Project Types (Plugin System)
└── src/project-types/               # api, fivem, python, webapp, general
```

## Main Process (`src/main/`)

### IPC Handlers (`src/main/ipc/`)

| File | Channels | Key Operations |
|------|----------|----------------|
| `terminal.ipc.js` | 6 | Create PTY (node-pty), input, resize, kill |
| `git.ipc.js` | 30 | Status, branches, pull/push, merge, clone, stash, cherry-pick, revert, AI commit message |
| `github.ipc.js` | 10 | OAuth Device Flow auth, workflow runs, PRs, create PR |
| `chat.ipc.js` | 13 | Agent SDK streaming sessions, permissions, interrupt, tab name generation |
| `dialog.ipc.js` | 16 | Window controls, file/folder dialogs, notifications, updates, startup settings |
| `mcp.ipc.js` | 4 | Start/stop MCP server processes |
| `mcpRegistry.ipc.js` | 3 | Browse/search MCP registry (`registry.modelcontextprotocol.io`) |
| `marketplace.ipc.js` | 6 | Search/install/uninstall skills from `skills.sh` |
| `plugin.ipc.js` | 6 | Installed plugins, catalog, install via Claude CLI PTY |
| `usage.ipc.js` | 4 | Claude usage data (OAuth API primary, PTY `/usage` fallback) |
| `claude.ipc.js` | 2 | Session listing, conversation history |
| `project.ipc.js` | 1 | TODO/FIXME scanning |
| `hooks.ipc.js` | 4 | Install/remove/verify hooks in `~/.claude/settings.json` |
| `fivem.ipc.js` | - | Delegated to `src/project-types/fivem/` |

### Services (`src/main/services/`)

| Service | Purpose | Key Detail |
|---------|---------|------------|
| `TerminalService.js` | node-pty management | PowerShell default, adaptive output batching (4ms/16ms/32ms), Claude CLI launch with `--resume` |
| `ChatService.js` | Claude Agent SDK bridge | Streaming input mode, `maxTurns: 100`, permission forwarding, persistent haiku naming session |
| `GitHubAuthService.js` | GitHub OAuth + API | Device Flow, keytar credential storage, Client ID: `Ov23liYfl42qwDVVk99l` |
| `UsageService.js` | Claude usage tracking | OAuth API (`api.anthropic.com/api/oauth/usage`), PTY fallback, 5min staleness |
| `McpService.js` | MCP server processes | Child process spawning with env vars, force-kill via taskkill |
| `MarketplaceService.js` | Skill marketplace | `skills.sh/api/search`, git clone install, caching (5-30min TTL) |
| `McpRegistryService.js` | MCP server registry | `registry.modelcontextprotocol.io/v0.1`, pagination, caching |
| `PluginService.js` | Claude Code plugins | Read metadata, PTY-based `/plugin install` execution |
| `UpdaterService.js` | Auto-updates | electron-updater, 30min periodic checks, stale cache cleanup |
| `HooksService.js` | Claude hooks management | 15 hook types, non-destructive install, auto-backup/repair |
| `HookEventServer.js` | Hook event receiver | HTTP server on `127.0.0.1:0`, receives POST from hook handler |
| `FivemService.js` | FiveM server launcher | Delegated to project-types |

### Windows (`src/main/windows/`)

| Window | Config | Purpose |
|--------|--------|---------|
| `MainWindow.js` | 1400x900, min 1000x600, frameless | Main app, tray minimize, Ctrl+Arrow tab navigation |
| `QuickPickerWindow.js` | 600x400, always-on-top, transparent | Quick project picker (Ctrl+Shift+P) |
| `SetupWizardWindow.js` | 900x650 | 7-step first-launch wizard (language, color, editor, hooks) |
| `TrayManager.js` | System tray | Context menu: Open, Quick Pick, New Terminal, Quit |
| `NotificationWindow.js` | Small overlay | Custom notification with auto-dismiss progress bar |

### Utilities (`src/main/utils/`)

| Utility | Purpose |
|---------|---------|
| `paths.js` | Path constants (`~/.claude-terminal/`, `~/.claude/`), `ensureDataDir()`, `loadAccentColor()` |
| `git.js` | 20+ git operations via `execGit()`, status parsing, safe.directory handling, 15s timeout |
| `commitMessageGenerator.js` | AI commit via GitHub Models API (gpt-4o-mini), heuristic fallback |

## Renderer Process (`src/renderer/`)

### Initialization Flow (`src/renderer/index.js`)

1. `utils.ensureDirectories()` - Create data dirs
2. `state.initializeState()` - Load all state modules
3. Load i18n with saved language or auto-detect
4. Initialize settings (apply accent color)
5. Register MCP, WebApp, FiveM event listeners
6. Load disk-cached dashboard data
7. Preload all projects (500ms delay)

### State Management (`src/renderer/state/`)

Base class `State.js`: Observable with `subscribe()`, batched notifications via `requestAnimationFrame`.

| Module | State Shape | Key Features |
|--------|-------------|--------------|
| `projects.state.js` | `{ projects[], folders[], rootOrder[], selectedProjectFilter, openedProjectId }` | CRUD, folder nesting, quick actions, color/icon, debounced save (500ms), atomic writes |
| `terminals.state.js` | `{ terminals: Map, activeTerminal, detailTerminal }` | Per-project terminal tracking, stats |
| `settings.state.js` | `{ editor, accentColor, language, defaultTerminalMode, chatModel, ... }` | 15 settings, debounced persistence |
| `timeTracking.state.js` | `{ version, month, global, projects }` per session | 15min idle timeout, midnight rollover, 30min session merge, monthly archival |
| `mcp.state.js` | `{ mcps[], mcpProcesses{}, selectedMcp }` | Status tracking, 1000-entry log limit |
| `git.state.js` | `{ gitOperations: Map, gitRepoStatus: Map }` | Pull/push/merge state per project |
| `fivem.state.js` | FiveM resource state | Resource scanning results |

**Additional simple states:** `quickPickerState`, `dragState`, `contextMenuState`, `skillsAgentsState`

### Services (`src/renderer/services/`)

| Service | Purpose |
|---------|---------|
| `TerminalService.js` | xterm.js creation (WebGL, 10k scrollback), mount, fit, IPC wrappers |
| `ProjectService.js` | Add/delete/open projects, editor integration, git status check |
| `SettingsService.js` | Accent color DOM application, notification permissions, window title |
| `DashboardService.js` | HTML builders (`buildXxxHtml()`), data caching (30s TTL), disk cache |
| `TimeTrackingDashboard.js` | Time tracking charts & statistics |
| `GitTabService.js` | Git operations UI helpers |
| `McpService.js` | Load/save MCP configs from `~/.claude.json` |
| `SkillService.js` | Load skills from `~/.claude/skills/` with YAML frontmatter |
| `AgentService.js` | Load agents from `~/.claude/agents/` |
| `ArchiveService.js` | Past-month time tracking archival |
| `FivemService.js` | FiveM IPC wrapper |

### UI Components (`src/renderer/ui/components/`)

| Component | Purpose |
|-----------|---------|
| `ProjectList.js` | Hierarchical project/folder tree with drag-drop |
| `TerminalManager.js` | Terminal tabs, xterm rendering, active switching |
| `ChatView.js` | Chat interface for Agent SDK sessions |
| `Modal.js` | Reusable modal (small/medium/large), ESC/overlay close |
| `Toast.js` | Non-blocking toast notifications |
| `ContextMenu.js` | Right-click menus for projects/folders |
| `Tab.js` | Tab navigation component |
| `CustomizePicker.js` | Project customization (color, icon, name) |
| `QuickActions.js` | Per-project quick action configuration |
| `FileExplorer.js` | Integrated file tree browser |
| `MenuSection.js` | Menu section grouping |

### Features (`src/renderer/features/`)

| Feature | Shortcuts |
|---------|-----------|
| `KeyboardShortcuts.js` | `Ctrl+T` new terminal, `Ctrl+W` close, `Ctrl+P` quick picker, `Ctrl+,` settings, `Ctrl+Tab`/`Ctrl+Shift+Tab` switch terminals, `Escape` close overlays |
| `QuickPicker.js` | Arrow navigation, Enter select, Escape close, real-time search |
| `DragDrop.js` | HTML5 drag-drop for projects/folders reordering |

**Global shortcuts** (registered in main process): `Ctrl+Shift+P` (quick picker), `Ctrl+Shift+T` (new terminal)

### Events System (`src/renderer/events/`)

| Module | Purpose |
|--------|---------|
| `ClaudeEventBus.js` | Pub-sub for Claude activity (SESSION_START/END, TOOL_START/END, PROMPT_SUBMIT) |
| `HooksProvider.js` | Event detection via Claude hooks (HTTP event server) |
| `ScrapingProvider.js` | Fallback event detection via terminal output parsing |
| `index.js` | Provider selection, wires consumers (time tracking, notifications, dashboard) |

### Internationalization (`src/renderer/i18n/`)

- **Languages:** French (default), English
- **System:** Dot-notation keys with `{variable}` interpolation
- **Detection:** Auto-detect from `navigator.language`, fallback to `fr`
- **Files:** `locales/en.json`, `locales/fr.json`
- **Usage:** `t('projects.openFolder')`, `t('key', { count: 5 })`
- **HTML:** `data-i18n` attributes for static text

## Project Types (`src/project-types/`)

Pluggable project type system with base class and registry:

| Type | Features |
|------|----------|
| `api/` | Route detection, API testing, dashboard |
| `fivem/` | FiveM server launcher, resource scanning |
| `python/` | Python environment detection |
| `webapp/` | Web framework detection, dev server |
| `general/` | Default fallback type |

Each type provides: service, IPC handlers, dashboard renderer, i18n translations.

## HTML Pages

| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | 726 | Main app: titlebar (usage, time, controls), sidebar (11 tabs), content panels, modals |
| `quick-picker.html` | 342 | Standalone quick picker with inline Node.js script |
| `setup-wizard.html` | 1476 | 7-step onboarding wizard with embedded EN/FR translations |
| `notification.html` | 215 | Custom notification with auto-dismiss progress bar |

## CSS Architecture (`styles.css` - 20,180 lines)

### CSS Variables (`:root`)

```css
/* Colors */
--bg-primary: #0d0d0d;  --bg-secondary: #151515;  --bg-tertiary: #1a1a1a;
--bg-hover: #252525;     --bg-active: #2a2a2a;     --border-color: #2d2d2d;
--text-primary: #e0e0e0; --text-secondary: #888;    --text-muted: #555;
--accent: #d97706;       --accent-hover: #f59e0b;   --accent-dim: rgba(217,119,6,0.15);
--success: #22c55e;      --warning: #f59e0b;        --danger: #ef4444;  --info: #3b82f6;

/* Layout */
--radius: 8px;  --radius-sm: 4px;  --sidebar-width: 200px;  --projects-panel-width: 350px;

/* Typography (rem-based) */
--font-2xs: 0.625rem;  --font-xs: 0.6875rem;  --font-sm: 0.8125rem;
--font-base: 0.875rem;  --font-md: 1rem;  --font-lg: 1.125rem;
```

### Naming Convention

```css
.component-name { }           /* Base styles */
.component-name.state { }     /* State modifier (e.g., .project-item.active) */
.component-name[data-x] { }   /* Data attribute conditional */
.component-name:has(.child) {} /* Parent selector */
```

### Major Sections

Titlebar (usage display, time tracking, window controls) > Update banner > Layout (sidebar + content) > Sidebar navigation > Projects panel (resizable) > File explorer > Terminals panel (tabs, loading, empty state) > Git actions (branch dropdown, changes panel, CI status) > Tab content (plugins, skills, agents, git, dashboard, settings, memory) > Empty states > Modals & toasts > Component-specific styles

## Preload Bridge (`src/main/preload.js`)

Exposes 25 API namespaces to renderer via `window.electron_api`:

`terminal` | `git` (26 methods) | `github` | `chat` | `mcp` | `mcpRegistry` | `marketplace` | `plugins` | `dialog` | `window` | `app` | `notification` | `usage` | `project` | `claude` | `hooks` | `updates` | `setupWizard` | `lifecycle` | `quickPicker` | `tray` | `fivem` | `webapp` | `api` | `python`

Also exposes `window.electron_nodeModules`: `path`, `fs` (sync + promises), `os.homedir()`, `process.env`, `child_process.execSync`

## Data Storage

```
~/.claude-terminal/                    # App data directory
├── projects.json                      # Projects with folder hierarchy & quick actions
├── settings.json                      # User preferences (accent color, language, editor, etc.)
├── timetracking.json                  # Time tracking data (v2 format)
├── marketplace.json                   # Installed skills manifest
├── hooks/port                         # Hook event server port file
└── archives/YYYY/MM/archive-data.json # Archived time tracking sessions

~/.claude/                             # Claude Code directory
├── settings.json                      # Claude Code settings (with hooks definitions)
├── .claude.json                       # MCP server configurations
├── .credentials.json                  # OAuth tokens (accessToken, refreshToken)
├── skills/                            # Installed skills (SKILL.md + files)
├── agents/                            # Custom agents (AGENT.md + files)
├── projects/{encoded-path}/           # Session data per project
│   └── sessions-index.json
└── plugins/
    ├── installed_plugins.json
    └── known_marketplaces.json

Windows Credential Manager (via keytar)  # GitHub token storage
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^28.0.0 | Desktop framework (Chromium 120) |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.42 | Claude Code streaming chat integration |
| `@xterm/xterm` | ^6.0.0 | Terminal emulator |
| `@xterm/addon-webgl` | ^0.19.0 | WebGL-accelerated terminal rendering |
| `@xterm/addon-fit` | ^0.11.0 | Auto-fit terminal to container |
| `node-pty` | ^1.1.0 | PTY process management |
| `keytar` | ^7.9.0 | OS credential storage (Windows Credential Manager) |
| `electron-updater` | ^6.1.7 | Auto-update with generic provider |
| `esbuild` | ^0.27.2 | Renderer bundling (IIFE, Chrome 120 target, sourcemaps) |
| `jest` | ^29.7.0 | Unit testing (jsdom environment) |

## Key Implementation Details

- **No context isolation in preload:** `contextIsolation: false` + `nodeIntegration: false` with full `electron_api` bridge
- **Single instance:** `app.requestSingleInstanceLock()` prevents multiple instances
- **Tray integration:** Close button minimizes to tray, `app-quit` for real exit
- **Frameless window:** Custom titlebar in HTML/CSS with `-webkit-app-region: drag`
- **Terminal:** xterm.js (WebGL addon) in renderer, node-pty (PowerShell) in main, adaptive batching
- **Chat:** Agent SDK streaming input mode with async iterator for multi-turn conversations
- **AI commits:** GitHub Models API (gpt-4o-mini, free tier) with heuristic fallback
- **Hooks:** 15 hook types installed into `~/.claude/settings.json`, HTTP event server for real-time events
- **Time tracking:** 15min idle timeout, 2min output idle, 30min session merge, midnight rollover, monthly archival
- **Renderer bundling:** esbuild IIFE bundle → `dist/renderer.bundle.js` with sourcemaps
- **Persistence:** Atomic writes (temp file + rename), backup files (`.bak`), corruption recovery
- **Updates:** Generic provider, 30min periodic checks, differential packages

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
```

- **Framework:** Jest with jsdom environment
- **Setup:** `tests/setup.js` mocks `window.electron_nodeModules` and `window.electron_api`
- **Test files:** `tests/state/State.test.js`, `tests/state/settings.test.js`, `tests/utils/color.test.js`, `tests/utils/format.test.js`, `tests/utils/fileIcons.test.js`
- **Pattern:** `**/tests/**/*.test.js`

## CI/CD

**GitHub Actions** (`.github/workflows/ci.yml`):
- Triggers: push to `main`, PRs to `main`
- Matrix: Node 18 + 20 on `windows-latest`
- Steps: checkout, npm ci, build:renderer, test

**Installer:** NSIS (x64), per-user install, custom sidebar/header images, desktop + start menu shortcuts

## Bundled Resources

- **`resources/bundled-skills/`:** `create-skill` (skill creation guide), `create-agents` (agent creation guide with templates)
- **`resources/hooks/claude-terminal-hook-handler.js`:** Node.js script called by Claude hooks, forwards events via HTTP POST
- **`assets/`:** `icon.ico`, `claude-mascot.svg`, `mascot-dance.svg`
- **`website/`:** Landing page, changelog, privacy policy, legal terms

## Conventions

- **Commits:** `feat(scope): description` in English, imperative mood
- **IPC pattern:** Service (main) -> IPC handler -> Preload bridge -> Renderer service
- **Dashboard sections:** `buildXxxHtml()` functions in `DashboardService.js`
- **CSS:** `.component-name.state` pattern, CSS variables for theming
- **i18n:** Add keys to both `en.json` and `fr.json`, use `t('dot.path')` in code
- **State updates:** Use `state.set()` or `state.setProp()`, subscribe with `state.subscribe()`
- **File I/O:** Always use atomic writes for user data (temp + rename)
- **Project types:** Extend `BaseType`, register in `registry.js`, provide service + IPC + dashboard + i18n
