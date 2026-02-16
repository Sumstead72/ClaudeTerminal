const {
  trackingState,
  initTimeTracking,
  startTracking,
  stopTracking,
  recordActivity,
  pauseTracking,
  resumeTracking,
  getProjectTimes,
  getGlobalTimes,
  getProjectSessions,
  getTrackingState,
  ensureTimeTracking,
  isTracking,
  getActiveProjectCount,
  hasTerminalsForProject,
} = require('../../src/renderer/state/timeTracking.state');

// Mock ArchiveService
jest.mock('../../src/renderer/services/ArchiveService', () => ({
  migrateOldArchives: jest.fn(),
  appendToArchive: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Reset fs mocks
  window.electron_nodeModules.fs.existsSync = jest.fn(() => false);
  window.electron_nodeModules.fs.readFileSync = jest.fn(() => '{}');
  window.electron_nodeModules.fs.writeFileSync = jest.fn();
  window.electron_nodeModules.fs.copyFileSync = jest.fn();
  window.electron_nodeModules.fs.renameSync = jest.fn();
  window.electron_nodeModules.fs.unlinkSync = jest.fn();
  window.electron_nodeModules.fs.promises.readFile = jest.fn().mockResolvedValue('{}');
});

afterEach(async () => {
  // Stop all active tracking to clean up timers
  const state = getTrackingState();
  if (state.activeSessions) {
    for (const [id] of state.activeSessions) {
      try { await stopTracking(id); } catch {}
    }
  }
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ── ensureTimeTracking ──

describe('ensureTimeTracking', () => {
  test('returns default tracking for null project', () => {
    const result = ensureTimeTracking(null);
    expect(result).toEqual({
      totalTime: 0,
      todayTime: 0,
      lastActiveDate: null,
      sessions: [],
    });
  });

  test('returns default tracking for new project', () => {
    const result = ensureTimeTracking({ id: 'new-project' });
    expect(result).toEqual(expect.objectContaining({
      totalTime: 0,
      todayTime: 0,
    }));
  });
});

// ── isTracking ──

describe('isTracking', () => {
  test('returns falsy for non-tracked project', () => {
    expect(isTracking('unknown-project')).toBeFalsy();
  });

  test('returns truthy after startTracking', () => {
    startTracking('proj-1');
    expect(isTracking('proj-1')).toBeTruthy();
  });

  test('returns falsy after stopTracking', async () => {
    startTracking('proj-1');
    jest.advanceTimersByTime(5000);
    await stopTracking('proj-1');
    expect(isTracking('proj-1')).toBeFalsy();
  });
});

// ── getActiveProjectCount ──

describe('getActiveProjectCount', () => {
  test('returns 0 when nothing is tracked', () => {
    expect(getActiveProjectCount()).toBe(0);
  });

  test('counts active (non-idle) sessions', () => {
    startTracking('proj-1');
    startTracking('proj-2');
    expect(getActiveProjectCount()).toBe(2);
  });
});

// ── startTracking / stopTracking ──

describe('startTracking', () => {
  test('creates active session', () => {
    startTracking('proj-1');
    const state = getTrackingState();
    expect(state.activeSessions.has('proj-1')).toBe(true);
    const session = state.activeSessions.get('proj-1');
    expect(session.isIdle).toBe(false);
    expect(session.sessionStartTime).toBeGreaterThan(0);
  });

  test('does not double-start already tracked project', () => {
    startTracking('proj-1');
    const firstStart = getTrackingState().activeSessions.get('proj-1').sessionStartTime;
    startTracking('proj-1');
    const secondStart = getTrackingState().activeSessions.get('proj-1').sessionStartTime;
    expect(firstStart).toBe(secondStart);
  });
});

describe('stopTracking', () => {
  test('removes project from active sessions', async () => {
    startTracking('proj-1');
    jest.advanceTimersByTime(5000);
    await stopTracking('proj-1');
    expect(getTrackingState().activeSessions.has('proj-1')).toBe(false);
  });
});

// ── pauseTracking / resumeTracking ──

describe('pauseTracking', () => {
  test('sets session to idle', async () => {
    startTracking('proj-1');
    jest.advanceTimersByTime(5000);
    await pauseTracking('proj-1');
    const session = getTrackingState().activeSessions.get('proj-1');
    expect(session.isIdle).toBe(true);
    expect(session.sessionStartTime).toBeNull();
  });
});

describe('resumeTracking', () => {
  test('resumes idle session', async () => {
    startTracking('proj-1');
    jest.advanceTimersByTime(5000);
    await pauseTracking('proj-1');
    resumeTracking('proj-1');
    const session = getTrackingState().activeSessions.get('proj-1');
    expect(session.isIdle).toBe(false);
    expect(session.sessionStartTime).toBeGreaterThan(0);
  });
});

// ── recordActivity ──

describe('recordActivity', () => {
  test('updates lastActivityTime on tracked project', () => {
    startTracking('proj-1');
    const before = getTrackingState().activeSessions.get('proj-1').lastActivityTime;
    jest.advanceTimersByTime(1000);
    recordActivity('proj-1');
    const after = getTrackingState().activeSessions.get('proj-1').lastActivityTime;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('does nothing for non-tracked project', () => {
    // Should not throw
    recordActivity('unknown');
  });
});

// ── hasTerminalsForProject ──

describe('hasTerminalsForProject', () => {
  test('returns true when terminals exist for project', () => {
    const terminals = new Map([
      ['t1', { project: { id: 'proj-1' } }],
      ['t2', { project: { id: 'proj-2' } }],
    ]);
    expect(hasTerminalsForProject('proj-1', terminals)).toBe(true);
  });

  test('returns false when no terminals for project', () => {
    const terminals = new Map([
      ['t1', { project: { id: 'proj-2' } }],
    ]);
    expect(hasTerminalsForProject('proj-1', terminals)).toBe(false);
  });

  test('returns false for empty terminal map', () => {
    expect(hasTerminalsForProject('proj-1', new Map())).toBe(false);
  });
});

// ── getProjectTimes ──

describe('getProjectTimes', () => {
  test('returns zeros for unknown project', () => {
    const times = getProjectTimes('unknown');
    expect(times.today).toBe(0);
    expect(times.total).toBe(0);
  });
});

// ── getGlobalTimes ──

describe('getGlobalTimes', () => {
  test('returns object with today, week, month keys', () => {
    const times = getGlobalTimes();
    expect(times).toHaveProperty('today');
    expect(times).toHaveProperty('week');
    expect(times).toHaveProperty('month');
    expect(typeof times.today).toBe('number');
    expect(typeof times.week).toBe('number');
    expect(typeof times.month).toBe('number');
  });
});

// ── getProjectSessions ──

describe('getProjectSessions', () => {
  test('returns empty array for unknown project', () => {
    expect(getProjectSessions('unknown')).toEqual([]);
  });
});
