/**
 * Claude Terminal - Main Process Entry Point
 * Minimal entry point that bootstraps the modular architecture
 */

const { app, globalShortcut } = require('electron');
const { loadAccentColor } = require('./src/main/utils/paths');
const { initializeServices, cleanupServices } = require('./src/main/services');
const { registerAllHandlers } = require('./src/main/ipc');
const {
  createMainWindow,
  getMainWindow,
  showMainWindow,
  setQuitting
} = require('./src/main/windows/MainWindow');
const {
  createQuickPickerWindow,
  registerQuickPickerHandlers
} = require('./src/main/windows/QuickPickerWindow');
const {
  createTray,
  registerTrayHandlers
} = require('./src/main/windows/TrayManager');
const { updaterService } = require('./src/main/services');

/**
 * Initialize the application
 */
function initializeApp() {
  const accentColor = loadAccentColor();
  const isDev = process.argv.includes('--dev');
  const mainWindow = createMainWindow({ isDev });

  initializeServices(mainWindow);
  registerAllHandlers(mainWindow);
  registerQuickPickerHandlers();
  registerTrayHandlers();
  createTray(accentColor);
  registerGlobalShortcuts();
  updaterService.checkForUpdates(app.isPackaged);
}

/**
 * Register global keyboard shortcuts
 */
function registerGlobalShortcuts() {
  globalShortcut.register('Ctrl+Shift+P', () => {
    createQuickPickerWindow();
  });

  globalShortcut.register('Ctrl+Shift+T', () => {
    let mainWindow = getMainWindow();
    if (!mainWindow) {
      mainWindow = createMainWindow({ isDev: process.argv.includes('--dev') });
    }
    showMainWindow();
    setTimeout(() => {
      mainWindow.webContents.send('open-terminal-current-project');
    }, 100);
  });
}

/**
 * Cleanup before quit
 */
function cleanup() {
  globalShortcut.unregisterAll();
  cleanupServices();
}

// App lifecycle
app.whenReady().then(initializeApp);
app.on('will-quit', cleanup);
app.on('before-quit', () => {
  setQuitting(true);
  // Notify renderer to save active time tracking sessions
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-will-quit');
  }
  cleanupServices();
});
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    app.quit();
  }
});
