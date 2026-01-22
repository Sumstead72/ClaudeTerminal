# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm start            # Run app in development mode
npm run build        # Build Windows installer (NSIS)
npm run publish      # Build and publish to GitHub releases
```

Use `--dev` flag with `npm start` to enable DevTools.

## Architecture Overview

Claude Terminal is an Electron application for managing Claude Code projects with an integrated terminal environment. Windows-only (10/11).

### Main Process (`src/main/`)

```
src/main/
├── index.js           # Bootstrap, lifecycle, single-instance lock, global shortcuts
├── ipc/               # IPC handlers (terminal, git, mcp, fivem, project, dialog)
├── services/          # Business logic
│   ├── TerminalService.js   # node-pty terminal management
│   ├── McpService.js        # MCP server process spawning
│   ├── FivemService.js      # FiveM server launcher
│   └── UpdaterService.js    # electron-updater auto-updates
├── windows/           # Window & tray management
│   ├── MainWindow.js
│   ├── QuickPickerWindow.js
│   └── TrayManager.js
└── utils/             # Paths and git utilities
```

### Renderer Process (`src/renderer/`)

```
src/renderer/
├── index.js           # Module exports
├── services/          # IPC wrappers (Terminal, Project, Settings, MCP, FiveM, Skill, Agent)
├── state/             # Reactive state management with observable pattern
│   └── State.js       # Base class: state.subscribe(listener) for reactivity
├── ui/components/     # DOM components (ProjectList, TerminalManager, Modal, Tab, etc.)
├── features/          # QuickPicker, KeyboardShortcuts, DragDrop
└── utils/             # DOM, color, format, paths utilities
```

### IPC Communication

**Terminal**: `terminal-create` (handle), `terminal-input/resize/kill` (send), `terminal-data/exit` (receive)

**MCP**: `mcp-start/stop` (invoke), `mcp-output/exit` (receive)

**Git**: `git-status-quick` (invoke)

**Dialogs**: `select-folder/file` (invoke), `open-in-explorer` (send)

### Data Storage

```
~/.claude-terminal/
├── projects.json    # Projects with folder hierarchy
└── settings.json    # User preferences (accent color)
```

## Key Implementation Details

- **No context isolation**: `contextIsolation: false` allows direct Node.js access in renderer
- **Single instance**: Uses `app.requestSingleInstanceLock()` - second launch shows existing window
- **Tray integration**: Window minimizes to tray instead of closing
- **Terminal**: xterm.js in renderer, node-pty in main process
- **Windows-specific**: PowerShell default shell, taskkill for process termination, winpty for PTY

## Global Shortcuts

- `Ctrl+Shift+P`: Quick project picker
- `Ctrl+Shift+T`: New terminal in current project
