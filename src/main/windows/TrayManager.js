/**
 * Tray Manager
 * Manages the system tray icon and menu
 */

const { Tray, Menu, nativeImage, ipcMain } = require('electron');
const { showMainWindow, setQuitting } = require('./MainWindow');
const { createQuickPickerWindow } = require('./QuickPickerWindow');

let tray = null;
let currentAccentColor = '#d97706';

/**
 * Generate tray icon with specified color
 * @param {string} hexColor - Hex color string
 * @returns {NativeImage}
 */
function generateTrayIcon(hexColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="${hexColor}"/>
    <circle cx="8" cy="8" r="4" fill="#0d0d0d"/>
    <circle cx="8" cy="8" r="2" fill="${hexColor}"/>
  </svg>`;

  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return nativeImage.createFromDataURL(svgDataUrl);
}

/**
 * Create the system tray
 * @param {string} accentColor - Initial accent color
 */
function createTray(accentColor = '#d97706') {
  currentAccentColor = accentColor;
  const icon = generateTrayIcon(currentAccentColor);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ouvrir Claude Terminal',
      click: () => {
        showMainWindow();
      }
    },
    {
      label: 'Quick Pick (Ctrl+Shift+P)',
      click: () => {
        createQuickPickerWindow();
      }
    },
    {
      label: 'Nouveau Terminal (Ctrl+Shift+T)',
      click: () => {
        showMainWindow();
        setTimeout(() => {
          const { getMainWindow } = require('./MainWindow');
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.webContents.send('open-terminal-current-project');
          }
        }, 100);
      }
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        setQuitting(true);
        const { app } = require('electron');
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Claude Terminal');
  tray.setContextMenu(contextMenu);

  // Double-click to open
  tray.on('double-click', () => {
    showMainWindow();
  });
}

/**
 * Update tray icon color
 * @param {string} color - New accent color
 */
function updateTrayColor(color) {
  currentAccentColor = color;
  if (tray) {
    const newIcon = generateTrayIcon(color);
    tray.setImage(newIcon);
  }
}

/**
 * Register tray-related IPC handlers
 */
function registerTrayHandlers() {
  ipcMain.on('update-accent-color', (event, color) => {
    updateTrayColor(color);
  });
}

/**
 * Get tray instance
 * @returns {Tray|null}
 */
function getTray() {
  return tray;
}

/**
 * Destroy tray
 */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  updateTrayColor,
  registerTrayHandlers,
  getTray,
  destroyTray,
  generateTrayIcon
};
