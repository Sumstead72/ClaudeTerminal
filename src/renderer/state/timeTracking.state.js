/**
 * Time Tracking State Module
 * Tracks time spent on each project based on terminal activity
 */

const { State } = require('./State');

// Constants
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Runtime state (not persisted)
const trackingState = new State({
  activeProjectId: null,
  sessionStartTime: null,
  lastActivityTime: null,
  isIdle: false
});

// Internal state
let idleTimer = null;
let projectsStateRef = null;
let saveProjectsRef = null;

/**
 * Initialize with references to projects state functions
 * @param {Object} projectsState - Reference to projectsState
 * @param {Function} saveProjects - Reference to saveProjects function
 */
function initTimeTracking(projectsState, saveProjects) {
  projectsStateRef = projectsState;
  saveProjectsRef = saveProjects;
}

/**
 * Get today's date string for comparison
 * @returns {string}
 */
function getTodayString() {
  return new Date().toDateString();
}

/**
 * Initialize time tracking data for a project if not present
 * @param {Object} project
 * @returns {Object} - The timeTracking object
 */
function ensureTimeTracking(project) {
  if (!project.timeTracking) {
    project.timeTracking = {
      totalTime: 0,
      todayTime: 0,
      lastActiveDate: null,
      sessions: []
    };
  }
  return project.timeTracking;
}

/**
 * Reset today's time if date has changed
 * @param {Object} project
 */
function resetTodayIfNeeded(project) {
  const tracking = ensureTimeTracking(project);
  const today = getTodayString();

  if (tracking.lastActiveDate !== today) {
    tracking.todayTime = 0;
    tracking.lastActiveDate = today;
  }
}

/**
 * Get project by ID from projects state
 * @param {string} projectId
 * @returns {Object|undefined}
 */
function getProjectById(projectId) {
  if (!projectsStateRef) return undefined;
  return projectsStateRef.get().projects.find(p => p.id === projectId);
}

/**
 * Generate unique session ID
 * @returns {string}
 */
function generateSessionId() {
  return `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Start tracking time for a project
 * Idempotent - won't restart if already tracking this project
 * @param {string} projectId
 */
function startTracking(projectId) {
  const state = trackingState.get();

  // Already tracking this project
  if (state.activeProjectId === projectId && state.sessionStartTime) {
    return;
  }

  // If tracking a different project, stop it first
  if (state.activeProjectId && state.activeProjectId !== projectId) {
    stopTracking(state.activeProjectId);
  }

  const now = Date.now();

  trackingState.set({
    activeProjectId: projectId,
    sessionStartTime: now,
    lastActivityTime: now,
    isIdle: false
  });

  // Start idle timer
  clearTimeout(idleTimer);
  idleTimer = setTimeout(pauseTracking, IDLE_TIMEOUT);
}

/**
 * Stop tracking and save the session
 * @param {string} projectId
 */
function stopTracking(projectId) {
  const state = trackingState.get();

  // Not tracking this project
  if (state.activeProjectId !== projectId || !state.sessionStartTime) {
    return;
  }

  const now = Date.now();
  const duration = now - state.sessionStartTime;

  // Only save if we have a meaningful duration (> 1 second)
  if (duration > 1000) {
    saveSession(projectId, state.sessionStartTime, now, duration);
  }

  // Clear state
  clearTimeout(idleTimer);
  trackingState.set({
    activeProjectId: null,
    sessionStartTime: null,
    lastActivityTime: null,
    isIdle: false
  });
}

/**
 * Save a session to the project's time tracking data
 * @param {string} projectId
 * @param {number} startTime
 * @param {number} endTime
 * @param {number} duration
 */
function saveSession(projectId, startTime, endTime, duration) {
  if (!projectsStateRef || !saveProjectsRef) return;

  const project = getProjectById(projectId);
  if (!project) return;

  resetTodayIfNeeded(project);
  const tracking = ensureTimeTracking(project);

  // Update times
  tracking.totalTime += duration;
  tracking.todayTime += duration;
  tracking.lastActiveDate = getTodayString();

  // Add session (keep last 100 sessions)
  tracking.sessions.push({
    id: generateSessionId(),
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    duration
  });

  // Limit sessions to prevent excessive storage
  if (tracking.sessions.length > 100) {
    tracking.sessions = tracking.sessions.slice(-100);
  }

  // Update state and save
  const projects = projectsStateRef.get().projects.map(p =>
    p.id === projectId ? { ...p, timeTracking: tracking } : p
  );
  projectsStateRef.set({ projects });
  saveProjectsRef();
}

/**
 * Record activity - resets idle timer
 */
function recordActivity() {
  const state = trackingState.get();

  // Not tracking anything
  if (!state.activeProjectId) return;

  // Resume if was idle
  if (state.isIdle) {
    resumeTracking();
  }

  // Reset idle timer
  clearTimeout(idleTimer);
  idleTimer = setTimeout(pauseTracking, IDLE_TIMEOUT);

  trackingState.set({
    ...state,
    lastActivityTime: Date.now(),
    isIdle: false
  });
}

/**
 * Pause tracking due to idle
 */
function pauseTracking() {
  const state = trackingState.get();

  if (!state.activeProjectId || !state.sessionStartTime || state.isIdle) {
    return;
  }

  const now = Date.now();
  const duration = now - state.sessionStartTime;

  // Save the session up to now
  if (duration > 1000) {
    saveSession(state.activeProjectId, state.sessionStartTime, now, duration);
  }

  // Mark as idle but keep project reference
  trackingState.set({
    ...state,
    sessionStartTime: null,
    isIdle: true
  });
}

/**
 * Resume tracking after activity
 */
function resumeTracking() {
  const state = trackingState.get();

  if (!state.activeProjectId || !state.isIdle) {
    return;
  }

  const now = Date.now();

  trackingState.set({
    ...state,
    sessionStartTime: now,
    lastActivityTime: now,
    isIdle: false
  });

  // Restart idle timer
  clearTimeout(idleTimer);
  idleTimer = setTimeout(pauseTracking, IDLE_TIMEOUT);
}

/**
 * Switch tracking from one project to another
 * @param {string} oldProjectId
 * @param {string} newProjectId
 */
function switchProject(oldProjectId, newProjectId) {
  if (oldProjectId === newProjectId) return;

  if (oldProjectId) {
    stopTracking(oldProjectId);
  }

  if (newProjectId) {
    startTracking(newProjectId);
  }
}

/**
 * Get time tracking data for a project
 * @param {string} projectId
 * @returns {{ today: number, total: number }}
 */
function getProjectTimes(projectId) {
  const project = getProjectById(projectId);

  if (!project || !project.timeTracking) {
    return { today: 0, total: 0 };
  }

  // Check if we need to reset today
  const tracking = project.timeTracking;
  const today = getTodayString();

  if (tracking.lastActiveDate !== today) {
    return { today: 0, total: tracking.totalTime || 0 };
  }

  // Add current session time if actively tracking this project
  const state = trackingState.get();
  let currentSessionTime = 0;

  if (state.activeProjectId === projectId && state.sessionStartTime && !state.isIdle) {
    currentSessionTime = Date.now() - state.sessionStartTime;
  }

  return {
    today: (tracking.todayTime || 0) + currentSessionTime,
    total: (tracking.totalTime || 0) + currentSessionTime
  };
}

/**
 * Save all active sessions (for app close)
 */
function saveAllActiveSessions() {
  const state = trackingState.get();

  if (state.activeProjectId && state.sessionStartTime && !state.isIdle) {
    const now = Date.now();
    const duration = now - state.sessionStartTime;

    if (duration > 1000) {
      saveSession(state.activeProjectId, state.sessionStartTime, now, duration);
    }
  }

  // Clear state
  clearTimeout(idleTimer);
  trackingState.set({
    activeProjectId: null,
    sessionStartTime: null,
    lastActivityTime: null,
    isIdle: false
  });
}

/**
 * Check if there are terminals for a project
 * @param {string} projectId
 * @param {Map} terminals - Terminals map from terminalsState
 * @returns {boolean}
 */
function hasTerminalsForProject(projectId, terminals) {
  for (const [, termData] of terminals) {
    if (termData.project && termData.project.id === projectId) {
      return true;
    }
  }
  return false;
}

/**
 * Get the tracking state (for debugging)
 * @returns {Object}
 */
function getTrackingState() {
  return trackingState.get();
}

/**
 * Check if a date is in the current week (Monday to Sunday)
 * @param {Date} date
 * @returns {boolean}
 */
function isInCurrentWeek(date) {
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? 6 : day - 1; // Adjust for Monday start
  startOfWeek.setDate(startOfWeek.getDate() - diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  return date >= startOfWeek && date < endOfWeek;
}

/**
 * Check if a date is in the current month
 * @param {Date} date
 * @returns {boolean}
 */
function isInCurrentMonth(date) {
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

/**
 * Get global time tracking stats across all projects
 * @returns {{ today: number, week: number, month: number }}
 */
function getGlobalTimes() {
  if (!projectsStateRef) {
    return { today: 0, week: 0, month: 0 };
  }

  const projects = projectsStateRef.get().projects;
  const today = getTodayString();
  const now = new Date();
  const state = trackingState.get();

  let todayTotal = 0;
  let weekTotal = 0;
  let monthTotal = 0;

  for (const project of projects) {
    if (!project.timeTracking) continue;

    const tracking = project.timeTracking;

    // Today's time (from saved todayTime if date matches)
    if (tracking.lastActiveDate === today) {
      todayTotal += tracking.todayTime || 0;
    }

    // Calculate week and month from sessions
    if (tracking.sessions && tracking.sessions.length > 0) {
      for (const session of tracking.sessions) {
        const sessionDate = new Date(session.startTime);
        const duration = session.duration || 0;

        if (isInCurrentWeek(sessionDate)) {
          weekTotal += duration;
        }
        if (isInCurrentMonth(sessionDate)) {
          monthTotal += duration;
        }
      }
    }
  }

  // Add current active session time
  if (state.activeProjectId && state.sessionStartTime && !state.isIdle) {
    const currentSessionTime = Date.now() - state.sessionStartTime;
    todayTotal += currentSessionTime;
    weekTotal += currentSessionTime;
    monthTotal += currentSessionTime;
  }

  return { today: todayTotal, week: weekTotal, month: monthTotal };
}

module.exports = {
  trackingState,
  initTimeTracking,
  startTracking,
  stopTracking,
  recordActivity,
  pauseTracking,
  resumeTracking,
  switchProject,
  getProjectTimes,
  getGlobalTimes,
  saveAllActiveSessions,
  hasTerminalsForProject,
  getTrackingState,
  ensureTimeTracking
};
