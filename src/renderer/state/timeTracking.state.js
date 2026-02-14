/**
 * Time Tracking State Module
 * Tracks time spent on each project based on terminal activity
 * Supports multiple projects being tracked simultaneously
 *
 * Persisted data lives in timetracking.json (separate from projects.json)
 */

const { fs } = window.electron_nodeModules;
const { State } = require('./State');
const { timeTrackingFile, projectsFile } = require('../utils/paths');
const ArchiveService = require('../services/ArchiveService');

// Constants
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const OUTPUT_IDLE_TIMEOUT = 2 * 60 * 1000; // 2 minutes - idle after last terminal output
const SLEEP_GAP_THRESHOLD = 2 * 60 * 1000; // 2 minutes - gap indicating system sleep/wake
const CHECKPOINT_INTERVAL = 5 * 60 * 1000; // 5 minutes - periodic session save
const SESSION_MERGE_GAP = 30 * 60 * 1000; // 30 minutes - merge sessions closer than this
const TT_SAVE_DEBOUNCE_MS = 500;
let lastHeartbeat = Date.now();
let heartbeatTimer = null;
let checkpointTimer = null;

// Runtime state (not persisted)
const trackingState = new State({
  activeSessions: new Map(),
  globalSessionStartTime: null,
  globalLastActivityTime: null,
  globalIsIdle: false
});

// Persisted time tracking data (separate file: timetracking.json)
const timeTrackingDataState = new State({
  projects: {},  // projectId -> { totalTime, todayTime, lastActiveDate, sessions[] }
  global: null   // { totalTime, todayTime, weekTime, monthTime, weekStart, monthStart, lastActiveDate, sessions[] }
});

// Internal state
const idleTimers = new Map();
const lastOutputTimes = new Map();
let globalLastOutputTime = 0;
let globalIdleTimer = null;
let midnightCheckTimer = null;
let lastKnownDate = null;
let projectsStateRef = null; // Still needed for project metadata (name, color)
let globalTimesCache = null;
let ttSaveDebounceTimer = null;
let ttSaveInProgress = false;
let ttPendingSave = false;

// ============================================================
// TIME TRACKING PERSISTENCE (timetracking.json)
// ============================================================

/**
 * Load time tracking data from timetracking.json
 */
function loadTimeTrackingData() {
  try {
    if (!fs.existsSync(timeTrackingFile)) return;

    const content = fs.readFileSync(timeTrackingFile, 'utf8');
    if (!content || !content.trim()) return;

    const data = JSON.parse(content);
    timeTrackingDataState.set({
      projects: data.projects || {},
      global: data.global || null
    });
    console.debug('[TimeTracking] Loaded timetracking.json');
  } catch (error) {
    console.warn('[TimeTracking] Failed to load timetracking.json:', error.message);
  }
}

/**
 * Save time tracking data (debounced)
 */
function saveTimeTracking() {
  if (ttSaveDebounceTimer) {
    clearTimeout(ttSaveDebounceTimer);
  }

  ttSaveDebounceTimer = setTimeout(() => {
    if (ttSaveInProgress) {
      ttPendingSave = true;
      return;
    }
    saveTimeTrackingImmediate();
  }, TT_SAVE_DEBOUNCE_MS);
}

/**
 * Save time tracking data immediately (atomic write)
 */
function saveTimeTrackingImmediate() {
  if (ttSaveInProgress) {
    ttPendingSave = true;
    return;
  }

  ttSaveInProgress = true;

  const state = timeTrackingDataState.get();
  const data = {
    version: 2,
    month: getMonthString(),
    global: state.global,
    projects: state.projects
  };

  const tempFile = `${timeTrackingFile}.tmp`;
  const backupFile = `${timeTrackingFile}.bak`;

  try {
    if (fs.existsSync(timeTrackingFile)) {
      try { fs.copyFileSync(timeTrackingFile, backupFile); } catch (_) {}
    }

    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, timeTrackingFile);

    try { if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile); } catch (_) {}
  } catch (error) {
    console.error('[TimeTracking] Failed to save timetracking.json:', error.message);
    if (fs.existsSync(backupFile)) {
      try { fs.copyFileSync(backupFile, timeTrackingFile); } catch (_) {}
    }
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
  } finally {
    ttSaveInProgress = false;
    if (ttPendingSave) {
      ttPendingSave = false;
      setTimeout(saveTimeTrackingImmediate, 50);
    }
  }
}

// ============================================================
// MIGRATION
// ============================================================

/**
 * Migrate inline timeTracking from projects.json to timetracking.json
 * One-time migration for existing users
 */
function migrateInlineTimeTracking() {
  // Read projects.json RAW from disk (not from state, which no longer includes timeTracking fields)
  let rawData;
  try {
    if (!fs.existsSync(projectsFile)) return;
    const content = fs.readFileSync(projectsFile, 'utf8');
    if (!content || !content.trim()) return;
    rawData = JSON.parse(content);
  } catch (e) {
    console.warn('[TimeTracking] Cannot read projects.json for migration:', e.message);
    return;
  }

  const projects = rawData.projects || (Array.isArray(rawData) ? rawData : []);
  let hasInlineData = false;
  const ttState = timeTrackingDataState.get();
  const migratedProjects = { ...ttState.projects };
  let migratedGlobal = ttState.global;

  // Extract per-project timeTracking
  for (const project of projects) {
    if (project.timeTracking) {
      hasInlineData = true;
      const existing = migratedProjects[project.id];
      if (!existing) {
        migratedProjects[project.id] = { ...project.timeTracking };
      } else {
        // Merge: keep higher counters, deduplicate sessions
        migratedProjects[project.id] = {
          totalTime: Math.max(existing.totalTime || 0, project.timeTracking.totalTime || 0),
          todayTime: Math.max(existing.todayTime || 0, project.timeTracking.todayTime || 0),
          lastActiveDate: existing.lastActiveDate || project.timeTracking.lastActiveDate,
          sessions: deduplicateSessions(existing.sessions || [], project.timeTracking.sessions || [])
        };
      }
    }
  }

  // Extract globalTimeTracking
  if (rawData.globalTimeTracking) {
    hasInlineData = true;
    if (!migratedGlobal) {
      migratedGlobal = { ...rawData.globalTimeTracking };
    } else {
      migratedGlobal = {
        ...migratedGlobal,
        totalTime: Math.max(migratedGlobal.totalTime || 0, rawData.globalTimeTracking.totalTime || 0),
        todayTime: Math.max(migratedGlobal.todayTime || 0, rawData.globalTimeTracking.todayTime || 0),
        weekTime: Math.max(migratedGlobal.weekTime || 0, rawData.globalTimeTracking.weekTime || 0),
        monthTime: Math.max(migratedGlobal.monthTime || 0, rawData.globalTimeTracking.monthTime || 0),
        lastActiveDate: migratedGlobal.lastActiveDate || rawData.globalTimeTracking.lastActiveDate,
        weekStart: migratedGlobal.weekStart || rawData.globalTimeTracking.weekStart,
        monthStart: migratedGlobal.monthStart || rawData.globalTimeTracking.monthStart,
        sessions: deduplicateSessions(migratedGlobal.sessions || [], rawData.globalTimeTracking.sessions || [])
      };
    }
  }

  if (!hasInlineData) return;

  // 0. Backup projects.json before any migration changes
  const backupFile = `${projectsFile}.pre-migration.bak`;
  try {
    fs.copyFileSync(projectsFile, backupFile);
    console.debug('[TimeTracking] Backup created:', backupFile);
  } catch (e) {
    console.warn('[TimeTracking] Failed to backup projects.json, aborting migration:', e.message);
    return;
  }

  // 1. Save to timetracking.json FIRST (safety)
  timeTrackingDataState.set({ projects: migratedProjects, global: migratedGlobal });
  saveTimeTrackingImmediate();

  // 2. Strip timeTracking from projects.json (both state and disk)
  const cleanedProjects = projects.map(p => {
    if (!p.timeTracking) return p;
    const { timeTracking, ...rest } = p;
    return rest;
  });

  // Update state
  if (projectsStateRef) {
    const currentState = projectsStateRef.get();
    const stateProjects = currentState.projects.map(p => {
      if (!p.timeTracking) return p;
      const { timeTracking, ...rest } = p;
      return rest;
    });
    projectsStateRef.set({ ...currentState, projects: stateProjects });
  }

  // Write cleaned projects.json directly
  const cleanedData = { ...rawData, projects: cleanedProjects };
  delete cleanedData.globalTimeTracking;
  const tempFile = `${projectsFile}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(cleanedData, null, 2));
    fs.renameSync(tempFile, projectsFile);
  } catch (e) {
    console.warn('[TimeTracking] Failed to clean projects.json:', e.message);
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
  }

  console.debug('[TimeTracking] Migrated inline data to timetracking.json');
}

/**
 * Deduplicate sessions by ID
 */
function deduplicateSessions(existing, incoming) {
  const ids = new Set(existing.map(s => s.id));
  const merged = [...existing];
  for (const s of incoming) {
    if (!ids.has(s.id)) {
      merged.push(s);
      ids.add(s.id);
    }
  }
  return merged;
}

/**
 * Remove orphaned time tracking entries for deleted projects
 */
function cleanupOrphanedTimeTracking() {
  if (!projectsStateRef) return;

  const projectIds = new Set(projectsStateRef.get().projects.map(p => p.id));
  const ttState = timeTrackingDataState.get();
  const cleaned = {};
  let hasOrphans = false;

  for (const [id, data] of Object.entries(ttState.projects)) {
    if (projectIds.has(id)) {
      cleaned[id] = data;
    } else {
      hasOrphans = true;
    }
  }

  if (hasOrphans) {
    timeTrackingDataState.set({ ...ttState, projects: cleaned });
    saveTimeTracking();
    console.debug('[TimeTracking] Cleaned up orphaned time tracking entries');
  }
}

// ============================================================
// SANITIZATION
// ============================================================

/**
 * Sanitize and validate all time tracking data on load
 */
function sanitizeTimeTrackingData() {
  const ttState = timeTrackingDataState.get();
  let needsSave = false;
  const now = Date.now();
  const maxReasonableDuration = 24 * 60 * 60 * 1000;

  // Sanitize per-project time tracking
  const projects = { ...ttState.projects };
  for (const [projectId, tracking] of Object.entries(projects)) {
    const sanitized = { ...tracking };
    let changed = false;

    if (!Number.isFinite(sanitized.totalTime) || sanitized.totalTime < 0) {
      console.warn(`[TimeTracking] Sanitize: project ${projectId} totalTime was ${sanitized.totalTime}, reset to 0`);
      sanitized.totalTime = 0;
      changed = true;
    }

    if (!Number.isFinite(sanitized.todayTime) || sanitized.todayTime < 0) {
      sanitized.todayTime = 0;
      changed = true;
    }

    if (sanitized.lastActiveDate) {
      const lastDate = new Date(sanitized.lastActiveDate + 'T00:00:00');
      if (lastDate.getTime() > now + 86400000) {
        sanitized.lastActiveDate = null;
        sanitized.todayTime = 0;
        changed = true;
      }
    }

    if (Array.isArray(sanitized.sessions)) {
      const validSessions = sanitized.sessions.filter(s => {
        if (!s || !s.startTime || !s.endTime) return false;
        if (!Number.isFinite(s.duration) || s.duration <= 0) return false;
        if (s.duration > maxReasonableDuration) return false;
        const start = new Date(s.startTime).getTime();
        const end = new Date(s.endTime).getTime();
        if (isNaN(start) || isNaN(end)) return false;
        if (end < start) return false;
        return true;
      });

      if (validSessions.length !== sanitized.sessions.length) {
        console.warn(`[TimeTracking] Sanitize: project ${projectId} removed ${sanitized.sessions.length - validSessions.length} invalid sessions`);
        sanitized.sessions = validSessions;
        changed = true;
      }
    } else {
      sanitized.sessions = [];
      changed = true;
    }

    if (changed) {
      projects[projectId] = sanitized;
      needsSave = true;
    }
  }

  // Sanitize global time tracking
  let global = ttState.global;
  if (global) {
    global = { ...global };
    let gChanged = false;

    for (const key of ['totalTime', 'todayTime', 'weekTime', 'monthTime']) {
      if (!Number.isFinite(global[key]) || global[key] < 0) {
        global[key] = 0;
        gChanged = true;
      }
    }

    if (Array.isArray(global.sessions)) {
      const validSessions = global.sessions.filter(s => {
        if (!s || !s.startTime || !s.endTime) return false;
        if (!Number.isFinite(s.duration) || s.duration <= 0) return false;
        if (s.duration > maxReasonableDuration) return false;
        const start = new Date(s.startTime).getTime();
        const end = new Date(s.endTime).getTime();
        if (isNaN(start) || isNaN(end)) return false;
        if (end < start) return false;
        return true;
      });

      if (validSessions.length !== global.sessions.length) {
        console.warn(`[TimeTracking] Sanitize: global removed ${global.sessions.length - validSessions.length} invalid sessions`);
        global.sessions = validSessions;
        gChanged = true;
      }
    } else {
      global.sessions = [];
      gChanged = true;
    }

    if (gChanged) needsSave = true;
  }

  if (needsSave) {
    globalTimesCache = null;
    timeTrackingDataState.set({ projects, global });
    saveTimeTracking();
    console.debug('[TimeTracking] Data sanitized and saved');
  }
}

// ============================================================
// ARCHIVING
// ============================================================

/**
 * Archive past-month sessions to monthly archive files
 */
function archivePastMonthSessions() {
  const ttState = timeTrackingDataState.get();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let hasChanges = false;

  // --- Archive global sessions ---
  let updatedGlobal = ttState.global;
  if (updatedGlobal?.sessions?.length > 0) {
    const currentMonthGlobal = [];
    const pastByMonth = {};

    for (const session of updatedGlobal.sessions) {
      const d = new Date(session.startTime);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        currentMonthGlobal.push(session);
      } else {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!pastByMonth[key]) pastByMonth[key] = [];
        pastByMonth[key].push(session);
      }
    }

    if (Object.keys(pastByMonth).length > 0) {
      hasChanges = true;
      updatedGlobal = { ...updatedGlobal, sessions: currentMonthGlobal };
    }

    for (const [key, sessions] of Object.entries(pastByMonth)) {
      const [year, month] = key.split('-').map(Number);
      ArchiveService.appendToArchive(year, month, sessions, {});
    }
  }

  // --- Archive per-project sessions ---
  const pastProjectsByMonth = {};
  const updatedProjects = { ...ttState.projects };
  const projectsData = projectsStateRef ? projectsStateRef.get().projects : [];

  for (const [projectId, tracking] of Object.entries(updatedProjects)) {
    if (!tracking?.sessions?.length) continue;

    const currentMonthSessions = [];
    for (const session of tracking.sessions) {
      const d = new Date(session.startTime);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        currentMonthSessions.push(session);
      } else {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!pastProjectsByMonth[key]) pastProjectsByMonth[key] = {};
        const project = projectsData.find(p => p.id === projectId);
        if (!pastProjectsByMonth[key][projectId]) {
          pastProjectsByMonth[key][projectId] = { projectName: project?.name || 'Unknown', sessions: [] };
        }
        pastProjectsByMonth[key][projectId].sessions.push(session);
      }
    }

    if (currentMonthSessions.length !== tracking.sessions.length) {
      hasChanges = true;
      updatedProjects[projectId] = { ...tracking, sessions: currentMonthSessions };
    }
  }

  for (const [key, projectsMap] of Object.entries(pastProjectsByMonth)) {
    const [year, month] = key.split('-').map(Number);
    ArchiveService.appendToArchive(year, month, [], projectsMap);
  }

  if (hasChanges) {
    globalTimesCache = null;
    timeTrackingDataState.set({ projects: updatedProjects, global: updatedGlobal });
    saveTimeTracking();
    console.debug('[TimeTracking] Archived past-month sessions');
  }
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Initialize with references to projects state functions
 */
function initTimeTracking(projectsState) {
  projectsStateRef = projectsState;
  console.debug('[TimeTracking] Initialized');

  // 1. Migrate old archives/ to timetracking/YYYY/
  ArchiveService.migrateOldArchives();

  // 2. Load timetracking.json
  loadTimeTrackingData();

  // 3. Migrate inline timeTracking from projects.json (reads disk directly)
  migrateInlineTimeTracking();

  // 4. Sanitize data
  sanitizeTimeTrackingData();

  // 5. Migrate global counters (weekTime/monthTime)
  migrateGlobalTimeTracking();

  // 6. Archive past-month sessions
  archivePastMonthSessions();

  // 7. Restore global sessions from backup if missing
  rebuildGlobalSessionsIfNeeded();

  // 8. Compact fragmented sessions (merge consecutive, preserves total time)
  compactExistingSessions();

  // 9. Cleanup orphaned entries
  cleanupOrphanedTimeTracking();

  // 10. Start timers
  lastKnownDate = getTodayString();
  startMidnightCheck();
  startHeartbeat();
  startCheckpointTimer();
}

/**
 * Migrate global time tracking to use weekTime/monthTime counters
 */
function migrateGlobalTimeTracking() {
  const ttState = timeTrackingDataState.get();
  const globalTracking = ttState.global;

  if (!globalTracking) return;

  const weekStart = getWeekStartString();
  const monthStart = getMonthString();
  let needsSave = false;

  const needsWeekMigration = globalTracking.weekTime === undefined || globalTracking.weekStart !== weekStart;
  const needsMonthMigration = globalTracking.monthTime === undefined || globalTracking.monthStart !== monthStart;

  if (needsWeekMigration || needsMonthMigration) {
    const updated = { ...globalTracking };
    const sessions = globalTracking.sessions || [];

    if (needsWeekMigration) {
      const weekStartDate = new Date(weekStart + 'T00:00:00');
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 7);

      let weekFromSessions = 0;
      for (const session of sessions) {
        const sessionDate = new Date(session.startTime);
        if (sessionDate >= weekStartDate && sessionDate < weekEndDate) {
          weekFromSessions += session.duration || 0;
        }
      }

      // If week changed, reset to session-based calculation
      // If same week but weekTime was undefined, keep the higher value (sessions may be truncated)
      if (globalTracking.weekStart !== weekStart) {
        updated.weekTime = weekFromSessions;
      } else {
        updated.weekTime = Math.max(weekFromSessions, globalTracking.weekTime || 0);
      }
      updated.weekStart = weekStart;
      needsSave = true;
    }

    if (needsMonthMigration) {
      const [year, month] = monthStart.split('-').map(Number);

      let monthFromSessions = 0;
      for (const session of sessions) {
        const sessionDate = new Date(session.startTime);
        if (sessionDate.getFullYear() === year && sessionDate.getMonth() + 1 === month) {
          monthFromSessions += session.duration || 0;
        }
      }

      // If month changed, reset to session-based calculation
      // If same month but monthTime was undefined, keep the higher value
      if (globalTracking.monthStart !== monthStart) {
        updated.monthTime = monthFromSessions;
      } else {
        updated.monthTime = Math.max(monthFromSessions, globalTracking.monthTime || 0);
      }
      updated.monthStart = monthStart;
      needsSave = true;
    }

    if (needsSave) {
      globalTimesCache = null;
      timeTrackingDataState.set({ ...ttState, global: updated });
      saveTimeTracking();
    }
  }
}

// ============================================================
// TIMERS (midnight, heartbeat, checkpoint)
// ============================================================

function startMidnightCheck() {
  clearInterval(midnightCheckTimer);
  midnightCheckTimer = setInterval(checkMidnightReset, 30 * 1000);
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  lastHeartbeat = Date.now();
  heartbeatTimer = setInterval(checkSleepWake, 30 * 1000);
}

function startCheckpointTimer() {
  clearInterval(checkpointTimer);
  checkpointTimer = setInterval(saveCheckpoints, CHECKPOINT_INTERVAL);
}

function saveCheckpoints() {
  const state = trackingState.get();
  const now = Date.now();
  const activeSessions = new Map(state.activeSessions);
  let projectsChanged = false;

  for (const [projectId, session] of activeSessions) {
    if (session.sessionStartTime && !session.isIdle) {
      const duration = now - session.sessionStartTime;
      if (duration > 1000) {
        saveSession(projectId, session.sessionStartTime, now, duration);
        activeSessions.set(projectId, { ...session, sessionStartTime: now });
        projectsChanged = true;
      }
    }
  }

  let globalChanged = false;
  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const duration = now - state.globalSessionStartTime;
    if (duration > 1000) {
      saveGlobalSession(state.globalSessionStartTime, now, duration);
      globalChanged = true;
    }
  }

  if (projectsChanged || globalChanged) {
    const newState = { ...trackingState.get() };
    if (projectsChanged) newState.activeSessions = activeSessions;
    if (globalChanged) newState.globalSessionStartTime = now;
    trackingState.set(newState);
    console.debug('[TimeTracking] Checkpoint saved');
  }
}

function checkSleepWake() {
  const now = Date.now();
  const elapsed = now - lastHeartbeat;
  lastHeartbeat = now;

  if (elapsed > SLEEP_GAP_THRESHOLD) {
    console.debug(`[TimeTracking] Sleep/wake detected: gap of ${Math.round(elapsed / 1000)}s`);
    handleSleepWake(now - elapsed, now);
  }
}

function handleSleepWake(sleepStart, wakeTime) {
  const state = trackingState.get();

  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const duration = sleepStart - state.globalSessionStartTime;
    if (duration > 1000) {
      saveGlobalSession(state.globalSessionStartTime, sleepStart, duration);
    }
    trackingState.set({
      ...trackingState.get(),
      globalSessionStartTime: wakeTime,
      globalLastActivityTime: wakeTime
    });
  }

  const activeSessions = new Map(trackingState.get().activeSessions);
  for (const [projectId, session] of activeSessions) {
    if (session.sessionStartTime && !session.isIdle) {
      const duration = sleepStart - session.sessionStartTime;
      if (duration > 1000) {
        saveSession(projectId, session.sessionStartTime, sleepStart, duration);
      }
      activeSessions.set(projectId, {
        ...session,
        sessionStartTime: wakeTime,
        lastActivityTime: wakeTime
      });
    }
  }

  trackingState.set({ ...trackingState.get(), activeSessions });
}

function checkMidnightReset() {
  const today = getTodayString();

  if (lastKnownDate && lastKnownDate !== today) {
    console.debug('[TimeTracking] Midnight detected! Date changed from', lastKnownDate, 'to', today);

    const oldDate = new Date(lastKnownDate + 'T00:00:00');
    const newDate = new Date(today + 'T00:00:00');
    const monthChanged = oldDate.getMonth() !== newDate.getMonth()
      || oldDate.getFullYear() !== newDate.getFullYear();

    lastKnownDate = today;
    globalTimesCache = null;
    splitSessionsAtMidnight();

    if (monthChanged) {
      console.debug('[TimeTracking] Month boundary crossed, archiving past sessions');
      archivePastMonthSessions();
    }
  }
}

function splitSessionsAtMidnight() {
  const state = trackingState.get();
  const now = Date.now();
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const midnightTs = todayMidnight.getTime();

  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const duration = midnightTs - state.globalSessionStartTime;
    if (duration > 1000) {
      saveGlobalSession(state.globalSessionStartTime, midnightTs, duration);
    }
    trackingState.set({
      ...trackingState.get(),
      globalSessionStartTime: midnightTs,
      globalLastActivityTime: now
    });
  }

  const activeSessions = new Map(trackingState.get().activeSessions);
  for (const [projectId, session] of activeSessions) {
    if (session.sessionStartTime && !session.isIdle) {
      const duration = midnightTs - session.sessionStartTime;
      if (duration > 1000) {
        saveSession(projectId, session.sessionStartTime, midnightTs, duration);
      }
      activeSessions.set(projectId, {
        ...session,
        sessionStartTime: midnightTs,
        lastActivityTime: now
      });
    }
  }

  trackingState.set({ ...trackingState.get(), activeSessions });
}

// ============================================================
// HELPERS
// ============================================================

function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getWeekStartString() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

function getMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Ensure time tracking data exists for a project
 */
function ensureTimeTracking(project) {
  if (!project) return { totalTime: 0, todayTime: 0, lastActiveDate: null, sessions: [] };

  const ttState = timeTrackingDataState.get();
  if (!ttState.projects[project.id]) {
    const tracking = { totalTime: 0, todayTime: 0, lastActiveDate: null, sessions: [] };
    timeTrackingDataState.set({
      ...ttState,
      projects: { ...ttState.projects, [project.id]: tracking }
    });
    return tracking;
  }
  return ttState.projects[project.id];
}

function getProjectById(projectId) {
  if (!projectsStateRef) return undefined;
  return projectsStateRef.get().projects.find(p => p.id === projectId);
}

function generateSessionId() {
  return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getActiveNonIdleCount() {
  const state = trackingState.get();
  let count = 0;
  for (const session of state.activeSessions.values()) {
    if (session.sessionStartTime && !session.isIdle) count++;
  }
  return count;
}

// ============================================================
// GLOBAL TIMER
// ============================================================

function startGlobalTimer() {
  const state = trackingState.get();
  if (state.globalSessionStartTime && !state.globalIsIdle) return;

  const now = Date.now();
  trackingState.set({
    ...state,
    globalSessionStartTime: now,
    globalLastActivityTime: now,
    globalIsIdle: false
  });

  clearTimeout(globalIdleTimer);
  globalIdleTimer = setTimeout(checkAndPauseGlobalTimer, IDLE_TIMEOUT);
  console.debug('[TimeTracking] Global timer started');
}

function pauseGlobalTimer() {
  const state = trackingState.get();
  if (!state.globalSessionStartTime || state.globalIsIdle) return;

  const now = Date.now();
  const duration = now - state.globalSessionStartTime;
  if (duration > 1000) {
    saveGlobalSession(state.globalSessionStartTime, now, duration);
  }

  trackingState.set({ ...state, globalSessionStartTime: null, globalIsIdle: true });
  console.debug('[TimeTracking] Global timer paused (idle)');
}

function resumeGlobalTimer() {
  const state = trackingState.get();
  if (!state.globalIsIdle) return;

  const now = Date.now();
  trackingState.set({
    ...state,
    globalSessionStartTime: now,
    globalLastActivityTime: now,
    globalIsIdle: false
  });

  clearTimeout(globalIdleTimer);
  globalIdleTimer = setTimeout(checkAndPauseGlobalTimer, IDLE_TIMEOUT);
  console.debug('[TimeTracking] Global timer resumed');
}

function stopGlobalTimer() {
  const state = trackingState.get();
  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const now = Date.now();
    const duration = now - state.globalSessionStartTime;
    if (duration > 1000) {
      saveGlobalSession(state.globalSessionStartTime, now, duration);
    }
  }

  clearTimeout(globalIdleTimer);
  trackingState.set({
    ...state,
    globalSessionStartTime: null,
    globalLastActivityTime: null,
    globalIsIdle: false
  });
  console.debug('[TimeTracking] Global timer stopped');
}

function resetGlobalIdleTimer() {
  const state = trackingState.get();
  if (state.globalIsIdle) {
    resumeGlobalTimer();
    return;
  }

  if (state.globalSessionStartTime) {
    clearTimeout(globalIdleTimer);
    globalIdleTimer = setTimeout(checkAndPauseGlobalTimer, IDLE_TIMEOUT);
    trackingState.set({ ...state, globalLastActivityTime: Date.now() });
  }
}

// ============================================================
// SESSION MERGING
// ============================================================

/**
 * Merge a new session segment into the last session if close enough, otherwise append.
 * This prevents checkpoint intervals from creating hundreds of micro-sessions.
 */
function mergeOrAppendSession(sessions, startTime, endTime, duration) {
  const startIso = new Date(startTime).toISOString();
  const endIso = new Date(endTime).toISOString();

  if (sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    const lastEnd = new Date(last.endTime).getTime();
    const gap = new Date(startTime).getTime() - lastEnd;

    if (gap < SESSION_MERGE_GAP && gap >= 0) {
      // Extend the last session
      const merged = [...sessions];
      merged[merged.length - 1] = {
        ...last,
        endTime: endIso,
        duration: (last.duration || 0) + duration
      };
      return merged;
    }
  }

  // Too far apart or first session - create new
  return [...sessions, {
    id: generateSessionId(),
    startTime: startIso,
    endTime: endIso,
    duration
  }];
}

/**
 * Compact existing sessions by merging consecutive ones with small gaps.
 * This reduces file size without losing any time data (durations are summed).
 */
function compactExistingSessions() {
  const ttState = timeTrackingDataState.get();
  let totalBefore = 0;
  let totalAfter = 0;

  const compactedProjects = {};
  for (const [projectId, tracking] of Object.entries(ttState.projects)) {
    const sessions = tracking.sessions || [];
    totalBefore += sessions.length;
    const compacted = compactSessionArray(sessions);
    totalAfter += compacted.length;
    compactedProjects[projectId] = { ...tracking, sessions: compacted };
  }

  let compactedGlobal = ttState.global;
  if (compactedGlobal?.sessions?.length) {
    totalBefore += compactedGlobal.sessions.length;
    const compacted = compactSessionArray(compactedGlobal.sessions);
    totalAfter += compacted.length;
    compactedGlobal = { ...compactedGlobal, sessions: compacted };
  }

  if (totalAfter < totalBefore) {
    globalTimesCache = null;
    timeTrackingDataState.set({ projects: compactedProjects, global: compactedGlobal });
    saveTimeTracking();
    console.debug(`[TimeTracking] Compacted sessions: ${totalBefore} -> ${totalAfter}`);
  }
}

/**
 * Merge an array of sessions, combining consecutive ones with gap < SESSION_MERGE_GAP.
 * Total duration is preserved (durations are summed, not recalculated).
 */
function compactSessionArray(sessions) {
  if (!sessions.length) return [];

  const sorted = [...sessions].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const result = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];
    const lastEnd = new Date(last.endTime).getTime();
    const currentStart = new Date(current.startTime).getTime();
    const gap = currentStart - lastEnd;

    if (gap < SESSION_MERGE_GAP && gap >= -1000) {
      last.endTime = current.endTime;
      last.duration = (last.duration || 0) + (current.duration || 0);
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

/**
 * Restore global sessions from pre-migration backup if current data looks wrong.
 * The backup file (projects.json.pre-migration.bak) contains the original globalTimeTracking
 * with correct wall-clock times (no double-counting from overlapping project sessions).
 */
function rebuildGlobalSessionsIfNeeded() {
  const ttState = timeTrackingDataState.get();
  const globalSessions = ttState.global?.sessions || [];

  // If we already have global sessions, don't overwrite them
  if (globalSessions.length > 0) return;

  // Try to restore from pre-migration backup
  const backupFile = `${projectsFile}.pre-migration.bak`;
  try {
    if (!fs.existsSync(backupFile)) {
      console.debug('[TimeTracking] No pre-migration backup found, skipping global restore');
      return;
    }

    const content = fs.readFileSync(backupFile, 'utf8');
    if (!content || !content.trim()) return;

    const backupData = JSON.parse(content);
    const backupGlobal = backupData.globalTimeTracking;

    if (!backupGlobal || !backupGlobal.sessions || backupGlobal.sessions.length === 0) {
      console.debug('[TimeTracking] Backup has no global sessions');
      return;
    }

    // Filter to current month only (past months should already be archived)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const currentMonthSessions = backupGlobal.sessions.filter(s => {
      const d = new Date(s.startTime);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });

    // Archive past-month sessions from backup
    const pastByMonth = {};
    for (const session of backupGlobal.sessions) {
      const d = new Date(session.startTime);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!pastByMonth[key]) pastByMonth[key] = [];
      pastByMonth[key].push(session);
    }

    for (const [key, sessions] of Object.entries(pastByMonth)) {
      const [year, month] = key.split('-').map(Number);
      ArchiveService.appendToArchive(year, month, sessions, {});
    }

    // Keep all sessions as-is (no compaction on migrated data to avoid data loss)
    const updatedGlobal = {
      ...(ttState.global || {}),
      ...backupGlobal,
      sessions: currentMonthSessions
    };

    // Keep the backup's counters only if they match the current period
    // Otherwise reset them (the period has changed since backup)
    const currentWeekStart = getWeekStartString();
    const currentMonthStart = getMonthString();

    updatedGlobal.lastActiveDate = backupGlobal.lastActiveDate;
    updatedGlobal.weekStart = currentWeekStart;
    updatedGlobal.weekTime = (backupGlobal.weekStart === currentWeekStart) ? (backupGlobal.weekTime || 0) : 0;
    updatedGlobal.monthStart = currentMonthStart;
    updatedGlobal.monthTime = (backupGlobal.monthStart === currentMonthStart) ? (backupGlobal.monthTime || 0) : 0;
    updatedGlobal.todayTime = (backupGlobal.lastActiveDate === getTodayString()) ? (backupGlobal.todayTime || 0) : 0;

    globalTimesCache = null;
    timeTrackingDataState.set({ ...ttState, global: updatedGlobal });
    saveTimeTracking();

    console.debug(`[TimeTracking] Restored global sessions from backup: ${currentMonthSessions.length} sessions (current month), archived ${Object.keys(pastByMonth).length} past months`);
  } catch (e) {
    console.warn('[TimeTracking] Failed to restore global from backup:', e.message);
  }
}

// rebuildArchivedGlobalSessions removed - cannot accurately reconstruct global sessions
// from project sessions because overlapping sessions would double-count time.
// Past month global sessions are now restored from the pre-migration backup in rebuildGlobalSessionsIfNeeded().

// ============================================================
// SESSION SAVE (to timeTrackingDataState)
// ============================================================

/**
 * Save a global session
 */
function saveGlobalSession(startTime, endTime, duration) {
  console.debug('[TimeTracking] saveGlobalSession:', { duration: Math.round(duration / 1000) + 's' });

  const today = getTodayString();
  const weekStart = getWeekStartString();
  const monthStart = getMonthString();

  const ttState = timeTrackingDataState.get();
  const prev = ttState.global || {
    totalTime: 0, todayTime: 0, weekTime: 0, monthTime: 0,
    lastActiveDate: null, weekStart: null, monthStart: null, sessions: []
  };

  const todayTime = (prev.lastActiveDate !== today ? 0 : (prev.todayTime || 0)) + duration;
  const weekTime = (prev.weekStart !== weekStart ? 0 : (prev.weekTime || 0)) + duration;
  const monthTime = (prev.monthStart !== monthStart ? 0 : (prev.monthTime || 0)) + duration;

  const sessionDate = new Date(startTime);
  const now = new Date();
  const isCurrentMonthSession = sessionDate.getFullYear() === now.getFullYear()
    && sessionDate.getMonth() === now.getMonth();

  let sessions;
  if (isCurrentMonthSession) {
    sessions = mergeOrAppendSession(prev.sessions || [], startTime, endTime, duration);
  } else {
    const newSession = {
      id: generateSessionId(),
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      duration
    };
    ArchiveService.appendToArchive(sessionDate.getFullYear(), sessionDate.getMonth(), [newSession], {});
    sessions = prev.sessions || [];
  }

  const globalTracking = {
    ...prev,
    totalTime: (prev.totalTime || 0) + duration,
    todayTime, weekTime, monthTime,
    lastActiveDate: today, weekStart, monthStart,
    sessions
  };

  globalTimesCache = null;
  timeTrackingDataState.set({ ...ttState, global: globalTracking });
  saveTimeTracking();
}

/**
 * Save a session to a project's time tracking data
 */
function saveSession(projectId, startTime, endTime, duration) {
  console.debug('[TimeTracking] saveSession:', { projectId, duration: Math.round(duration / 1000) + 's' });

  const today = getTodayString();

  const sessionDate = new Date(startTime);
  const now = new Date();
  const isCurrentMonthSession = sessionDate.getFullYear() === now.getFullYear()
    && sessionDate.getMonth() === now.getMonth();

  const ttState = timeTrackingDataState.get();
  const prev = ttState.projects[projectId] || {
    totalTime: 0, todayTime: 0, lastActiveDate: null, sessions: []
  };

  const tracking = { ...prev };

  if (tracking.lastActiveDate !== today) {
    tracking.todayTime = 0;
  }

  tracking.totalTime = (tracking.totalTime || 0) + duration;
  tracking.todayTime = (tracking.todayTime || 0) + duration;
  tracking.lastActiveDate = today;

  if (isCurrentMonthSession) {
    tracking.sessions = mergeOrAppendSession(tracking.sessions || [], startTime, endTime, duration);
  } else {
    const newSession = {
      id: generateSessionId(),
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      duration
    };
    const project = getProjectById(projectId);
    ArchiveService.appendToArchive(
      sessionDate.getFullYear(),
      sessionDate.getMonth(),
      [],
      { [projectId]: { projectName: project?.name || 'Unknown', sessions: [newSession] } }
    );
  }

  timeTrackingDataState.set({
    ...ttState,
    projects: { ...ttState.projects, [projectId]: tracking }
  });
  saveTimeTracking();
}

// ============================================================
// PROJECT TRACKING
// ============================================================

function startTracking(projectId) {
  if (!projectId) return;

  const state = trackingState.get();
  const activeSessions = new Map(state.activeSessions);
  const existingSession = activeSessions.get(projectId);

  if (existingSession && existingSession.sessionStartTime && !existingSession.isIdle) return;

  if (existingSession && existingSession.isIdle) {
    resumeTracking(projectId);
    return;
  }

  const wasEmpty = getActiveNonIdleCount() === 0;
  const now = Date.now();

  activeSessions.set(projectId, {
    sessionStartTime: now,
    lastActivityTime: now,
    isIdle: false
  });

  trackingState.set({ ...trackingState.get(), activeSessions });

  if (wasEmpty) startGlobalTimer();

  clearTimeout(idleTimers.get(projectId));
  idleTimers.set(projectId, setTimeout(() => checkAndPauseTracking(projectId), IDLE_TIMEOUT));
}

function stopTracking(projectId) {
  const state = trackingState.get();
  const activeSessions = new Map(state.activeSessions);
  const session = activeSessions.get(projectId);

  if (!session || !session.sessionStartTime) {
    activeSessions.delete(projectId);
    trackingState.set({ ...trackingState.get(), activeSessions });
    return;
  }

  const now = Date.now();
  const duration = now - session.sessionStartTime;
  if (duration > 1000) {
    saveSession(projectId, session.sessionStartTime, now, duration);
  }

  clearTimeout(idleTimers.get(projectId));
  idleTimers.delete(projectId);
  lastOutputTimes.delete(projectId);
  activeSessions.delete(projectId);

  trackingState.set({ ...trackingState.get(), activeSessions });

  if (getActiveNonIdleCount() === 0) stopGlobalTimer();
}

function recordActivity(projectId) {
  if (!projectId) return;

  const state = trackingState.get();
  const activeSessions = new Map(state.activeSessions);
  const session = activeSessions.get(projectId);

  if (!session) {
    startTracking(projectId);
    return;
  }

  if (session.isIdle) {
    resumeTracking(projectId);
    return;
  }

  clearTimeout(idleTimers.get(projectId));
  idleTimers.set(projectId, setTimeout(() => checkAndPauseTracking(projectId), IDLE_TIMEOUT));
  resetGlobalIdleTimer();

  activeSessions.set(projectId, { ...session, lastActivityTime: Date.now() });
  trackingState.set({ ...trackingState.get(), activeSessions });
}

function checkAndPauseTracking(projectId) {
  const lastOutput = lastOutputTimes.get(projectId) || 0;
  const timeSinceOutput = Date.now() - lastOutput;

  if (timeSinceOutput < OUTPUT_IDLE_TIMEOUT) {
    const delay = OUTPUT_IDLE_TIMEOUT - timeSinceOutput + 100;
    clearTimeout(idleTimers.get(projectId));
    idleTimers.set(projectId, setTimeout(() => checkAndPauseTracking(projectId), delay));
    return;
  }

  pauseTracking(projectId);
}

function checkAndPauseGlobalTimer() {
  const timeSinceOutput = Date.now() - globalLastOutputTime;

  if (timeSinceOutput < OUTPUT_IDLE_TIMEOUT) {
    const delay = OUTPUT_IDLE_TIMEOUT - timeSinceOutput + 100;
    clearTimeout(globalIdleTimer);
    globalIdleTimer = setTimeout(checkAndPauseGlobalTimer, delay);
    return;
  }

  pauseGlobalTimer();
}

function recordOutputActivity(projectId) {
  if (!projectId) return;

  const state = trackingState.get();
  const session = state.activeSessions.get(projectId);
  if (!session || session.isIdle) return;

  lastOutputTimes.set(projectId, Date.now());
  globalLastOutputTime = Date.now();
}

function pauseTracking(projectId) {
  const state = trackingState.get();
  const activeSessions = new Map(state.activeSessions);
  const session = activeSessions.get(projectId);

  if (!session || !session.sessionStartTime || session.isIdle) return;

  const now = Date.now();
  const duration = now - session.sessionStartTime;
  if (duration > 1000) {
    saveSession(projectId, session.sessionStartTime, now, duration);
  }

  activeSessions.set(projectId, { ...session, sessionStartTime: null, isIdle: true });
  trackingState.set({ ...trackingState.get(), activeSessions });

  if (getActiveNonIdleCount() === 0) pauseGlobalTimer();
}

function resumeTracking(projectId) {
  const state = trackingState.get();
  const activeSessions = new Map(state.activeSessions);
  const session = activeSessions.get(projectId);

  if (!session || !session.isIdle) return;

  const wasAllIdle = getActiveNonIdleCount() === 0;
  const now = Date.now();

  activeSessions.set(projectId, { sessionStartTime: now, lastActivityTime: now, isIdle: false });
  trackingState.set({ ...trackingState.get(), activeSessions });

  if (wasAllIdle) resumeGlobalTimer();

  clearTimeout(idleTimers.get(projectId));
  idleTimers.set(projectId, setTimeout(() => checkAndPauseTracking(projectId), IDLE_TIMEOUT));
}

function switchProject(oldProjectId, newProjectId) {
  if (newProjectId) startTracking(newProjectId);
}

// ============================================================
// GETTERS
// ============================================================

/**
 * Get time tracking data for a project
 */
function getProjectTimes(projectId) {
  const ttState = timeTrackingDataState.get();
  const tracking = ttState.projects[projectId];

  if (!tracking) return { today: 0, total: 0 };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  let todayFromSessions = 0;
  if (Array.isArray(tracking.sessions)) {
    for (const session of tracking.sessions) {
      const sessionDate = new Date(session.startTime);
      if (sessionDate >= todayStart && sessionDate < todayEnd) {
        todayFromSessions += session.duration || 0;
      }
    }
  }

  const state = trackingState.get();
  const session = state.activeSessions.get(projectId);
  let currentSessionTime = 0;
  let currentSessionTimeToday = 0;

  if (session && session.sessionStartTime && !session.isIdle) {
    const now = Date.now();
    currentSessionTime = now - session.sessionStartTime;
    const effectiveStart = Math.max(session.sessionStartTime, todayStart.getTime());
    currentSessionTimeToday = Math.max(0, now - effectiveStart);
  }

  return {
    today: todayFromSessions + currentSessionTimeToday,
    total: (tracking.totalTime || 0) + currentSessionTime
  };
}

/**
 * Get global time tracking stats
 */
function getGlobalTimes() {
  const now = new Date();
  const nowMs = now.getTime();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const weekStartDate = new Date(now);
  weekStartDate.setDate(weekStartDate.getDate() - diffToMonday);
  weekStartDate.setHours(0, 0, 0, 0);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);

  const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let todayTotal, weekTotal, monthTotal;

  if (globalTimesCache) {
    todayTotal = globalTimesCache.sessionsToday;
    weekTotal = globalTimesCache.sessionsWeek;
    monthTotal = globalTimesCache.sessionsMonth;
  } else {
    const ttState = timeTrackingDataState.get();
    const globalTracking = ttState.global;

    // Calculate from sessions
    let sessionsToday = 0, sessionsWeek = 0, sessionsMonth = 0;
    if (globalTracking) {
      const sessions = globalTracking.sessions || [];
      for (const session of sessions) {
        const sessionDate = new Date(session.startTime);
        const duration = session.duration || 0;

        if (sessionDate >= todayStart && sessionDate < todayEnd) sessionsToday += duration;
        if (sessionDate >= weekStartDate && sessionDate < weekEndDate) sessionsWeek += duration;
        if (sessionDate >= monthStartDate && sessionDate < monthEndDate) sessionsMonth += duration;
      }
    }

    // Use stored counters if they are higher (sessions may be truncated by old 500 cap)
    const storedToday = (globalTracking?.lastActiveDate === getTodayString()) ? (globalTracking?.todayTime || 0) : 0;
    const storedWeek = (globalTracking?.weekStart === getWeekStartString()) ? (globalTracking?.weekTime || 0) : 0;
    const storedMonth = (globalTracking?.monthStart === getMonthString()) ? (globalTracking?.monthTime || 0) : 0;

    todayTotal = Math.max(sessionsToday, storedToday);
    weekTotal = Math.max(sessionsWeek, storedWeek);
    monthTotal = Math.max(sessionsMonth, storedMonth);

    globalTimesCache = {
      sessionsToday: todayTotal,
      sessionsWeek: weekTotal,
      sessionsMonth: monthTotal
    };
  }

  const state = trackingState.get();
  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const sessionStart = state.globalSessionStartTime;

    const todayEffectiveStart = Math.max(sessionStart, todayStart.getTime());
    if (nowMs > todayEffectiveStart) todayTotal += nowMs - todayEffectiveStart;

    const weekEffectiveStart = Math.max(sessionStart, weekStartDate.getTime());
    if (nowMs > weekEffectiveStart) weekTotal += nowMs - weekEffectiveStart;

    const monthEffectiveStart = Math.max(sessionStart, monthStartDate.getTime());
    if (nowMs > monthEffectiveStart) monthTotal += nowMs - monthEffectiveStart;
  }

  return { today: todayTotal, week: weekTotal, month: monthTotal };
}

/**
 * Get sessions for a project (used by TimeTrackingDashboard)
 */
function getProjectSessions(projectId) {
  return timeTrackingDataState.get().projects[projectId]?.sessions || [];
}

/**
 * Get global tracking data (used by TimeTrackingDashboard)
 */
function getGlobalTrackingData() {
  return timeTrackingDataState.get().global;
}

function saveAllActiveSessions() {
  const state = trackingState.get();
  const now = Date.now();

  for (const [projectId, session] of state.activeSessions) {
    if (session.sessionStartTime && !session.isIdle) {
      const duration = now - session.sessionStartTime;
      if (duration > 1000) {
        saveSession(projectId, session.sessionStartTime, now, duration);
      }
    }
  }

  if (state.globalSessionStartTime && !state.globalIsIdle) {
    const duration = now - state.globalSessionStartTime;
    if (duration > 1000) {
      saveGlobalSession(state.globalSessionStartTime, now, duration);
    }
  }

  for (const timerId of idleTimers.values()) clearTimeout(timerId);
  idleTimers.clear();
  clearTimeout(globalIdleTimer);
  clearInterval(midnightCheckTimer);
  clearInterval(heartbeatTimer);
  clearInterval(checkpointTimer);

  trackingState.set({
    activeSessions: new Map(),
    globalSessionStartTime: null,
    globalLastActivityTime: null,
    globalIsIdle: false
  });

  saveTimeTrackingImmediate();
  console.debug('[TimeTracking] Forced immediate save on quit');
}

function hasTerminalsForProject(projectId, terminals) {
  for (const [, termData] of terminals) {
    if (termData.project && termData.project.id === projectId) return true;
  }
  return false;
}

function getTrackingState() {
  return trackingState.get();
}

function isTracking(projectId) {
  const state = trackingState.get();
  const session = state.activeSessions.get(projectId);
  return session && session.sessionStartTime && !session.isIdle;
}

function getActiveProjectCount() {
  const state = trackingState.get();
  let count = 0;
  for (const session of state.activeSessions.values()) {
    if (session.sessionStartTime && !session.isIdle) count++;
  }
  return count;
}

module.exports = {
  trackingState,
  initTimeTracking,
  startTracking,
  stopTracking,
  recordActivity,
  recordOutputActivity,
  pauseTracking,
  resumeTracking,
  switchProject,
  getProjectTimes,
  getGlobalTimes,
  getProjectSessions,
  getGlobalTrackingData,
  saveAllActiveSessions,
  hasTerminalsForProject,
  getTrackingState,
  ensureTimeTracking,
  isTracking,
  getActiveProjectCount
};
