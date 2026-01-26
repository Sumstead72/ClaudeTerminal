/**
 * FiveM Service
 * Manages FiveM server processes
 */

const path = require('path');
const pty = require('node-pty');
const { exec } = require('child_process');

class FivemService {
  constructor() {
    this.processes = new Map(); // Map projectIndex -> pty process
    this.mainWindow = null;
  }

  /**
   * Set the main window reference for IPC communication
   * @param {BrowserWindow} window
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Start a FiveM server
   * @param {Object} options
   * @param {number} options.projectIndex - Project index
   * @param {string} options.projectPath - Project path
   * @param {string} options.runCommand - Custom run command
   * @returns {Object} - Result object
   */
  start({ projectIndex, projectPath, runCommand }) {
    // Kill existing process if any
    if (this.processes.has(projectIndex)) {
      this.stop({ projectIndex });
    }

    // Use custom command or default
    const command = runCommand || './FXServer.exe +exec server.cfg';

    // Determine working directory
    let workingDir = projectPath;
    if (process.platform === 'win32') {
      // Check if command starts with a drive letter (e.g., C:\...)
      const absPathMatch = command.match(/^([A-Za-z]:\\[^"\s]+(?:\\[^"\s]*)*)/);
      if (absPathMatch) {
        const exePath = absPathMatch[1];
        workingDir = path.dirname(exePath);
      }
    }

    // On Windows, use cmd.exe for better compatibility
    const shellPath = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

    // Spawn using node-pty for proper terminal emulation
    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: process.env
    });

    this.processes.set(projectIndex, ptyProcess);

    // Handle data output
    ptyProcess.onData(data => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('fivem-data', { projectIndex, data });
      }
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode }) => {
      this.processes.delete(projectIndex);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('fivem-exit', { projectIndex, code: exitCode });
      }
    });

    return { success: true };
  }

  /**
   * Stop a FiveM server
   * @param {Object} options
   * @param {number} options.projectIndex - Project index
   * @returns {Object} - Result object
   */
  stop({ projectIndex }) {
    const proc = this.processes.get(projectIndex);
    if (proc) {
      const pid = proc.pid;
      try {
        // Send quit command first for graceful shutdown
        proc.write('quit\r');

        // Force kill after timeout if still running
        setTimeout(() => {
          if (this.processes.has(projectIndex)) {
            this._forceKill(pid);
            this.processes.delete(projectIndex);
          }
        }, 3000);
      } catch (e) {
        console.error('Error stopping FiveM server:', e);
        // Try force kill anyway
        this._forceKill(pid);
        this.processes.delete(projectIndex);
      }
    }
    return { success: true };
  }

  /**
   * Force kill a process and all its children
   * @param {number} pid - Process ID
   */
  _forceKill(pid) {
    if (!pid) return;

    try {
      if (process.platform === 'win32') {
        // Use taskkill with /T to kill process tree
        exec(`taskkill /F /T /PID ${pid}`, (err) => {
          if (err && !err.message.includes('not found')) {
            console.error('taskkill error:', err.message);
          }
        });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (e) {
      console.error('Force kill error:', e);
    }
  }

  /**
   * Write input to a FiveM server console
   * @param {number} projectIndex
   * @param {string} data
   */
  write(projectIndex, data) {
    const proc = this.processes.get(projectIndex);
    if (proc) {
      proc.write(data);
    }
  }

  /**
   * Resize FiveM terminal
   * @param {number} projectIndex
   * @param {number} cols
   * @param {number} rows
   */
  resize(projectIndex, cols, rows) {
    const proc = this.processes.get(projectIndex);
    if (proc) {
      proc.resize(cols, rows);
    }
  }

  /**
   * Stop all FiveM servers
   */
  stopAll() {
    this.processes.forEach((proc, index) => {
      const pid = proc.pid;
      try {
        proc.write('quit\r');
        setTimeout(() => {
          this._forceKill(pid);
        }, 2000);
      } catch (e) {
        this._forceKill(pid);
      }
    });
    this.processes.clear();
  }

  /**
   * Check if a FiveM server is running
   * @param {number} projectIndex
   * @returns {boolean}
   */
  isRunning(projectIndex) {
    return this.processes.has(projectIndex);
  }

  /**
   * Get running server count
   * @returns {number}
   */
  count() {
    return this.processes.size;
  }

  /**
   * Send a command to a running FiveM server
   * @param {number} projectIndex
   * @param {string} command - Command to execute (e.g., "ensure myresource")
   */
  sendCommand(projectIndex, command) {
    const proc = this.processes.get(projectIndex);
    if (proc) {
      proc.write(command + '\r');
      return { success: true };
    }
    return { success: false, error: 'Server not running' };
  }

  /**
   * Scan resources for a FiveM project
   * @param {string} projectPath - Path to the FiveM server
   * @returns {Object} - List of resources with their status
   */
  scanResources(projectPath) {
    const fs = require('fs');
    const resources = [];
    const ensuredResources = new Set();

    // Parse server.cfg to find ensured resources
    const cfgPath = path.join(projectPath, 'server.cfg');
    if (fs.existsSync(cfgPath)) {
      try {
        const cfgContent = fs.readFileSync(cfgPath, 'utf8');
        const lines = cfgContent.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          // Skip comments
          if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

          // Match ensure, start, or restart commands
          const match = trimmed.match(/^(ensure|start|restart)\s+(.+)$/i);
          if (match) {
            const resourceName = match[2].trim();
            ensuredResources.add(resourceName);
          }
        }
      } catch (e) {
        console.error('Error parsing server.cfg:', e);
      }
    }

    // Scan resources folder
    const resourcesFolders = ['resources', 'resources/[local]', 'resources/[standalone]'];
    const scannedFolders = new Set();

    // Also scan any [category] subfolders
    const mainResourcesPath = path.join(projectPath, 'resources');
    if (fs.existsSync(mainResourcesPath)) {
      try {
        const entries = fs.readdirSync(mainResourcesPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith('[') && entry.name.endsWith(']')) {
            resourcesFolders.push(`resources/${entry.name}`);
          }
        }
      } catch (e) {
        // Ignore errors
      }
    }

    for (const folder of resourcesFolders) {
      const folderPath = path.join(projectPath, folder);
      if (!fs.existsSync(folderPath)) continue;

      try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('[') && entry.name.endsWith(']')) continue; // Skip category folders
          if (scannedFolders.has(entry.name)) continue;

          scannedFolders.add(entry.name);

          // Check if it's a valid resource (has fxmanifest.lua or __resource.lua)
          const resourcePath = path.join(folderPath, entry.name);
          const hasFxManifest = fs.existsSync(path.join(resourcePath, 'fxmanifest.lua'));
          const hasResourceLua = fs.existsSync(path.join(resourcePath, '__resource.lua'));

          if (hasFxManifest || hasResourceLua) {
            resources.push({
              name: entry.name,
              path: resourcePath,
              category: folder.replace('resources/', '').replace('resources', 'root'),
              ensured: ensuredResources.has(entry.name),
              manifest: hasFxManifest ? 'fxmanifest.lua' : '__resource.lua'
            });
          }
        }
      } catch (e) {
        console.error(`Error scanning ${folder}:`, e);
      }
    }

    // Sort: ensured first, then alphabetically
    resources.sort((a, b) => {
      if (a.ensured !== b.ensured) return b.ensured ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, resources, ensuredCount: ensuredResources.size };
  }
}

// Singleton instance
const fivemService = new FivemService();

module.exports = fivemService;
