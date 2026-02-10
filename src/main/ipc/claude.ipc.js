/**
 * Claude IPC Handlers
 * Handles Claude Code session-related IPC communication
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

/**
 * Encode project path to match Claude's folder naming convention
 * @param {string} projectPath - The project path
 * @returns {string} - Encoded path for folder name
 */
function encodeProjectPath(projectPath) {
  // Claude uses path with : and \ replaced by -
  return projectPath.replace(/:/g, '-').replace(/\\/g, '-').replace(/\//g, '-');
}

/**
 * Get the project sessions directory path
 * @param {string} projectPath - The project path
 * @returns {string} - Path to project sessions directory
 */
function getProjectSessionsDir(projectPath) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const encodedPath = encodeProjectPath(projectPath);
  return path.join(claudeDir, encodedPath);
}

/**
 * Extract first user prompt from a .jsonl session file (reads only first few lines)
 * @param {string} filePath - Path to the .jsonl file
 * @returns {Promise<{firstPrompt: string, sessionId: string, isSidechain: boolean, gitBranch: string}>}
 */
async function extractSessionInfo(filePath) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let firstPrompt = '';
    let sessionId = '';
    let isSidechain = false;
    let gitBranch = '';
    let messageCount = 0;
    let linesRead = 0;
    const maxLines = 30; // Only read first 30 lines for speed

    rl.on('line', (line) => {
      linesRead++;
      try {
        const obj = JSON.parse(line);

        if (obj.type === 'user' || obj.type === 'assistant') {
          messageCount++;
        }

        // Extract info from first user message
        if (obj.type === 'user' && !firstPrompt) {
          sessionId = obj.sessionId || '';
          isSidechain = obj.isSidechain || false;
          gitBranch = obj.gitBranch || '';

          const content = obj.message?.content;
          if (typeof content === 'string') {
            firstPrompt = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find(b => b.type === 'text');
            if (textBlock) firstPrompt = textBlock.text;
          }
        }
      } catch (e) { /* skip malformed lines */ }

      if (linesRead >= maxLines) {
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => {
      resolve({ firstPrompt, sessionId, isSidechain, gitBranch, messageCount });
    });

    rl.on('error', () => {
      resolve({ firstPrompt: '', sessionId: '', isSidechain: false, gitBranch: '', messageCount: 0 });
    });
  });
}

/**
 * Get Claude sessions for a project by scanning .jsonl files directly
 * @param {string} projectPath - The project path
 * @returns {Promise<Array>} - Array of session objects
 */
async function getClaudeSessions(projectPath) {
  try {
    const sessionsDir = getProjectSessionsDir(projectPath);

    let files;
    try {
      files = await fs.promises.readdir(sessionsDir);
    } catch {
      return [];
    }

    // Filter .jsonl files only
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) return [];

    // Get file stats and parse session info in parallel
    const sessionsPromises = jsonlFiles.map(async (file) => {
      const filePath = path.join(sessionsDir, file);
      try {
        const [stat, info] = await Promise.all([
          fs.promises.stat(filePath),
          extractSessionInfo(filePath)
        ]);

        // Skip sidechain sessions
        if (info.isSidechain) return null;

        // Skip files that are too small (empty/aborted sessions)
        if (stat.size < 200) return null;

        const sessionId = info.sessionId || file.replace('.jsonl', '');

        return {
          sessionId,
          summary: '',
          firstPrompt: info.firstPrompt || '',
          messageCount: info.messageCount || 0,
          modified: stat.mtime.toISOString(),
          size: stat.size,
          gitBranch: info.gitBranch
        };
      } catch {
        return null;
      }
    });

    const allSessions = (await Promise.all(sessionsPromises)).filter(Boolean);

    // Try to enrich with summaries from sessions-index.json
    try {
      const indexPath = path.join(sessionsDir, 'sessions-index.json');
      const rawData = await fs.promises.readFile(indexPath, 'utf8');
      const data = JSON.parse(rawData);
      if (data.entries && Array.isArray(data.entries)) {
        const indexMap = new Map(data.entries.map(e => [e.sessionId, e]));
        for (const session of allSessions) {
          const indexed = indexMap.get(session.sessionId);
          if (indexed) {
            session.summary = indexed.summary || '';
            if (indexed.messageCount) session.messageCount = indexed.messageCount;
          }
        }
      }
    } catch { /* index may not exist or be stale, that's ok */ }

    // Sort by modified date (most recent first) and limit to 50
    return allSessions
      .sort((a, b) => new Date(b.modified) - new Date(a.modified))
      .slice(0, 50)
      .map(({ size, ...session }) => session);
  } catch (error) {
    console.error('Error reading Claude sessions:', error);
    return [];
  }
}

/**
 * Register Claude IPC handlers
 */
function registerClaudeHandlers() {
  // Get Claude sessions for a project
  ipcMain.handle('claude-sessions', async (event, projectPath) => {
    return getClaudeSessions(projectPath);
  });
}

module.exports = { registerClaudeHandlers };
