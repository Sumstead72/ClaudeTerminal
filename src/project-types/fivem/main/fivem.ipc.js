/**
 * FiveM IPC Handlers
 * Handles FiveM server-related IPC communication
 */

const { ipcMain } = require('electron');
const fivemService = require('./FivemService');

/**
 * Register FiveM IPC handlers
 */
function registerHandlers() {
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

  // Scan resources
  ipcMain.handle('fivem-scan-resources', async (event, { projectPath }) => {
    return fivemService.scanResources(projectPath);
  });

  // Send command to FiveM server (ensure, stop, start, restart resource)
  ipcMain.handle('fivem-resource-command', async (event, { projectIndex, command }) => {
    return fivemService.sendCommand(projectIndex, command);
  });

  // Create a new resource with template
  ipcMain.handle('fivem-create-resource', async (event, params) => {
    return fivemService.createResource(params);
  });

  // Read fxmanifest.lua → raw + parsed fields
  ipcMain.handle('fivem-read-manifest', async (event, params) => {
    return fivemService.readManifest(params);
  });

  // Write fxmanifest.lua (atomic)
  ipcMain.handle('fivem-write-manifest', async (event, params) => {
    return fivemService.writeManifest(params);
  });
}

module.exports = { registerHandlers, registerFivemHandlers: registerHandlers };
