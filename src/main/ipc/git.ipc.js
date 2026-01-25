/**
 * Git IPC Handlers
 * Handles git-related IPC communication
 */

const { ipcMain } = require('electron');
const { getGitInfo, getGitInfoFull, getGitStatusQuick, getGitStatusDetailed, gitPull, gitPush, gitMerge, gitMergeAbort, gitMergeContinue, getMergeConflicts, isMergeInProgress, gitClone, gitStageFiles, gitCommit, getProjectStats, getBranches, getCurrentBranch, checkoutBranch } = require('../utils/git');
const GitHubAuthService = require('../services/GitHubAuthService');

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

  // Get list of branches
  ipcMain.handle('git-branches', async (event, { projectPath }) => {
    return getBranches(projectPath);
  });

  // Get current branch
  ipcMain.handle('git-current-branch', async (event, { projectPath }) => {
    return getCurrentBranch(projectPath);
  });

  // Checkout branch
  ipcMain.handle('git-checkout', async (event, { projectPath, branch }) => {
    return checkoutBranch(projectPath, branch);
  });

  // Git merge
  ipcMain.handle('git-merge', async (event, { projectPath, branch }) => {
    return gitMerge(projectPath, branch);
  });

  // Git merge abort
  ipcMain.handle('git-merge-abort', async (event, { projectPath }) => {
    return gitMergeAbort(projectPath);
  });

  // Git merge continue
  ipcMain.handle('git-merge-continue', async (event, { projectPath }) => {
    return gitMergeContinue(projectPath);
  });

  // Get merge conflicts
  ipcMain.handle('git-merge-conflicts', async (event, { projectPath }) => {
    return getMergeConflicts(projectPath);
  });

  // Check if merge in progress
  ipcMain.handle('git-merge-in-progress', async (event, { projectPath }) => {
    return isMergeInProgress(projectPath);
  });

  // Git clone (auto-uses GitHub token if available)
  ipcMain.handle('git-clone', async (event, { repoUrl, targetPath }) => {
    // Get GitHub token if available
    const token = await GitHubAuthService.getTokenForGit();
    return gitClone(repoUrl, targetPath, { token });
  });

  // Git status detailed (for changes panel)
  ipcMain.handle('git-status-detailed', async (event, { projectPath }) => {
    return getGitStatusDetailed(projectPath);
  });

  // Stage specific files
  ipcMain.handle('git-stage-files', async (event, { projectPath, files }) => {
    return gitStageFiles(projectPath, files);
  });

  // Create commit
  ipcMain.handle('git-commit', async (event, { projectPath, message }) => {
    return gitCommit(projectPath, message);
  });
}

module.exports = { registerGitHandlers };
