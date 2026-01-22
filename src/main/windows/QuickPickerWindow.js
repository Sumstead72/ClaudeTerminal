/**
 * Quick Picker Window Manager
 * Manages the quick project picker overlay window
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getMainWindow, showMainWindow } = require('./MainWindow');

let quickPickerWindow = null;

/**
 * Create or show the quick picker window
 */
function createQuickPickerWindow() {
  if (quickPickerWindow) {
    quickPickerWindow.show();
    quickPickerWindow.focus();
    // Force reload projects
    quickPickerWindow.webContents.send('reload-projects');
    return quickPickerWindow;
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

  const htmlPath = path.join(__dirname, '..', '..', '..', 'quick-picker.html');
  quickPickerWindow.loadFile(htmlPath);

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

  return quickPickerWindow;
}

/**
 * Get the quick picker window instance
 * @returns {BrowserWindow|null}
 */
function getQuickPickerWindow() {
  return quickPickerWindow;
}

/**
 * Hide the quick picker window
 */
function hideQuickPicker() {
  if (quickPickerWindow) {
    quickPickerWindow.hide();
  }
}

/**
 * Register quick picker IPC handlers
 */
function registerQuickPickerHandlers() {
  // Handle project selection
  ipcMain.on('quick-pick-select', (event, project) => {
    hideQuickPicker();

    const mainWindow = getMainWindow();
    if (!mainWindow) {
      // Main window will be created by app
      return;
    }

    showMainWindow();

    // Send project to open
    setTimeout(() => {
      mainWindow.webContents.send('open-project', project);
    }, 200);
  });

  // Handle close
  ipcMain.on('quick-pick-close', () => {
    hideQuickPicker();
  });
}

module.exports = {
  createQuickPickerWindow,
  getQuickPickerWindow,
  hideQuickPicker,
  registerQuickPickerHandlers
};
