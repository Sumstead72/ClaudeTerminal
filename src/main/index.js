/**
 * Main Process Bootstrap
 * Entry point for the Electron main process
 */

const { app, globalShortcut } = require('electron');

// ============================================
// SINGLE INSTANCE LOCK - Must be first!
// ============================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running
  // Quit immediately and let the first instance handle it
  app.quit();
} else {
  // We got the lock - this is the primary instance
  // Now we can safely require other modules and set up the app
  bootstrapApp();
}

/**
 * Bootstrap the application (only called if we have the single instance lock)
 */
function bootstrapApp() {
  // Lazy require modules only after we have the lock
  const { initializeServices, cleanupServices } = require('./services');
  const { registerAllHandlers } = require('./ipc');
  const {
    createMainWindow,
    getMainWindow,
    showMainWindow,
    setQuitting
  } = require('./windows/MainWindow');
  const {
    createQuickPickerWindow,
    registerQuickPickerHandlers
  } = require('./windows/QuickPickerWindow');
  const {
    createTray,
    registerTrayHandlers
  } = require('./windows/TrayManager');
  const { updaterService } = require('./services');
  const { ensureDataDir } = require('./utils/paths');

  // Set App User Model ID for Windows notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId('Claude Terminal');
  }

  // Handle second instance attempt - show existing window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  /**
   * Initialize the application
   */
  function initializeApp() {
    // Ensure data directory exists before any file operations
    ensureDataDir();

    // Create main window
    const isDev = process.argv.includes('--dev');
    const mainWindow = createMainWindow({ isDev });

    // Initialize services with main window reference
    initializeServices(mainWindow);

    // Register IPC handlers
    registerAllHandlers(mainWindow);
    registerQuickPickerHandlers();
    registerTrayHandlers();

    // Create tray
    createTray();

    // Register global shortcuts
    registerGlobalShortcuts();

    // Check for updates (production only)
    updaterService.checkForUpdates(app.isPackaged);
  }

  /**
   * Register global keyboard shortcuts
   * Note: Global shortcuts are system-wide and may conflict with other apps.
   * We only register truly global shortcuts here (that work even when app is in background).
   * App-local shortcuts (Ctrl+Shift+T, Ctrl+Shift+E, Ctrl+Shift+P) are now handled
   * in the renderer process via KeyboardShortcuts.js
   */
  function registerGlobalShortcuts() {
    // No global shortcuts registered by default to avoid conflicts
    // All shortcuts are now handled locally in the renderer when the app is focused
    console.log('[Shortcut] Global shortcuts disabled - using local shortcuts instead');
  }

  /**
   * Cleanup before quit
   */
  function cleanup() {
    globalShortcut.unregisterAll();
    cleanupServices();
  }

  // App ready - initialize
  app.whenReady().then(initializeApp);

  // Will quit - cleanup
  app.on('will-quit', cleanup);

  // Before quit - mark as quitting and cleanup services
  app.on('before-quit', () => {
    setQuitting(true);
    cleanupServices();
  });

  // Window all closed
  app.on('window-all-closed', () => {
    // Don't quit on Windows/Linux, app stays in tray
    if (process.platform === 'darwin') {
      app.quit();
    }
  });
}
