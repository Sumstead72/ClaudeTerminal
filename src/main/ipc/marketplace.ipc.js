/**
 * Marketplace IPC Handlers
 * Handles marketplace skill discovery and installation
 */

const { ipcMain } = require('electron');
const MarketplaceService = require('../services/MarketplaceService');

/**
 * Register Marketplace IPC handlers
 */
function registerMarketplaceHandlers() {
  // Search skills
  ipcMain.handle('marketplace-search', async (event, { query, limit }) => {
    try {
      const result = await MarketplaceService.searchSkills(query, limit);
      return { success: true, ...result };
    } catch (e) {
      console.error('[Marketplace IPC] Search error:', e);
      return { success: false, error: e.message };
    }
  });

  // Get featured/popular skills
  ipcMain.handle('marketplace-featured', async (event, { limit }) => {
    try {
      const result = await MarketplaceService.getFeatured(limit);
      return { success: true, ...result };
    } catch (e) {
      console.error('[Marketplace IPC] Featured error:', e);
      return { success: false, error: e.message };
    }
  });

  // Get skill README
  ipcMain.handle('marketplace-readme', async (event, { source, skillId }) => {
    try {
      const readme = await MarketplaceService.getSkillReadme(source, skillId);
      return { success: true, readme };
    } catch (e) {
      console.error('[Marketplace IPC] Readme error:', e);
      return { success: false, error: e.message };
    }
  });

  // Install a skill
  ipcMain.handle('marketplace-install', async (event, { skill }) => {
    try {
      const result = await MarketplaceService.installSkill(skill);
      return { success: true, ...result };
    } catch (e) {
      console.error('[Marketplace IPC] Install error:', e);
      return { success: false, error: e.message };
    }
  });

  // Uninstall a skill
  ipcMain.handle('marketplace-uninstall', async (event, { skillId }) => {
    try {
      const result = await MarketplaceService.uninstallSkill(skillId);
      return { success: true, ...result };
    } catch (e) {
      console.error('[Marketplace IPC] Uninstall error:', e);
      return { success: false, error: e.message };
    }
  });

  // Get installed marketplace skills
  ipcMain.handle('marketplace-installed', async () => {
    try {
      const installed = MarketplaceService.getInstalled();
      return { success: true, installed };
    } catch (e) {
      console.error('[Marketplace IPC] Installed error:', e);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerMarketplaceHandlers };
