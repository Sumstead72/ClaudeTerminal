const {
  projectsState,
  generateFolderId,
  generateProjectId,
  getFolder,
  getProject,
  getProjectIndex,
  getChildFolders,
  getProjectsInFolder,
  countProjectsRecursive,
  isDescendantOf,
  loadProjects,
  createFolder,
  deleteFolder,
  renameFolder,
  renameProject,
  setFolderColor,
  setProjectColor,
  setProjectIcon,
  setFolderIcon,
  toggleFolderCollapse,
  addProject,
  updateProject,
  deleteProject,
  moveItemToFolder,
  getQuickActions,
  addQuickAction,
  updateQuickAction,
  deleteQuickAction,
  reorderQuickActions,
  setProjectEditor,
  getProjectEditor,
  getVisualProjectOrder,
  setSelectedProjectFilter,
  setOpenedProjectId,
} = require('../../src/renderer/state/projects.state');

// Helper to reset state before each test
function resetState(override = {}) {
  projectsState.set({
    projects: [],
    folders: [],
    rootOrder: [],
    selectedProjectFilter: null,
    openedProjectId: null,
    ...override,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetState();
  window.electron_nodeModules.fs.existsSync.mockReturnValue(false);
  window.electron_nodeModules.fs.readFileSync.mockReturnValue('[]');
  window.electron_nodeModules.fs.writeFileSync.mockImplementation(() => {});
  window.electron_nodeModules.fs.renameSync.mockImplementation(() => {});
  window.electron_nodeModules.fs.copyFileSync.mockImplementation(() => {});
  window.electron_nodeModules.fs.unlinkSync.mockImplementation(() => {});
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ── ID Generation ──

describe('generateFolderId', () => {
  test('returns string starting with "folder-"', () => {
    const id = generateFolderId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('folder-')).toBe(true);
  });

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateFolderId()));
    expect(ids.size).toBe(20);
  });
});

describe('generateProjectId', () => {
  test('returns string starting with "project-"', () => {
    const id = generateProjectId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('project-')).toBe(true);
  });
});

// ── Getters ──

describe('getFolder', () => {
  test('returns folder by ID', () => {
    resetState({
      folders: [{ id: 'f1', name: 'Folder 1', parentId: null, collapsed: false, children: [] }],
    });
    expect(getFolder('f1')).toEqual(expect.objectContaining({ id: 'f1', name: 'Folder 1' }));
  });

  test('returns undefined for non-existent ID', () => {
    expect(getFolder('nonexistent')).toBeUndefined();
  });
});

describe('getProject', () => {
  test('returns project by ID', () => {
    resetState({
      projects: [{ id: 'p1', name: 'Project 1', path: '/test', folderId: null }],
    });
    expect(getProject('p1')).toEqual(expect.objectContaining({ id: 'p1', name: 'Project 1' }));
  });

  test('returns undefined for non-existent ID', () => {
    expect(getProject('nonexistent')).toBeUndefined();
  });
});

describe('getProjectIndex', () => {
  test('returns correct index', () => {
    resetState({
      projects: [
        { id: 'p1', name: 'A', folderId: null },
        { id: 'p2', name: 'B', folderId: null },
      ],
    });
    expect(getProjectIndex('p2')).toBe(1);
  });

  test('returns -1 for non-existent project', () => {
    expect(getProjectIndex('nonexistent')).toBe(-1);
  });
});

describe('getChildFolders', () => {
  test('returns child folders of a parent', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Parent', parentId: null, children: ['f2'] },
        { id: 'f2', name: 'Child', parentId: 'f1', children: [] },
        { id: 'f3', name: 'Root', parentId: null, children: [] },
      ],
    });
    const children = getChildFolders('f1');
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe('f2');
  });

  test('returns root-level folders when parentId is null', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Root1', parentId: null, children: [] },
        { id: 'f2', name: 'Child', parentId: 'f1', children: [] },
      ],
    });
    const roots = getChildFolders(null);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('f1');
  });
});

describe('getProjectsInFolder', () => {
  test('returns projects in a specific folder', () => {
    resetState({
      projects: [
        { id: 'p1', name: 'A', folderId: 'f1' },
        { id: 'p2', name: 'B', folderId: null },
        { id: 'p3', name: 'C', folderId: 'f1' },
      ],
    });
    const inFolder = getProjectsInFolder('f1');
    expect(inFolder).toHaveLength(2);
    expect(inFolder.map(p => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('countProjectsRecursive', () => {
  test('counts projects in nested folders', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Root', parentId: null, children: ['f2', 'p1'] },
        { id: 'f2', name: 'Sub', parentId: 'f1', children: ['p2'] },
      ],
      projects: [
        { id: 'p1', name: 'A', folderId: 'f1' },
        { id: 'p2', name: 'B', folderId: 'f2' },
        { id: 'p3', name: 'C', folderId: null },
      ],
    });
    expect(countProjectsRecursive('f1')).toBe(2);
  });

  test('returns 0 for empty folder', () => {
    resetState({
      folders: [{ id: 'f1', name: 'Empty', parentId: null, children: [] }],
    });
    expect(countProjectsRecursive('f1')).toBe(0);
  });
});

describe('isDescendantOf', () => {
  test('returns true for direct child', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Root', parentId: null, children: ['f2'] },
        { id: 'f2', name: 'Child', parentId: 'f1', children: [] },
      ],
    });
    expect(isDescendantOf('f2', 'f1')).toBe(true);
  });

  test('returns true for nested descendant', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Root', parentId: null, children: ['f2'] },
        { id: 'f2', name: 'Sub', parentId: 'f1', children: ['f3'] },
        { id: 'f3', name: 'Deep', parentId: 'f2', children: [] },
      ],
    });
    expect(isDescendantOf('f3', 'f1')).toBe(true);
  });

  test('returns false for unrelated folders', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'A', parentId: null, children: [] },
        { id: 'f2', name: 'B', parentId: null, children: [] },
      ],
    });
    expect(isDescendantOf('f2', 'f1')).toBe(false);
  });
});

// ── Folder CRUD ──

describe('createFolder', () => {
  test('creates root folder', () => {
    const folder = createFolder('New Folder');
    expect(folder.name).toBe('New Folder');
    expect(folder.parentId).toBeNull();
    expect(folder.collapsed).toBe(false);
    expect(folder.children).toEqual([]);

    const state = projectsState.get();
    expect(state.folders).toHaveLength(1);
    expect(state.rootOrder).toContain(folder.id);
  });

  test('creates nested folder', () => {
    const parent = createFolder('Parent');
    const child = createFolder('Child', parent.id);

    expect(child.parentId).toBe(parent.id);
    const state = projectsState.get();
    const updatedParent = state.folders.find(f => f.id === parent.id);
    expect(updatedParent.children).toContain(child.id);
  });
});

describe('deleteFolder', () => {
  test('removes folder and moves children to root', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Parent', parentId: null, collapsed: false, children: [] },
      ],
      projects: [
        { id: 'p1', name: 'A', folderId: 'f1', path: '/a' },
      ],
      rootOrder: ['f1'],
    });

    deleteFolder('f1');
    const state = projectsState.get();
    expect(state.folders).toHaveLength(0);
    expect(state.projects[0].folderId).toBeNull();
    expect(state.rootOrder).toContain('p1');
  });

  test('does nothing for non-existent folder', () => {
    deleteFolder('nonexistent');
    expect(projectsState.get().folders).toHaveLength(0);
  });
});

describe('renameFolder', () => {
  test('updates folder name', () => {
    resetState({
      folders: [{ id: 'f1', name: 'Old', parentId: null, children: [] }],
    });
    renameFolder('f1', 'New');
    expect(getFolder('f1').name).toBe('New');
  });
});

describe('toggleFolderCollapse', () => {
  test('toggles collapsed state', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, collapsed: false, children: [] }],
    });
    toggleFolderCollapse('f1');
    expect(getFolder('f1').collapsed).toBe(true);
    toggleFolderCollapse('f1');
    expect(getFolder('f1').collapsed).toBe(false);
  });
});

// ── Project CRUD ──

describe('addProject', () => {
  test('adds project with defaults', () => {
    const project = addProject({ name: 'Test', path: '/test' });
    expect(project.name).toBe('Test');
    expect(project.type).toBe('standalone');
    expect(project.folderId).toBeNull();
    expect(project.id).toMatch(/^project-/);

    const state = projectsState.get();
    expect(state.projects).toHaveLength(1);
    expect(state.rootOrder).toContain(project.id);
  });

  test('respects provided values', () => {
    const project = addProject({ name: 'Test', path: '/test', type: 'webapp', folderId: null });
    expect(project.type).toBe('webapp');
  });
});

describe('updateProject', () => {
  test('updates project fields', () => {
    resetState({
      projects: [{ id: 'p1', name: 'Old', path: '/test', folderId: null }],
    });
    updateProject('p1', { name: 'New', path: '/new' });
    const p = getProject('p1');
    expect(p.name).toBe('New');
    expect(p.path).toBe('/new');
  });
});

describe('deleteProject', () => {
  test('removes project from state and rootOrder', () => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }],
      rootOrder: ['p1'],
    });
    deleteProject('p1');
    const state = projectsState.get();
    expect(state.projects).toHaveLength(0);
    expect(state.rootOrder).not.toContain('p1');
  });

  test('removes from parent folder children', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, children: ['p1'], collapsed: false }],
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: 'f1' }],
      rootOrder: ['f1'],
    });
    deleteProject('p1');
    const state = projectsState.get();
    expect(state.projects).toHaveLength(0);
    const folder = state.folders.find(f => f.id === 'f1');
    expect(folder.children).not.toContain('p1');
  });

  test('does nothing for non-existent project', () => {
    deleteProject('nonexistent');
  });
});

describe('renameProject', () => {
  test('updates project name', () => {
    resetState({
      projects: [{ id: 'p1', name: 'Old', path: '/test', folderId: null }],
    });
    renameProject('p1', 'New');
    expect(getProject('p1').name).toBe('New');
  });
});

// ── Color/Icon ──

describe('setProjectColor', () => {
  test('sets color on project', () => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }],
    });
    setProjectColor('p1', '#ff0000');
    expect(getProject('p1').color).toBe('#ff0000');
  });

  test('removes color with null', () => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null, color: '#ff0000' }],
    });
    setProjectColor('p1', null);
    expect(getProject('p1').color).toBeUndefined();
  });
});

describe('setProjectIcon', () => {
  test('sets icon on project', () => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }],
    });
    setProjectIcon('p1', '🚀');
    expect(getProject('p1').icon).toBe('🚀');
  });
});

describe('setFolderColor', () => {
  test('sets color on folder', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, children: [] }],
    });
    setFolderColor('f1', '#00ff00');
    expect(getFolder('f1').color).toBe('#00ff00');
  });
});

describe('setFolderIcon', () => {
  test('sets icon on folder', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, children: [] }],
    });
    setFolderIcon('f1', '📁');
    expect(getFolder('f1').icon).toBe('📁');
  });
});

// ── Move & Reorder ──

describe('moveItemToFolder', () => {
  test('moves project to folder', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, collapsed: false, children: [] }],
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }],
      rootOrder: ['f1', 'p1'],
    });
    moveItemToFolder('project', 'p1', 'f1');
    const state = projectsState.get();
    expect(state.projects[0].folderId).toBe('f1');
    expect(state.rootOrder).not.toContain('p1');
    expect(state.folders[0].children).toContain('p1');
  });

  test('moves project to root', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, collapsed: false, children: ['p1'] }],
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: 'f1' }],
      rootOrder: ['f1'],
    });
    moveItemToFolder('project', 'p1', null);
    const state = projectsState.get();
    expect(state.projects[0].folderId).toBeNull();
    expect(state.rootOrder).toContain('p1');
  });

  test('prevents moving folder into itself', () => {
    resetState({
      folders: [{ id: 'f1', name: 'F', parentId: null, collapsed: false, children: [] }],
      rootOrder: ['f1'],
    });
    moveItemToFolder('folder', 'f1', 'f1');
    expect(getFolder('f1').parentId).toBeNull();
  });
});

// ── Quick Actions ──

describe('quick actions', () => {
  beforeEach(() => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null, quickActions: [] }],
    });
  });

  test('getQuickActions returns empty array by default', () => {
    expect(getQuickActions('p1')).toEqual([]);
  });

  test('addQuickAction adds action', () => {
    const action = addQuickAction('p1', { name: 'Build', command: 'npm run build', icon: '🔨' });
    expect(action.id).toMatch(/^qa-/);
    expect(getQuickActions('p1')).toHaveLength(1);
    expect(getQuickActions('p1')[0].name).toBe('Build');
  });

  test('updateQuickAction modifies action', () => {
    const action = addQuickAction('p1', { name: 'Old', command: 'old', icon: '📦' });
    updateQuickAction('p1', action.id, { name: 'New' });
    expect(getQuickActions('p1')[0].name).toBe('New');
  });

  test('deleteQuickAction removes action', () => {
    const action = addQuickAction('p1', { name: 'Test', command: 'test', icon: '🧪' });
    deleteQuickAction('p1', action.id);
    expect(getQuickActions('p1')).toHaveLength(0);
  });

  test('reorderQuickActions swaps positions', () => {
    addQuickAction('p1', { name: 'A', command: 'a', icon: '1' });
    addQuickAction('p1', { name: 'B', command: 'b', icon: '2' });
    reorderQuickActions('p1', 0, 1);
    const actions = getQuickActions('p1');
    expect(actions[0].name).toBe('B');
    expect(actions[1].name).toBe('A');
  });
});

// ── Editor per project ──

describe('project editor', () => {
  beforeEach(() => {
    resetState({
      projects: [{ id: 'p1', name: 'A', path: '/a', folderId: null }],
    });
  });

  test('getProjectEditor returns null by default', () => {
    expect(getProjectEditor('p1')).toBeNull();
  });

  test('setProjectEditor sets editor', () => {
    setProjectEditor('p1', 'cursor');
    expect(getProjectEditor('p1')).toBe('cursor');
  });

  test('setProjectEditor clears with null', () => {
    setProjectEditor('p1', 'cursor');
    setProjectEditor('p1', null);
    expect(getProjectEditor('p1')).toBeNull();
  });
});

// ── UI State ──

describe('UI state', () => {
  test('setSelectedProjectFilter updates filter', () => {
    setSelectedProjectFilter(2);
    expect(projectsState.get().selectedProjectFilter).toBe(2);
  });

  test('setOpenedProjectId updates opened project', () => {
    setOpenedProjectId('p1');
    expect(projectsState.get().openedProjectId).toBe('p1');
  });
});

// ── Load Projects ──

describe('loadProjects', () => {
  test('handles missing file gracefully', async () => {
    window.electron_nodeModules.fs.existsSync.mockReturnValue(false);
    await loadProjects();
    // Should not throw
  });

  test('handles empty file', async () => {
    window.electron_nodeModules.fs.existsSync.mockReturnValue(true);
    window.electron_nodeModules.fs.promises.readFile.mockResolvedValue('   ');
    await loadProjects();
    const state = projectsState.get();
    expect(state.projects).toEqual([]);
    expect(state.folders).toEqual([]);
  });

  test('migrates old array format', async () => {
    window.electron_nodeModules.fs.existsSync.mockReturnValue(true);
    window.electron_nodeModules.fs.promises.readFile.mockResolvedValue(
      JSON.stringify([
        { name: 'Test', path: '/test' }
      ])
    );
    await loadProjects();
    const state = projectsState.get();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].type).toBe('standalone');
    expect(state.projects[0].folderId).toBeNull();
    expect(state.rootOrder).toHaveLength(1);
  });

  test('loads new format correctly', async () => {
    window.electron_nodeModules.fs.existsSync.mockReturnValue(true);
    window.electron_nodeModules.fs.promises.readFile.mockResolvedValue(
      JSON.stringify({
        projects: [{ id: 'p1', name: 'Test', path: '/test', type: 'webapp', folderId: null }],
        folders: [{ id: 'f1', name: 'Folder', parentId: null, children: [] }],
        rootOrder: ['f1', 'p1'],
      })
    );
    await loadProjects();
    const state = projectsState.get();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].name).toBe('Test');
    expect(state.folders).toHaveLength(1);
  });

  test('handles corrupted JSON', async () => {
    window.electron_nodeModules.fs.existsSync.mockReturnValue(true);
    window.electron_nodeModules.fs.promises.readFile.mockResolvedValue('{corrupted json');
    // Mock notification API
    window.electron_api.notification = { show: jest.fn() };
    await loadProjects();
    const state = projectsState.get();
    expect(state.projects).toEqual([]);
  });
});

// ── Visual Order ──

describe('getVisualProjectOrder', () => {
  test('returns flat list respecting rootOrder', () => {
    resetState({
      folders: [],
      projects: [
        { id: 'p1', name: 'A', path: '/a', folderId: null },
        { id: 'p2', name: 'B', path: '/b', folderId: null },
      ],
      rootOrder: ['p2', 'p1'],
    });
    const order = getVisualProjectOrder();
    expect(order[0].id).toBe('p2');
    expect(order[1].id).toBe('p1');
  });

  test('includes projects inside folders via children', () => {
    resetState({
      folders: [
        { id: 'f1', name: 'Folder', parentId: null, collapsed: false, children: ['p2'] },
      ],
      projects: [
        { id: 'p1', name: 'Root', path: '/a', folderId: null },
        { id: 'p2', name: 'InFolder', path: '/b', folderId: 'f1' },
      ],
      rootOrder: ['f1', 'p1'],
    });
    const order = getVisualProjectOrder();
    expect(order).toHaveLength(2); // p2 (inside f1) + p1
    expect(order[0].id).toBe('p2'); // folder children first
    expect(order[1].id).toBe('p1');
  });
});
