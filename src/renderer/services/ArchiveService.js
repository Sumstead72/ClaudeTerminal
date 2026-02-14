/**
 * Archive Service
 * Manages monthly time tracking session archives
 * Archives are stored in ~/.claude-terminal/timetracking/YYYY/month.json
 */

const { path, fs } = window.electron_nodeModules;
const { timeTrackingDir, archivesDir } = require('../utils/paths');

// Month names for filenames (lowercase English)
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

// LRU cache for loaded archives (max 3 in memory)
const MAX_CACHE_SIZE = 3;
const archiveCache = new Map(); // "YYYY-MM" -> { data, loadedAt }

/**
 * Get the cache key for a year/month
 */
function getCacheKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Get the full path to an archive file
 * New structure: timetracking/YYYY/month.json
 * @param {number} year
 * @param {number} month - 0-based JS month index
 * @returns {string}
 */
function getArchiveFilePath(year, month) {
  return path.join(timeTrackingDir, String(year), `${MONTH_NAMES[month]}.json`);
}

/**
 * Ensure the year directory exists under timetracking/
 * @param {number} year
 */
function ensureYearDir(year) {
  const yearDir = path.join(timeTrackingDir, String(year));
  if (!fs.existsSync(yearDir)) {
    fs.mkdirSync(yearDir, { recursive: true });
  }
}

/**
 * Check if a year/month is the current month
 */
function isCurrentMonth(year, month) {
  const now = new Date();
  return year === now.getFullYear() && month === now.getMonth();
}

/**
 * Create an empty archive structure
 */
function createEmptyArchive(year, month) {
  return {
    version: 1,
    month: getCacheKey(year, month),
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
    globalSessions: [],
    projectSessions: {}
  };
}

/**
 * Read an archive file from disk (bypasses cache)
 */
function readArchiveFromDisk(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content || !content.trim()) return null;
    return JSON.parse(content);
  } catch (error) {
    console.warn('[ArchiveService] Failed to read archive:', filePath, error.message);
    return null;
  }
}

/**
 * Load an archive with LRU caching
 */
function loadArchive(year, month) {
  const key = getCacheKey(year, month);

  if (archiveCache.has(key)) {
    return archiveCache.get(key).data;
  }

  const filePath = getArchiveFilePath(year, month);
  const data = readArchiveFromDisk(filePath);

  if (data) {
    if (archiveCache.size >= MAX_CACHE_SIZE) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of archiveCache) {
        if (v.loadedAt < oldestTime) {
          oldestTime = v.loadedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) archiveCache.delete(oldestKey);
    }

    archiveCache.set(key, { data, loadedAt: Date.now() });
  }

  return data;
}

/**
 * Write an archive file atomically
 */
function writeArchive(year, month, archiveData) {
  ensureYearDir(year);

  const filePath = getArchiveFilePath(year, month);
  const tempFile = `${filePath}.tmp`;

  try {
    fs.writeFileSync(tempFile, JSON.stringify(archiveData, null, 2));
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    console.error('[ArchiveService] Failed to write archive:', filePath, error.message);
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) {}
  }
}

/**
 * Append sessions to an archive, deduplicating by session ID
 */
function appendToArchive(year, month, globalSessions, projectSessionsMap) {
  const filePath = getArchiveFilePath(year, month);

  let archive = readArchiveFromDisk(filePath);
  if (!archive) {
    archive = createEmptyArchive(year, month);
  }

  if (globalSessions && globalSessions.length > 0) {
    const existingIds = new Set(archive.globalSessions.map(s => s.id));
    for (const session of globalSessions) {
      if (!existingIds.has(session.id)) {
        archive.globalSessions.push(session);
      }
    }
  }

  if (projectSessionsMap) {
    for (const [projectId, data] of Object.entries(projectSessionsMap)) {
      if (!archive.projectSessions[projectId]) {
        archive.projectSessions[projectId] = {
          projectName: data.projectName || 'Unknown',
          sessions: []
        };
      }
      const existingIds = new Set(archive.projectSessions[projectId].sessions.map(s => s.id));
      for (const session of data.sessions) {
        if (!existingIds.has(session.id)) {
          archive.projectSessions[projectId].sessions.push(session);
        }
      }
      if (data.projectName) {
        archive.projectSessions[projectId].projectName = data.projectName;
      }
    }
  }

  archive.lastModifiedAt = new Date().toISOString();

  writeArchive(year, month, archive);
  invalidateArchiveCache(year, month);
}

/**
 * Get archived global sessions for a specific month
 */
function getArchivedGlobalSessions(year, month) {
  const archive = loadArchive(year, month);
  return archive?.globalSessions || [];
}

/**
 * Get archived sessions for a specific project in a month
 */
function getArchivedProjectSessions(year, month, projectId) {
  const archive = loadArchive(year, month);
  return archive?.projectSessions?.[projectId]?.sessions || [];
}

/**
 * Get all archived project sessions for a month
 */
function getArchivedAllProjectSessions(year, month) {
  const archive = loadArchive(year, month);
  return archive?.projectSessions || {};
}

function invalidateArchiveCache(year, month) {
  archiveCache.delete(getCacheKey(year, month));
}

function clearArchiveCache() {
  archiveCache.clear();
}

/**
 * Get list of months in a date range
 */
function getMonthsInRange(periodStart, periodEnd) {
  const months = [];
  const start = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
  const end = new Date(periodEnd);

  while (start < end) {
    months.push({ year: start.getFullYear(), month: start.getMonth() });
    start.setMonth(start.getMonth() + 1);
  }
  return months;
}

/**
 * Migrate old archives from ~/.claude-terminal/archives/ to timetracking/YYYY/month.json
 * One-time migration on first launch after update
 */
function migrateOldArchives() {
  try {
    if (!fs.existsSync(archivesDir)) return;

    const files = fs.readdirSync(archivesDir);
    if (files.length === 0) {
      // Empty directory, just remove it
      try { fs.rmdirSync(archivesDir); } catch (_) {}
      return;
    }

    let migratedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      // Parse old filename: "january_2026.json"
      const match = file.match(/^([a-z]+)_(\d{4})\.json$/);
      if (!match) continue;

      const monthName = match[1];
      const year = parseInt(match[2], 10);
      const monthIndex = MONTH_NAMES.indexOf(monthName);
      if (monthIndex === -1) continue;

      const oldPath = path.join(archivesDir, file);
      const newPath = getArchiveFilePath(year, monthIndex);

      // Skip if already migrated
      if (fs.existsSync(newPath)) {
        // Remove old file since new one exists
        try { fs.unlinkSync(oldPath); } catch (_) {}
        continue;
      }

      // Read old, write to new location
      const data = readArchiveFromDisk(oldPath);
      if (data) {
        ensureYearDir(year);
        try {
          fs.writeFileSync(newPath, JSON.stringify(data, null, 2));
          fs.unlinkSync(oldPath);
          migratedCount++;
        } catch (err) {
          console.warn('[ArchiveService] Failed to migrate:', file, err.message);
        }
      }
    }

    // Remove old archives dir if empty
    try {
      const remaining = fs.readdirSync(archivesDir);
      if (remaining.length === 0) {
        fs.rmdirSync(archivesDir);
      }
    } catch (_) {}

    if (migratedCount > 0) {
      console.debug(`[ArchiveService] Migrated ${migratedCount} archive(s) to new structure`);
    }
  } catch (error) {
    console.warn('[ArchiveService] Migration error:', error.message);
  }
}

module.exports = {
  getArchiveFilePath,
  isCurrentMonth,
  loadArchive,
  writeArchive,
  appendToArchive,
  getArchivedGlobalSessions,
  getArchivedProjectSessions,
  getArchivedAllProjectSessions,
  invalidateArchiveCache,
  clearArchiveCache,
  getMonthsInRange,
  migrateOldArchives
};
