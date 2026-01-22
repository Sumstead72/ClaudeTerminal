/**
 * FiveM Service
 * Handles FiveM server management in the renderer
 */

const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const {
  getFivemServer,
  setFivemServerStatus,
  addFivemLog,
  clearFivemLogs,
  initFivemServer,
  getProject,
  getProjectIndex
} = require('../state');

// Terminal theme for FiveM console
const FIVEM_TERMINAL_THEME = {
  background: '#0d0d0d',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#0d0d0d',
  selection: 'rgba(255, 255, 255, 0.2)',
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#d7ba7d',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4'
};

// Store terminal instances for FiveM consoles
const fivemTerminals = new Map();

/**
 * Start a FiveM server
 * @param {number} projectIndex
 * @returns {Promise<Object>}
 */
async function startFivemServer(projectIndex) {
  const { projectsState } = require('../state');
  const project = projectsState.get().projects[projectIndex];
  if (!project) return { success: false, error: 'Project not found' };

  initFivemServer(projectIndex);
  setFivemServerStatus(projectIndex, 'starting');

  try {
    const result = await ipcRenderer.invoke('fivem-start', {
      projectIndex,
      projectPath: project.path,
      runCommand: project.runCommand
    });

    if (result.success) {
      setFivemServerStatus(projectIndex, 'running');
    } else {
      setFivemServerStatus(projectIndex, 'stopped');
    }

    return result;
  } catch (e) {
    setFivemServerStatus(projectIndex, 'stopped');
    return { success: false, error: e.message };
  }
}

/**
 * Stop a FiveM server
 * @param {number} projectIndex
 * @returns {Promise<Object>}
 */
async function stopFivemServer(projectIndex) {
  try {
    const result = await ipcRenderer.invoke('fivem-stop', { projectIndex });
    setFivemServerStatus(projectIndex, 'stopped');
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Create a terminal for FiveM console
 * @param {number} projectIndex
 * @returns {Object} - Terminal and fitAddon
 */
function createFivemTerminal(projectIndex) {
  const terminal = new Terminal({
    theme: FIVEM_TERMINAL_THEME,
    fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace',
    cursorBlink: false,
    disableStdin: false,
    scrollback: 10000
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Handle input to FiveM console
  terminal.onData(data => {
    ipcRenderer.send('fivem-input', { projectIndex, data });
  });

  fivemTerminals.set(projectIndex, { terminal, fitAddon });

  return { terminal, fitAddon };
}

/**
 * Get or create FiveM terminal
 * @param {number} projectIndex
 * @returns {Object}
 */
function getFivemTerminal(projectIndex) {
  if (!fivemTerminals.has(projectIndex)) {
    return createFivemTerminal(projectIndex);
  }
  return fivemTerminals.get(projectIndex);
}

/**
 * Mount FiveM terminal to DOM
 * @param {number} projectIndex
 * @param {HTMLElement} container
 */
function mountFivemTerminal(projectIndex, container) {
  const { terminal, fitAddon } = getFivemTerminal(projectIndex);

  terminal.open(container);
  fitAddon.fit();

  // Write existing logs
  const server = getFivemServer(projectIndex);
  if (server.logs.length > 0) {
    terminal.write(server.logs.join(''));
  }

  // Send size
  ipcRenderer.send('fivem-resize', {
    projectIndex,
    cols: terminal.cols,
    rows: terminal.rows
  });
}

/**
 * Fit FiveM terminal
 * @param {number} projectIndex
 */
function fitFivemTerminal(projectIndex) {
  const termData = fivemTerminals.get(projectIndex);
  if (termData) {
    termData.fitAddon.fit();
    ipcRenderer.send('fivem-resize', {
      projectIndex,
      cols: termData.terminal.cols,
      rows: termData.terminal.rows
    });
  }
}

/**
 * Dispose FiveM terminal
 * @param {number} projectIndex
 */
function disposeFivemTerminal(projectIndex) {
  const termData = fivemTerminals.get(projectIndex);
  if (termData) {
    termData.terminal.dispose();
    fivemTerminals.delete(projectIndex);
  }
}

/**
 * Register FiveM IPC listeners
 * @param {Function} onDataCallback - Callback for FiveM data
 * @param {Function} onExitCallback - Callback for FiveM exit
 */
function registerFivemListeners(onDataCallback, onExitCallback) {
  ipcRenderer.on('fivem-data', (event, { projectIndex, data }) => {
    addFivemLog(projectIndex, data);

    // Write to terminal if exists
    const termData = fivemTerminals.get(projectIndex);
    if (termData) {
      termData.terminal.write(data);
    }

    if (onDataCallback) {
      onDataCallback(projectIndex, data);
    }
  });

  ipcRenderer.on('fivem-exit', (event, { projectIndex, code }) => {
    setFivemServerStatus(projectIndex, 'stopped');

    const termData = fivemTerminals.get(projectIndex);
    if (termData) {
      termData.terminal.write(`\r\n[Server exited with code ${code}]\r\n`);
    }

    if (onExitCallback) {
      onExitCallback(projectIndex, code);
    }
  });
}

/**
 * Get FiveM server status
 * @param {number} projectIndex
 * @returns {string}
 */
function getFivemServerStatus(projectIndex) {
  return getFivemServer(projectIndex).status;
}

/**
 * Check if FiveM server is running
 * @param {number} projectIndex
 * @returns {boolean}
 */
function isFivemServerRunning(projectIndex) {
  return getFivemServer(projectIndex).status === 'running';
}

module.exports = {
  startFivemServer,
  stopFivemServer,
  createFivemTerminal,
  getFivemTerminal,
  mountFivemTerminal,
  fitFivemTerminal,
  disposeFivemTerminal,
  registerFivemListeners,
  getFivemServerStatus,
  isFivemServerRunning,
  getFivemServer,
  clearFivemLogs
};
