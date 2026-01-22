/**
 * Git IPC Handlers
 * Handles git-related IPC communication
 */

const { ipcMain } = require('electron');
const { getGitInfo, getGitInfoFull, getGitStatusQuick, gitPull, gitPush, getProjectStats } = require('../utils/git');

/**
 * Register git IPC handlers
 */
function registerGitHandlers() {
  // Get git info for dashboard (basic)
  ipcMain.handle('git-info', async (event, projectPath) => {
    return getGitInfo(projectPath);
  });

  // Get full git info for dashboard (comprehensive)
  ipcMain.handle('git-info-full', async (event, projectPath) => {
    return getGitInfoFull(projectPath);
  });

  // Get project statistics (lines of code, etc.)
  ipcMain.handle('project-stats', async (event, projectPath) => {
    return getProjectStats(projectPath);
  });

  // Git pull
  ipcMain.handle('git-pull', async (event, { projectPath }) => {
    return gitPull(projectPath);
  });

  // Git push
  ipcMain.handle('git-push', async (event, { projectPath }) => {
    return gitPush(projectPath);
  });

  // Git status (quick check)
  ipcMain.handle('git-status-quick', async (event, { projectPath }) => {
    return getGitStatusQuick(projectPath);
  });
}

module.exports = { registerGitHandlers };
