/**
 * Minecraft Service
 * Manages Minecraft Java server processes
 */

const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { exec, execSync } = require('child_process');

class MinecraftService {
  constructor() {
    this.processes = new Map(); // Map projectIndex -> pty process
    this.playerCounts = new Map(); // Map projectIndex -> number
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
   * Detect server setup from a project directory
   * @param {string} projectPath
   * @returns {Object|null} { serverType, serverJar, launchScript }
   */
  detectServerSetup(projectPath) {
    if (!fs.existsSync(projectPath)) return null;

    // Check for Forge/Fabric launch scripts first (filter by OS)
    const scripts = process.platform === 'win32'
      ? ['run.bat', 'start.bat', 'launch.bat']
      : ['run.sh', 'start.sh', 'launch.sh'];
    for (const script of scripts) {
      const scriptPath = path.join(projectPath, script);
      if (fs.existsSync(scriptPath)) {
        const content = fs.readFileSync(scriptPath, 'utf8').toLowerCase();
        const serverType = content.includes('forge') ? 'forge'
          : content.includes('fabric') ? 'fabric'
          : 'script';
        return { serverType, launchScript: scriptPath, serverJar: null };
      }
    }

    // Check for known JAR patterns
    const jarPatterns = [
      { pattern: /paper.*\.jar$/i, type: 'paper' },
      { pattern: /spigot.*\.jar$/i, type: 'spigot' },
      { pattern: /craftbukkit.*\.jar$/i, type: 'spigot' },
      { pattern: /forge.*\.jar$/i, type: 'forge' },
      { pattern: /fabric.*\.jar$/i, type: 'fabric' },
      { pattern: /purpur.*\.jar$/i, type: 'paper' },
      { pattern: /server\.jar$/i, type: 'vanilla' }
    ];

    try {
      const files = fs.readdirSync(projectPath);
      for (const { pattern, type } of jarPatterns) {
        const jar = files.find(f => pattern.test(f));
        if (jar) {
          return { serverType: type, serverJar: path.join(projectPath, jar), launchScript: null };
        }
      }

      // Any remaining .jar file
      const anyJar = files.find(f => f.endsWith('.jar'));
      if (anyJar) {
        return { serverType: 'vanilla', serverJar: path.join(projectPath, anyJar), launchScript: null };
      }
    } catch (e) {
      console.error('[Minecraft] Error scanning directory:', e);
    }

    return null;
  }

  /**
   * Find Java executable on the system
   * @returns {string}
   */
  findJavaExecutable() {
    // Check JAVA_HOME first
    if (process.env.JAVA_HOME) {
      const javaInHome = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(javaInHome)) {
        return javaInHome;
      }
    }

    // Try system PATH
    try {
      const cmd = process.platform === 'win32' ? 'where java' : 'which java';
      const result = execSync(cmd, { encoding: 'utf8', timeout: 3000 }).trim();
      if (result) return result.split('\n')[0].trim();
    } catch (e) {
      // Fall back to bare 'java'
    }

    return 'java';
  }

  /**
   * Build the launch command from config
   * @param {Object} minecraftConfig
   * @param {string} projectPath
   * @returns {Object} { shellPath, shellArgs, workingDir }
   */
  buildLaunchCommand(minecraftConfig, projectPath) {
    const { serverType, serverJar, launchScript, jvmMemory = '2G' } = minecraftConfig;
    let workingDir = projectPath;

    if (launchScript && fs.existsSync(launchScript)) {
      workingDir = path.dirname(launchScript);
      const scriptName = path.basename(launchScript);

      if (process.platform === 'win32') {
        return { shellPath: 'cmd.exe', shellArgs: ['/c', scriptName], workingDir };
      } else {
        return { shellPath: 'bash', shellArgs: ['-c', `./${scriptName}`], workingDir };
      }
    }

    if (serverJar) {
      workingDir = path.dirname(serverJar);
      const jarName = path.basename(serverJar);
      const javaExe = this.findJavaExecutable();
      const mem = jvmMemory || '2G';
      const javaCmd = `"${javaExe}" -Xmx${mem} -Xms${mem} -jar "${jarName}" nogui`;

      if (process.platform === 'win32') {
        return { shellPath: 'cmd.exe', shellArgs: ['/c', javaCmd], workingDir };
      } else {
        return { shellPath: 'bash', shellArgs: ['-c', javaCmd], workingDir };
      }
    }

    // Fallback: try to detect
    const detected = this.detectServerSetup(projectPath);
    if (detected) {
      return this.buildLaunchCommand({ ...minecraftConfig, ...detected }, projectPath);
    }

    throw new Error('No server JAR or launch script found');
  }

  /**
   * Strip ANSI escape codes from text
   * @param {string} text
   * @returns {string}
   */
  _stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*[mGKHJA-Za-z]/g, '');
  }

  /**
   * Send status event to renderer
   * @param {number} projectIndex
   * @param {string} status
   */
  _sendStatus(projectIndex, status) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('minecraft-status', { projectIndex, status });
    }
  }

  /**
   * Send player count event to renderer
   * @param {number} projectIndex
   * @param {number} count
   */
  _sendPlayerCount(projectIndex, count) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('minecraft-playercount', { projectIndex, count });
    }
  }

  /**
   * Start a Minecraft server
   * @param {Object} options
   * @param {number} options.projectIndex
   * @param {string} options.projectPath
   * @param {Object} options.minecraftConfig
   * @returns {Object}
   */
  start({ projectIndex, projectPath, minecraftConfig = {} }) {
    // Kill existing process if any
    if (this.processes.has(projectIndex)) {
      this.stop({ projectIndex });
    }

    this.playerCounts.set(projectIndex, 0);
    this._sendStatus(projectIndex, 'starting');

    let shellPath, shellArgs, workingDir;
    try {
      ({ shellPath, shellArgs, workingDir } = this.buildLaunchCommand(minecraftConfig, projectPath));
    } catch (e) {
      this._sendStatus(projectIndex, 'stopped');
      return { success: false, error: e.message };
    }

    const ptyProcess = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: process.env
    });

    this.processes.set(projectIndex, ptyProcess);

    ptyProcess.onData(data => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('minecraft-data', { projectIndex, data });
      }

      const clean = this._stripAnsi(data);

      // Server ready
      if (/Done \([\d.]+s\)! For help/i.test(clean)) {
        this._sendStatus(projectIndex, 'running');
      }

      // Player count from /list command
      const listMatch = clean.match(/There are (\d+) of a max(?: of)? \d+ players online/i);
      if (listMatch) {
        const count = parseInt(listMatch[1], 10);
        this.playerCounts.set(projectIndex, count);
        this._sendPlayerCount(projectIndex, count);
        return;
      }

      // Player join
      if (/\w+\s+joined the game/i.test(clean)) {
        const count = (this.playerCounts.get(projectIndex) || 0) + 1;
        this.playerCounts.set(projectIndex, count);
        this._sendPlayerCount(projectIndex, count);
      }

      // Player leave / disconnect
      if (/\w+\s+(left the game|lost connection)/i.test(clean)) {
        const count = Math.max(0, (this.playerCounts.get(projectIndex) || 0) - 1);
        this.playerCounts.set(projectIndex, count);
        this._sendPlayerCount(projectIndex, count);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.processes.delete(projectIndex);
      this.playerCounts.set(projectIndex, 0);
      this._sendStatus(projectIndex, 'stopped');
      this._sendPlayerCount(projectIndex, 0);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('minecraft-exit', { projectIndex, code: exitCode });
      }
    });

    return { success: true };
  }

  /**
   * Stop a Minecraft server
   * @param {Object} options
   * @param {number} options.projectIndex
   * @returns {Object}
   */
  stop({ projectIndex }) {
    const proc = this.processes.get(projectIndex);
    if (proc) {
      const pid = proc.pid;
      try {
        // Send stop command for graceful shutdown
        proc.write('stop\r');

        // Force kill after timeout (JVM needs more time than FiveM)
        setTimeout(() => {
          if (this.processes.has(projectIndex)) {
            this._forceKill(pid);
            this.processes.delete(projectIndex);
          }
        }, 5000);
      } catch (e) {
        console.error('[Minecraft] Error stopping server:', e);
        this._forceKill(pid);
        this.processes.delete(projectIndex);
      }
    }
    return { success: true };
  }

  /**
   * Force kill a process and its children
   * @param {number} pid
   */
  _forceKill(pid) {
    if (!pid) return;
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /F /T /PID ${pid}`, (err) => {
          if (err && !err.message.includes('not found')) {
            console.error('[Minecraft] taskkill error:', err.message);
          }
        });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (e) {
      console.error('[Minecraft] Force kill error:', e);
    }
  }

  /**
   * Write input to a Minecraft server console
   * @param {number} projectIndex
   * @param {string} data
   */
  write(projectIndex, data) {
    const proc = this.processes.get(projectIndex);
    if (proc) proc.write(data);
  }

  /**
   * Resize Minecraft terminal
   * @param {number} projectIndex
   * @param {number} cols
   * @param {number} rows
   */
  resize(projectIndex, cols, rows) {
    const proc = this.processes.get(projectIndex);
    if (proc) proc.resize(cols, rows);
  }

  /**
   * Stop all Minecraft servers
   */
  stopAll() {
    this.processes.forEach((proc) => {
      const pid = proc.pid;
      try {
        proc.write('stop\r');
        setTimeout(() => this._forceKill(pid), 3000);
      } catch (e) {
        this._forceKill(pid);
      }
    });
    this.processes.clear();
    this.playerCounts.clear();
  }

  /**
   * Check if a Minecraft server is running
   * @param {number} projectIndex
   * @returns {boolean}
   */
  isRunning(projectIndex) {
    return this.processes.has(projectIndex);
  }

  /**
   * Get current player count
   * @param {number} projectIndex
   * @returns {number}
   */
  getPlayerCount(projectIndex) {
    return this.playerCounts.get(projectIndex) || 0;
  }
}

// Singleton instance
const minecraftService = new MinecraftService();

module.exports = minecraftService;
