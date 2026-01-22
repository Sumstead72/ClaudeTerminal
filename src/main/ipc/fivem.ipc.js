/**
 * FiveM IPC Handlers
 * Handles FiveM server-related IPC communication
 */

const { ipcMain } = require('electron');
const fivemService = require('../services/FivemService');

/**
 * Register FiveM IPC handlers
 */
function registerFivemHandlers() {
  // Start FiveM server
  ipcMain.handle('fivem-start', async (event, { projectIndex, projectPath, runCommand }) => {
    return fivemService.start({ projectIndex, projectPath, runCommand });
  });

  // Stop FiveM server
  ipcMain.handle('fivem-stop', async (event, { projectIndex }) => {
    return fivemService.stop({ projectIndex });
  });

  // Send input to FiveM server
  ipcMain.on('fivem-input', (event, { projectIndex, data }) => {
    fivemService.write(projectIndex, data);
  });

  // Resize FiveM terminal
  ipcMain.on('fivem-resize', (event, { projectIndex, cols, rows }) => {
    fivemService.resize(projectIndex, cols, rows);
  });
}

module.exports = { registerFivemHandlers };
