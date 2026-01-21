const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let quickPickerWindow = null;
let tray = null;
const terminals = new Map();
const mcpProcesses = new Map(); // Map id -> ChildProcess
let terminalId = 0;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Minimiser dans le tray au lieu de fermer
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    // Kill all terminals
    terminals.forEach(term => term.kill());
    terminals.clear();
    mainWindow = null;
  });
}

function createTray() {
  // Créer une icône orange simple (16x16)
  const iconDataUrl = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEkSURBVDiNpZMxSwNBEIXfm9u7XBISooUgWFhYWPkHrPwbNv4Ca/+BnYWFjYWNhYWFIFhYCIKFhYhBEy+5y+3O2NwlUZPgwMIy8+Z9MLMryBjDoTXq/gPsGfIdgMw7z58cLEnD+bVVwQjAg4gcALgC8AbgM6HGADKllFdRbVKJjYMhFOSIXAoAn6J6C8BbYDEsxFnHjAjoPkAb4hFHEHvKXE8GAHL/gYd7Bno/Q4b0QyICEvknInVN6zBSXrPp1IBExB9I0m7GGTsV2JZSfkmxQ4K4V2cVgHu+7/8qAJskT5W50wqy7wFI09QT0YMA1rX8tZNnwBpBEyK1WjXdNWMMIctyXCwRkUxS8Pke0+qXMNgTqIJ/6yGlFEQ2Nf7X+gYcT3kZ+g/xcQAAAABJRU5ErkJggg==`;

  const icon = nativeImage.createFromDataURL(iconDataUrl);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir Claude Terminal',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Quick Pick (Ctrl+Shift+P)',
      click: () => {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
        setTimeout(() => {
          mainWindow.webContents.send('open-quick-picker');
        }, 100);
      }
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Claude Terminal');
  tray.setContextMenu(contextMenu);

  // Double-clic pour ouvrir
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function createQuickPickerWindow() {
  if (quickPickerWindow) {
    quickPickerWindow.show();
    quickPickerWindow.focus();
    return;
  }

  quickPickerWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  quickPickerWindow.loadFile('quick-picker.html');

  quickPickerWindow.once('ready-to-show', () => {
    quickPickerWindow.show();
    quickPickerWindow.focus();
  });

  quickPickerWindow.on('blur', () => {
    if (quickPickerWindow && !quickPickerWindow.isDestroyed()) {
      quickPickerWindow.hide();
    }
  });

  quickPickerWindow.on('closed', () => {
    quickPickerWindow = null;
  });
}

// IPC pour ouvrir un projet depuis le quick picker
ipcMain.on('quick-pick-select', (event, project) => {
  if (quickPickerWindow) {
    quickPickerWindow.hide();
  }

  // Ouvrir/montrer la fenêtre principale
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }

  // Envoyer le projet sélectionné
  setTimeout(() => {
    mainWindow.webContents.send('open-project', project);
  }, 200);
});

ipcMain.on('quick-pick-close', () => {
  if (quickPickerWindow) {
    quickPickerWindow.hide();
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Raccourci global: Ctrl+Shift+P pour ouvrir le quick picker
  globalShortcut.register('Ctrl+Shift+P', () => {
    createQuickPickerWindow();
  });

  // Auto-updater (seulement en production)
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

// ========== AUTO-UPDATER ==========
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-status', { status: 'available', version: info.version });
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-status', { status: 'downloaded', version: info.version });
  // Notification pour proposer le restart
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour disponible',
      message: `La version ${info.version} a été téléchargée. Redémarrer maintenant ?`,
      buttons: ['Redémarrer', 'Plus tard']
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err);
});

app.on('will-quit', () => {
  // Libérer tous les raccourcis
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Ne pas quitter sur Windows/Linux, l'app reste dans le tray
  if (process.platform === 'darwin') {
    app.quit();
  }
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

// Folder dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// Open in explorer
ipcMain.on('open-in-explorer', (event, folderPath) => {
  shell.openPath(folderPath);
});

// Show notification
ipcMain.on('show-notification', (event, { title, body, terminalId }) => {
  if (!Notification.isSupported()) return;

  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  const notification = new Notification({
    title: title,
    body: body,
    icon: iconPath,
    silent: false
  });

  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('notification-clicked', { terminalId });
    }
  });

  notification.show();
});

// Create terminal
ipcMain.handle('terminal-create', (event, { cwd, runClaude, skipPermissions }) => {
  const id = ++terminalId;

  const shellPath = process.platform === 'win32' ? 'powershell.exe' : 'bash';

  const ptyProcess = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd || os.homedir(),
    env: process.env
  });

  terminals.set(id, ptyProcess);

  ptyProcess.onData(data => {
    mainWindow?.webContents.send('terminal-data', { id, data });
  });

  ptyProcess.onExit(() => {
    terminals.delete(id);
    mainWindow?.webContents.send('terminal-exit', { id });
  });

  // Run claude if requested
  if (runClaude) {
    setTimeout(() => {
      const claudeCmd = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude';
      ptyProcess.write(claudeCmd + '\r');
    }, 500);
  }

  return id;
});

// Terminal input
ipcMain.on('terminal-input', (event, { id, data }) => {
  const term = terminals.get(id);
  if (term) {
    term.write(data);
  }
});

// Terminal resize
ipcMain.on('terminal-resize', (event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term) {
    term.resize(cols, rows);
  }
});

// Kill terminal
ipcMain.on('terminal-kill', (event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
});

// ========== DASHBOARD GIT COMMANDS ==========

function execGit(cwd, args) {
  return new Promise((resolve) => {
    exec(`git ${args}`, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

// Get git info for dashboard
ipcMain.handle('git-info', async (event, projectPath) => {
  const branch = await execGit(projectPath, 'rev-parse --abbrev-ref HEAD');
  if (!branch) return { isGitRepo: false };

  const lastCommit = await execGit(projectPath, 'log -1 --format="%H|%s|%an|%ar"');
  const status = await execGit(projectPath, 'status --porcelain');

  let commit = null;
  if (lastCommit) {
    const [hash, message, author, date] = lastCommit.split('|');
    commit = { hash: hash?.slice(0, 7), message, author, date };
  }

  const files = [];
  if (status) {
    status.split('\n').forEach(line => {
      if (line.trim()) {
        const code = line.slice(0, 2).trim();
        const file = line.slice(3);
        let type = 'modified';
        if (code === '??') type = 'untracked';
        else if (code === 'A' || code === 'AM') type = 'added';
        else if (code === 'D') type = 'deleted';
        files.push({ type, file });
      }
    });
  }

  return { isGitRepo: true, branch, commit, files };
});

// Scan TODO/FIXME in project
ipcMain.handle('scan-todos', async (event, projectPath) => {
  const todos = [];
  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.lua', '.go', '.rs', '.java', '.cpp', '.c', '.h'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor'];

  function scanDir(dir, depth = 0) {
    if (depth > 5) return; // Limite de profondeur
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (ignoreDirs.includes(item)) continue;
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
            scanFile(fullPath, projectPath);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  function scanFile(filePath, basePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const relativePath = path.relative(basePath, filePath);

      lines.forEach((line, i) => {
        const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i) ||
                          line.match(/#\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i) ||
                          line.match(/--\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i);
        if (todoMatch && todos.length < 50) {
          todos.push({
            type: todoMatch[1].toUpperCase(),
            text: todoMatch[2].trim() || '(no description)',
            file: relativePath,
            line: i + 1
          });
        }
      });
    } catch (e) {}
  }

  scanDir(projectPath);
  return todos;
});

// Get project stats
ipcMain.handle('project-stats', async (event, projectPath) => {
  let files = 0;
  let lines = 0;
  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.lua', '.go', '.rs', '.java', '.css', '.html'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor'];

  function countDir(dir, depth = 0) {
    if (depth > 5) return;
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (ignoreDirs.includes(item)) continue;
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            countDir(fullPath, depth + 1);
          } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
            files++;
            const content = fs.readFileSync(fullPath, 'utf8');
            lines += content.split('\n').length;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  countDir(projectPath);
  return { files, lines };
});

// ========== MCP HANDLERS ==========

// Start MCP process
ipcMain.handle('mcp-start', async (event, { id, command, args, env }) => {
  // Kill existing process if any
  if (mcpProcesses.has(id)) {
    const existing = mcpProcesses.get(id);
    try {
      existing.kill();
    } catch (e) {}
    mcpProcesses.delete(id);
  }

  // Merge environment variables
  const processEnv = { ...process.env, ...env };

  // Spawn the process
  const proc = spawn(command, args, {
    env: processEnv,
    shell: true,
    windowsHide: true
  });

  mcpProcesses.set(id, proc);

  // Handle stdout
  proc.stdout.on('data', (data) => {
    mainWindow?.webContents.send('mcp-output', {
      id,
      type: 'stdout',
      data: data.toString()
    });
  });

  // Handle stderr
  proc.stderr.on('data', (data) => {
    mainWindow?.webContents.send('mcp-output', {
      id,
      type: 'stderr',
      data: data.toString()
    });
  });

  // Handle exit
  proc.on('exit', (code) => {
    mcpProcesses.delete(id);
    mainWindow?.webContents.send('mcp-exit', { id, code: code || 0 });
  });

  // Handle error
  proc.on('error', (err) => {
    mainWindow?.webContents.send('mcp-output', {
      id,
      type: 'stderr',
      data: `Error: ${err.message}`
    });
    mcpProcesses.delete(id);
    mainWindow?.webContents.send('mcp-exit', { id, code: 1 });
  });

  return { success: true };
});

// Stop MCP process
ipcMain.handle('mcp-stop', async (event, { id }) => {
  const proc = mcpProcesses.get(id);
  if (proc) {
    try {
      // On Windows, use taskkill to kill the process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { shell: true });
      } else {
        proc.kill('SIGTERM');
        // Force kill after timeout
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch (e) {}
        }, 3000);
      }
    } catch (e) {}
    mcpProcesses.delete(id);
  }
  return { success: true };
});

// Kill all MCP processes on app quit
app.on('before-quit', () => {
  mcpProcesses.forEach((proc, id) => {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { shell: true });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) {}
  });
  mcpProcesses.clear();
});

