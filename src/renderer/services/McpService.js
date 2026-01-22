/**
 * MCP Service
 * Handles MCP server management in the renderer
 */

const { ipcRenderer } = require('electron');
const fs = require('fs');
const {
  getMcps,
  getMcp,
  setMcps,
  addMcp,
  updateMcp,
  removeMcp,
  getMcpProcess,
  setMcpProcessStatus,
  addMcpLog,
  clearMcpLogs,
  setSelectedMcp,
  initMcpProcess
} = require('../state');
const { claudeSettingsFile, legacyMcpsFile } = require('../utils/paths');

/**
 * Load MCPs from Claude settings file
 */
function loadMcps() {
  let mcps = [];

  try {
    // Load from Claude settings
    if (fs.existsSync(claudeSettingsFile)) {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));

      if (settings.mcpServers) {
        mcps = Object.entries(settings.mcpServers).map(([id, config]) => ({
          id,
          name: id,
          command: config.command,
          args: config.args || [],
          env: config.env || {},
          enabled: true
        }));
      }
    }

    // Migrate from legacy file if needed
    if (mcps.length === 0 && fs.existsSync(legacyMcpsFile)) {
      const legacyMcps = JSON.parse(fs.readFileSync(legacyMcpsFile, 'utf8'));
      if (Array.isArray(legacyMcps)) {
        mcps = legacyMcps;
        saveMcps(mcps);
        // Remove legacy file after migration
        fs.unlinkSync(legacyMcpsFile);
      }
    }
  } catch (e) {
    console.error('Error loading MCPs:', e);
  }

  setMcps(mcps);

  // Initialize process tracking
  mcps.forEach(mcp => initMcpProcess(mcp.id));

  return mcps;
}

/**
 * Save MCPs to Claude settings file
 * @param {Array} mcps
 */
function saveMcps(mcps) {
  try {
    let settings = {};

    if (fs.existsSync(claudeSettingsFile)) {
      settings = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
    }

    settings.mcpServers = {};
    mcps.forEach(mcp => {
      settings.mcpServers[mcp.id] = {
        command: mcp.command,
        args: mcp.args || [],
        env: mcp.env || {}
      };
    });

    fs.writeFileSync(claudeSettingsFile, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Error saving MCPs:', e);
  }
}

/**
 * Start an MCP server
 * @param {string} id - MCP ID
 * @returns {Promise<Object>}
 */
async function startMcp(id) {
  const mcp = getMcp(id);
  if (!mcp) return { success: false, error: 'MCP not found' };

  setMcpProcessStatus(id, 'starting');
  addMcpLog(id, 'info', `Starting ${mcp.name}...`);

  try {
    const result = await ipcRenderer.invoke('mcp-start', {
      id,
      command: mcp.command,
      args: mcp.args,
      env: mcp.env
    });

    if (result.success) {
      setMcpProcessStatus(id, 'running');
      addMcpLog(id, 'info', 'Started successfully');
    } else {
      setMcpProcessStatus(id, 'error');
      addMcpLog(id, 'stderr', result.error || 'Failed to start');
    }

    return result;
  } catch (e) {
    setMcpProcessStatus(id, 'error');
    addMcpLog(id, 'stderr', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Stop an MCP server
 * @param {string} id - MCP ID
 * @returns {Promise<Object>}
 */
async function stopMcp(id) {
  addMcpLog(id, 'info', 'Stopping...');

  try {
    const result = await ipcRenderer.invoke('mcp-stop', { id });
    setMcpProcessStatus(id, 'stopped');
    addMcpLog(id, 'info', 'Stopped');
    return result;
  } catch (e) {
    addMcpLog(id, 'stderr', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Register MCP IPC listeners
 * @param {Function} onOutputCallback - Callback for MCP output
 * @param {Function} onExitCallback - Callback for MCP exit
 */
function registerMcpListeners(onOutputCallback, onExitCallback) {
  ipcRenderer.on('mcp-output', (event, { id, type, data }) => {
    addMcpLog(id, type, data);
    if (onOutputCallback) {
      onOutputCallback(id, type, data);
    }
  });

  ipcRenderer.on('mcp-exit', (event, { id, code }) => {
    setMcpProcessStatus(id, 'stopped');
    addMcpLog(id, 'info', `Exited with code ${code}`);
    if (onExitCallback) {
      onExitCallback(id, code);
    }
  });
}

/**
 * Create a new MCP configuration
 * @param {Object} config
 * @returns {Object}
 */
function createMcp(config) {
  const mcp = {
    id: config.id || `mcp-${Date.now()}`,
    name: config.name || config.id,
    command: config.command,
    args: config.args || [],
    env: config.env || {},
    enabled: true
  };

  addMcp(mcp);
  initMcpProcess(mcp.id);
  saveMcps(getMcps());

  return mcp;
}

/**
 * Update MCP configuration
 * @param {string} id
 * @param {Object} updates
 */
function updateMcpConfig(id, updates) {
  updateMcp(id, updates);
  saveMcps(getMcps());
}

/**
 * Delete an MCP
 * @param {string} id
 */
async function deleteMcp(id) {
  // Stop if running
  const process = getMcpProcess(id);
  if (process.status === 'running') {
    await stopMcp(id);
  }

  removeMcp(id);
  saveMcps(getMcps());
}

module.exports = {
  loadMcps,
  saveMcps,
  startMcp,
  stopMcp,
  registerMcpListeners,
  createMcp,
  updateMcpConfig,
  deleteMcp,
  getMcps,
  getMcp,
  getMcpProcess,
  clearMcpLogs,
  setSelectedMcp
};
