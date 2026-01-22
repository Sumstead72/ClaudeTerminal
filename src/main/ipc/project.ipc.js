/**
 * Project IPC Handlers
 * Handles project scanning and statistics
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Register project IPC handlers
 */
function registerProjectHandlers() {
  // Scan TODO/FIXME in project
  ipcMain.handle('scan-todos', async (event, projectPath) => {
    const todos = [];
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.lua', '.go', '.rs', '.java', '.cpp', '.c', '.h'];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor'];

    function scanDir(dir, depth = 0) {
      if (depth > 5) return; // Depth limit
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (ignoreDirs.includes(item)) continue;
          const fullPath = path.join(dir, item);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              scanDir(fullPath, depth + 1);
            } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
              scanFile(fullPath, projectPath);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    function scanFile(filePath, basePath) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const relativePath = path.relative(basePath, filePath);

        lines.forEach((line, i) => {
          const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i) ||
                            line.match(/#\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i) ||
                            line.match(/--\s*(TODO|FIXME|HACK|XXX)[:\s]*(.*)/i);
          if (todoMatch && todos.length < 50) {
            todos.push({
              type: todoMatch[1].toUpperCase(),
              text: todoMatch[2].trim() || '(no description)',
              file: relativePath,
              line: i + 1
            });
          }
        });
      } catch (e) {}
    }

    scanDir(projectPath);
    return todos;
  });
}

module.exports = { registerProjectHandlers };
