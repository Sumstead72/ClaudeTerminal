/**
 * Main Process Services - Central Export
 */

const terminalService = require('./TerminalService');
const mcpService = require('./McpService');
const fivemService = require('./FivemService');
const updaterService = require('./UpdaterService');

/**
 * Initialize all services with main window reference
 * @param {BrowserWindow} mainWindow
 */
function initializeServices(mainWindow) {
  terminalService.setMainWindow(mainWindow);
  mcpService.setMainWindow(mainWindow);
  fivemService.setMainWindow(mainWindow);
  updaterService.setMainWindow(mainWindow);
}

/**
 * Cleanup all services before quit
 */
function cleanupServices() {
  terminalService.killAll();
  mcpService.stopAll();
  fivemService.stopAll();
}

module.exports = {
  terminalService,
  mcpService,
  fivemService,
  updaterService,
  initializeServices,
  cleanupServices
};
