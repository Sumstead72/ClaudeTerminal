/**
 * Updater Service
 * Manages application auto-updates
 */

const { autoUpdater } = require('electron-updater');

// Check interval: 30 minutes
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

class UpdaterService {
  constructor() {
    this.mainWindow = null;
    this.isInitialized = false;
    this.checkInterval = null;
    this.lastKnownVersion = null;
    this.isDownloading = false;
  }

  /**
   * Set the main window reference for IPC communication
   * @param {BrowserWindow} window
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Safely send IPC message to main window
   */
  safeSend(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Initialize the auto updater
   */
  initialize() {
    if (this.isInitialized) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Force fresh update checks (don't use cached update info)
    autoUpdater.forceDevUpdateConfig = false;

    // Handle update available
    autoUpdater.on('update-available', (info) => {
      this.lastKnownVersion = info.version;
      this.isDownloading = true;
      this.safeSend('update-status', { status: 'available', version: info.version });
    });

    // Handle update downloaded
    autoUpdater.on('update-downloaded', (info) => {
      this.lastKnownVersion = info.version;
      this.isDownloading = false;
      this.safeSend('update-status', { status: 'downloaded', version: info.version });
      // No native dialog - the renderer banner handles the UI
    });

    // Handle update not available
    autoUpdater.on('update-not-available', (info) => {
      this.isDownloading = false;
      // If we had a downloaded version but now there's nothing newer,
      // it means we're up to date (after an install)
      this.safeSend('update-status', { status: 'not-available' });
    });

    // Handle error
    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err);
      this.isDownloading = false;
      this.safeSend('update-status', { status: 'error', error: err.message });
    });

    // Handle download progress
    autoUpdater.on('download-progress', (progressObj) => {
      this.safeSend('update-status', { status: 'downloading', progress: progressObj.percent });
    });

    this.isInitialized = true;
  }

  /**
   * Check for updates (only in production)
   * @param {boolean} isPackaged - Whether the app is packaged
   */
  checkForUpdates(isPackaged) {
    if (isPackaged) {
      this.initialize();
      autoUpdater.checkForUpdatesAndNotify();

      // Start periodic update checks
      this.startPeriodicCheck();
    }
  }

  /**
   * Start periodic update checks
   */
  startPeriodicCheck() {
    // Clear any existing interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Check every 30 minutes for new versions
    this.checkInterval = setInterval(() => {
      // Only check if not currently downloading
      if (!this.isDownloading) {
        console.log('Periodic update check...');
        autoUpdater.checkForUpdates().catch(err => {
          console.error('Periodic update check failed:', err);
        });
      }
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic update checks
   */
  stopPeriodicCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Manually trigger update check
   */
  manualCheck() {
    this.initialize();
    return autoUpdater.checkForUpdates();
  }

  /**
   * Check for newer version before installing
   * This ensures we always install the latest available version
   * @returns {Promise<boolean>} - true if should proceed with install, false if re-downloading
   */
  async checkBeforeInstall() {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const serverVersion = result.updateInfo.version;

        // If server has a newer version than what we downloaded, re-download
        if (this.lastKnownVersion && serverVersion !== this.lastKnownVersion) {
          console.log(`Newer version available: ${serverVersion} (was: ${this.lastKnownVersion})`);
          // autoDownload will handle re-downloading
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error('Check before install failed:', err);
      // Proceed with install anyway
      return true;
    }
  }

  /**
   * Quit and install update
   */
  async quitAndInstall() {
    // First check if there's a newer version available
    const shouldInstall = await this.checkBeforeInstall();

    if (!shouldInstall) {
      // A newer version is being downloaded, wait for it
      console.log('Downloading newer version, install delayed...');
      return;
    }

    // Force quit (bypass minimize to tray)
    const { setQuitting } = require('../windows/MainWindow');
    setQuitting(true);

    // Stop periodic checks before quitting
    this.stopPeriodicCheck();

    autoUpdater.quitAndInstall();
  }
}

// Singleton instance
const updaterService = new UpdaterService();

module.exports = updaterService;
