/**
 * Explorer IPC Handlers - File Watcher Service
 * Watches directories currently expanded in the file explorer UI using
 * per-directory shallow (depth:0) chokidar watchers.
 *
 * Design: Only directories that are currently expanded in the UI have active watchers.
 * This reduces OS file handles from thousands (recursive) to typically 1-50 (expanded only).
 */

const { ipcMain } = require('electron');
/** @type {import('chokidar')} */
let chokidar = null;
async function getChokidar() {
  if (!chokidar) {
    const mod = await import('chokidar');
    chokidar = mod.default ?? mod;
  }
  return chokidar;
}
const path = require('path');

// ==================== MODULE STATE ====================

/** BrowserWindow reference set by registerExplorerHandlers */
let mainWindow = null;

/**
 * Per-directory shallow watcher map.
 * Keys: absolute dirPath string
 * Values: { watcher: FSWatcher, watchId: number }
 */
const dirWatchers = new Map();

/**
 * Monotonically increasing counter. Each watchDir call captures its own myWatchId
 * so stale debounce callbacks can be discarded.
 */
let watchId = 0;

/** Batched change events pending the next flush */
let pendingChanges = [];

/** setTimeout handle for the debounce flush */
let debounceTimer = null;

/** Debounce window in milliseconds — within the 300-500ms range per decision */
const DEBOUNCE_MS = 350;

/** Warn the renderer when this many directories are being watched simultaneously */
const WATCH_LIMIT_WARN = 50;

// ==================== IGNORE PATTERNS ====================

/**
 * Mirror of IGNORE_PATTERNS from FileExplorer.js.
 * Used by chokidar to skip high-noise directories.
 */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', 'vendor', '.cache', '.idea', '.vscode',
  '.DS_Store', 'Thumbs.db', '.env.local', 'coverage',
  '.nuxt', '.output', '.turbo', '.parcel-cache'
]);

/**
 * Returns a function for chokidar's `ignored` option.
 * Returns true if any path segment is in IGNORED_DIRS.
 * Splits on both '\\' and '/' for cross-platform compatibility.
 */
function makeIgnoredFn() {
  return (filePath) => {
    if (!filePath) return false;
    const segments = filePath.split(/[\\/]/);
    return segments.some(seg => IGNORED_DIRS.has(seg));
  };
}

// ==================== CHANGE BATCHING ====================

/**
 * Flushes pendingChanges to the renderer via IPC.
 * @param {number} myWatchId - watchId captured when this flush was scheduled (unused now — stale filtering is per-event)
 */
function flushChanges(myWatchId) {
  if (pendingChanges.length === 0) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('explorer:changes', pendingChanges.slice());
  }

  pendingChanges = [];
  debounceTimer = null;
}

/**
 * Pushes a single change event and (re)schedules the debounce flush.
 * Drops the event silently if the watcher for watchedDir is no longer active or has been replaced.
 * @param {'add'|'remove'} type - Change type
 * @param {string} filePath - Absolute path of the changed entry
 * @param {boolean} isDirectory - Whether the entry is a directory
 * @param {number} myWatchId - watchId captured when this watcher's closure was created
 * @param {string} watchedDir - The directory this watcher is watching
 */
function pushChange(type, filePath, isDirectory, myWatchId, watchedDir) {
  const entry = dirWatchers.get(watchedDir);
  if (!entry || entry.watchId !== myWatchId) return; // stale watcher — discard

  pendingChanges.push({ type, path: filePath, isDirectory });

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => flushChanges(myWatchId), DEBOUNCE_MS);
}

// ==================== WATCHER LIFECYCLE ====================

/**
 * Starts watching a single directory with a shallow (depth:0) chokidar watcher.
 * If a watcher for this directory is already active, returns immediately.
 * @param {string} dirPath - Absolute path to the directory to watch
 */
async function watchDir(dirPath) {
  if (dirWatchers.has(dirPath)) return; // already watching

  const chok = await getChokidar();
  watchId++;
  const myWatchId = watchId;

  const watcher = chok.watch(dirPath, {
    ignored: makeIgnoredFn(),
    persistent: true,             // activates chokidar's native error listener which swallows EPERM on Windows directory deletion
    ignoreInitial: true,          // only report changes, not the initial directory scan
    ignorePermissionErrors: true, // silently ignore EACCES/EPERM from subdirectories
    depth: 0,                     // shallow: only direct children of dirPath
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    }
  });

  watcher
    .on('add',       (p) => pushChange('add',    p, false, myWatchId, dirPath))
    .on('addDir',    (p) => pushChange('add',    p, true,  myWatchId, dirPath))
    .on('unlink',    (p) => pushChange('remove', p, false, myWatchId, dirPath))
    .on('unlinkDir', (p) => pushChange('remove', p, true,  myWatchId, dirPath))
    .on('error', () => {
      // Silently ignore errors (e.g. permission denied on subdirectories)
    });

  dirWatchers.set(dirPath, { watcher, watchId: myWatchId });

  if (dirWatchers.size >= WATCH_LIMIT_WARN && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('explorer:watchLimitWarning', dirWatchers.size);
  }
}

/**
 * Stops the watcher for a single directory and removes it from the map.
 * No-op if the directory is not currently being watched.
 * @param {string} dirPath - Absolute path to the directory to unwatch
 */
function unwatchDir(dirPath) {
  const entry = dirWatchers.get(dirPath);
  if (!entry) return;

  entry.watcher.close(); // fire-and-forget — safe, chokidar handles this internally
  dirWatchers.delete(dirPath);
}

/**
 * Stops all active per-directory watchers and clears pending state.
 */
function stopAllDirWatchers() {
  for (const entry of dirWatchers.values()) {
    entry.watcher.close();
  }
  dirWatchers.clear();

  pendingChanges = [];

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Public stop function — stops all watchers.
 * Kept for backwards compatibility (called by app shutdown in main.js).
 */
function stopWatch() {
  stopAllDirWatchers();
}

// ==================== IPC REGISTRATION ====================

/**
 * Registers IPC handlers for the file explorer watcher.
 * Must be called with a reference to the main BrowserWindow.
 * @param {BrowserWindow} mw - The main application window
 */
function registerExplorerHandlers(mw) {
  mainWindow = mw;

  // Start watching a single directory (shallow, depth:0)
  ipcMain.on('explorer:watchDir', (event, dirPath) => {
    if (!dirPath || typeof dirPath !== 'string') return;
    watchDir(dirPath);
  });

  // Stop watching a single directory
  ipcMain.on('explorer:unwatchDir', (event, dirPath) => {
    if (!dirPath || typeof dirPath !== 'string') return;
    unwatchDir(dirPath);
  });

  // Stop all watchers (project deselect / collapse-all / refresh)
  ipcMain.on('explorer:stopWatch', () => {
    stopWatch();
  });
}

module.exports = { registerExplorerHandlers, stopWatch };
