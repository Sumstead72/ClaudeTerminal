/**
 * MCP Service
 * Handles MCP server management in the renderer
 */

// Use preload API instead of direct ipcRenderer
const api = window.electron_api;
const { t } = require('../i18n');
const { fs } = window.electron_nodeModules;
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
const { claudeConfigFile, legacyMcpsFile } = require('../utils/paths');

/**
 * Load MCPs from Claude Code config file (~/.claude.json)
 */
async function loadMcps() {
  let mcps = [];

  try {
    // Load from Claude Code config (~/.claude.json)
    if (fs.existsSync(claudeConfigFile)) {
      const config = JSON.parse(await fs.promises.readFile(claudeConfigFile, 'utf8'));

      // Load global MCP servers
      if (config.mcpServers) {
        mcps = Object.entries(config.mcpServers).map(([id, serverConfig]) => {
          const mcp = {
            id,
            name: id,
            type: serverConfig.type || 'stdio',
            enabled: true,
            scope: 'global'
          };

          if (serverConfig.type === 'http') {
            mcp.url = serverConfig.url;
          } else {
            mcp.command = serverConfig.command;
            mcp.args = serverConfig.args || [];
            mcp.env = serverConfig.env || {};
          }

          return mcp;
        });
      }

      // Load project-specific MCP servers
      if (config.projects) {
        Object.entries(config.projects).forEach(([projectPath, projectConfig]) => {
          if (projectConfig.mcpServers && Object.keys(projectConfig.mcpServers).length > 0) {
            Object.entries(projectConfig.mcpServers).forEach(([id, serverConfig]) => {
              // Check if already exists (global takes precedence)
              if (!mcps.find(m => m.id === id)) {
                const mcp = {
                  id,
                  name: id,
                  type: serverConfig.type || 'stdio',
                  enabled: true,
                  scope: 'project',
                  projectPath
                };

                if (serverConfig.type === 'http') {
                  mcp.url = serverConfig.url;
                } else {
                  mcp.command = serverConfig.command;
                  mcp.args = serverConfig.args || [];
                  mcp.env = serverConfig.env || {};
                }

                mcps.push(mcp);
              }
            });
          }
        });
      }
    }

    // Migrate from legacy file if needed
    if (mcps.length === 0 && fs.existsSync(legacyMcpsFile)) {
      const legacyMcps = JSON.parse(await fs.promises.readFile(legacyMcpsFile, 'utf8'));
      if (Array.isArray(legacyMcps)) {
        mcps = legacyMcps;
        await saveMcps(mcps);
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
 * Save MCPs to Claude Code config file (~/.claude.json)
 * Only saves global scope MCPs
 * @param {Array} mcps
 */
async function saveMcps(mcps) {
  try {
    let config = {};

    if (fs.existsSync(claudeConfigFile)) {
      config = JSON.parse(await fs.promises.readFile(claudeConfigFile, 'utf8'));
    }

    config.mcpServers = {};
    mcps.filter(mcp => mcp.scope !== 'project').forEach(mcp => {
      if (mcp.type === 'http') {
        config.mcpServers[mcp.id] = {
          type: 'http',
          url: mcp.url
        };
      } else {
        config.mcpServers[mcp.id] = {
          type: 'stdio',
          command: mcp.command,
          args: mcp.args || [],
          env: mcp.env || {}
        };
      }
    });

    // Atomic write: write to temp file then rename to prevent corruption
    const tmpFile = claudeConfigFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2));
    fs.renameSync(tmpFile, claudeConfigFile);
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
  if (!mcp) return { success: false, error: t('mcp.notFound') };

  setMcpProcessStatus(id, 'starting');
  addMcpLog(id, 'info', t('mcp.starting', { name: mcp.name }));

  try {
    // HTTP servers are external - just mark as running
    if (mcp.type === 'http') {
      setMcpProcessStatus(id, 'running');
      addMcpLog(id, 'info', t('mcp.httpAvailable', { url: mcp.url }));
      return { success: true };
    }

    // stdio servers need to be spawned
    const result = await api.mcp.start({
      id,
      command: mcp.command,
      args: mcp.args,
      env: mcp.env
    });

    if (result.success) {
      setMcpProcessStatus(id, 'running');
      addMcpLog(id, 'info', t('mcp.started'));
    } else {
      setMcpProcessStatus(id, 'error');
      addMcpLog(id, 'stderr', result.error || t('mcp.startFailed'));
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
  const mcp = getMcp(id);
  addMcpLog(id, 'info', t('mcp.stopping'));

  try {
    // HTTP servers are external - just mark as stopped
    if (mcp && mcp.type === 'http') {
      setMcpProcessStatus(id, 'stopped');
      addMcpLog(id, 'info', t('mcp.disconnected'));
      return { success: true };
    }

    const result = await api.mcp.stop({ id });
    setMcpProcessStatus(id, 'stopped');
    addMcpLog(id, 'info', t('mcp.stopped'));
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
  api.mcp.onOutput(({ id, type, data }) => {
    addMcpLog(id, type, data);
    if (onOutputCallback) {
      onOutputCallback(id, type, data);
    }
  });

  api.mcp.onExit(({ id, code }) => {
    setMcpProcessStatus(id, 'stopped');
    addMcpLog(id, 'info', t('mcp.exitedWithCode', { code }));
    if (onExitCallback) {
      onExitCallback(id, code);
    }
  });
}

/**
 * Create a new MCP configuration
 * @param {Object} config
 * @returns {Promise<Object>}
 */
async function createMcp(config) {
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
  await saveMcps(getMcps());

  return mcp;
}

/**
 * Update MCP configuration
 * @param {string} id
 * @param {Object} updates
 */
async function updateMcpConfig(id, updates) {
  updateMcp(id, updates);
  await saveMcps(getMcps());
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
  await saveMcps(getMcps());
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
