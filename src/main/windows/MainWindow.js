/**
 * Main Window Manager
 * Manages the main application window
 */

const { BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;
let isQuitting = false;

/**
 * Create the main window
 * @param {Object} options
 * @param {boolean} options.isDev - Whether to open DevTools
 * @returns {BrowserWindow}
 */
function createMainWindow({ isDev = false } = {}) {
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

  // Load the main HTML file
  const htmlPath = path.join(__dirname, '..', '..', '..', 'index.html');
  mainWindow.loadFile(htmlPath);

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Get the main window instance
 * @returns {BrowserWindow|null}
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Show and focus the main window
 */
function showMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();

    // Refresh usage if stale
    try {
      const { onWindowShow } = require('../services/UsageService');
      onWindowShow();
    } catch (e) {}
  }
}

/**
 * Set quitting state
 * @param {boolean} quitting
 */
function setQuitting(quitting) {
  isQuitting = quitting;
}

/**
 * Check if quitting
 * @returns {boolean}
 */
function isAppQuitting() {
  return isQuitting;
}

/**
 * Send message to main window
 * @param {string} channel
 * @param {*} data
 */
function sendToMainWindow(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Check if window is visible
 * @returns {boolean}
 */
function isMainWindowVisible() {
  return mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
}

module.exports = {
  createMainWindow,
  getMainWindow,
  showMainWindow,
  setQuitting,
  isAppQuitting,
  sendToMainWindow,
  isMainWindowVisible
};
