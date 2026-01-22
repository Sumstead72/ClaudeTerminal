/**
 * TerminalManager Component
 * Handles terminal creation, rendering and management
 */

const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const {
  terminalsState,
  addTerminal,
  updateTerminal,
  removeTerminal,
  setActiveTerminal: setActiveTerminalState,
  getTerminal,
  getActiveTerminal,
  projectsState,
  getProjectIndex,
  getFivemServer,
  addFivemLog
} = require('../../state');
const { escapeHtml } = require('../../utils');

// Store FiveM console IDs by project index
const fivemConsoleIds = new Map();

// Callbacks
let callbacks = {
  onNotification: null,
  onRenderProjects: null
};

// Title extraction
const TITLE_STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'a', 'a', 'en', 'dans', 'sur', 'pour', 'par', 'avec',
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'for', 'with', 'to', 'of', 'is', 'are', 'it', 'this', 'that',
  'me', 'moi', 'mon', 'ma', 'mes', 'ce', 'cette', 'ces', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'can', 'you', 'please', 'help', 'want', 'need', 'like', 'would', 'could', 'should',
  'peux', 'veux', 'fais', 'fait', 'faire', 'est', 'sont', 'ai', 'as', 'avez', 'ont'
]);

/**
 * Set callbacks
 */
function setCallbacks(cbs) {
  Object.assign(callbacks, cbs);
}

/**
 * Extract title from user input - takes significant words to create a meaningful tab name
 */
function extractTitleFromInput(input) {
  let text = input.trim();
  if (text.startsWith('/') || text.length < 5) return null;
  const words = text.toLowerCase().replace(/[^\w\sàâäéèêëïîôùûüç-]/g, ' ').split(/\s+/)
    .filter(word => word.length > 2 && !TITLE_STOP_WORDS.has(word));
  if (words.length === 0) return null;
  // Take up to 4 significant words for a more descriptive title
  const titleWords = words.slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return titleWords.join(' ');
}

/**
 * Update terminal tab name
 */
function updateTerminalTabName(id, name) {
  const termData = getTerminal(id);
  if (!termData) return;

  // Update state
  updateTerminal(id, { name });

  // Update DOM
  const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
  if (tab) {
    const nameSpan = tab.querySelector('.tab-name');
    if (nameSpan) {
      nameSpan.textContent = name;
    }
  }
}

/**
 * Update terminal status
 */
function updateTerminalStatus(id, status) {
  const termData = getTerminal(id);
  if (termData && termData.status !== status) {
    const previousStatus = termData.status;
    updateTerminal(id, { status });
    const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
    if (tab) {
      tab.classList.remove('status-working', 'status-ready');
      tab.classList.add(`status-${status}`);
    }
    if (status === 'ready' && previousStatus === 'working') {
      if (callbacks.onNotification) {
        callbacks.onNotification(`✅ ${termData.name}`, 'Claude attend votre reponse', id);
      }
    }
  }
}

/**
 * Start renaming a tab
 */
function startRenameTab(id) {
  const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
  const nameSpan = tab.querySelector('.tab-name');
  const termData = getTerminal(id);
  const currentName = termData.name;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-name-input';
  input.value = currentName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = () => {
    const newName = input.value.trim() || currentName;
    updateTerminal(id, { name: newName });
    const newSpan = document.createElement('span');
    newSpan.className = 'tab-name';
    newSpan.textContent = newName;
    newSpan.ondblclick = (e) => { e.stopPropagation(); startRenameTab(id); };
    input.replaceWith(newSpan);
  };

  input.onblur = finishRename;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentName; input.blur(); }
  };
}

/**
 * Set active terminal
 */
function setActiveTerminal(id) {
  setActiveTerminalState(id);
  document.querySelectorAll('.terminal-tab').forEach(t => t.classList.toggle('active', t.dataset.id == id));
  document.querySelectorAll('.terminal-wrapper').forEach(w => w.classList.toggle('active', w.dataset.id == id));
  const termData = getTerminal(id);
  if (termData) {
    termData.fitAddon.fit();
    termData.terminal.focus();
  }
}

/**
 * Close terminal
 */
function closeTerminal(id) {
  ipcRenderer.send('terminal-kill', { id });
  const termData = getTerminal(id);
  if (termData && termData.terminal) termData.terminal.dispose();
  removeTerminal(id);
  document.querySelector(`.terminal-tab[data-id="${id}"]`)?.remove();
  document.querySelector(`.terminal-wrapper[data-id="${id}"]`)?.remove();

  const selectedFilter = projectsState.get().selectedProjectFilter;
  filterByProject(selectedFilter);
  if (callbacks.onRenderProjects) callbacks.onRenderProjects();
}

/**
 * Create a new terminal for a project
 */
async function createTerminal(project, options = {}) {
  const { skipPermissions = false, runClaude = true } = options;

  const id = await ipcRenderer.invoke('terminal-create', {
    cwd: project.path,
    runClaude,
    skipPermissions
  });

  const terminal = new Terminal({
    theme: {
      background: '#0d0d0d', foreground: '#e0e0e0', cursor: '#d97706',
      selection: 'rgba(217, 119, 6, 0.3)', black: '#1a1a1a', red: '#ef4444',
      green: '#22c55e', yellow: '#f59e0b', blue: '#3b82f6',
      magenta: '#a855f7', cyan: '#06b6d4', white: '#e0e0e0'
    },
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 14,
    cursorBlink: true
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const projectIndex = getProjectIndex(project.id);
  const termData = {
    terminal,
    fitAddon,
    project,
    projectIndex,
    name: project.name,
    status: 'ready',
    inputBuffer: ''
  };

  addTerminal(id, termData);

  // Create tab
  const tabsContainer = document.getElementById('terminals-tabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab status-ready';
  tab.dataset.id = id;
  tab.innerHTML = `
    <span class="status-dot"></span>
    <span class="tab-name">${escapeHtml(project.name)}</span>
    <button class="tab-close"><svg viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></button>`;
  tabsContainer.appendChild(tab);

  // Create wrapper
  const container = document.getElementById('terminals-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.dataset.id = id;
  container.appendChild(wrapper);

  document.getElementById('empty-terminals').style.display = 'none';

  terminal.open(wrapper);
  setTimeout(() => fitAddon.fit(), 100);
  setActiveTerminal(id);

  // Custom key handler for global shortcuts and copy/paste
  terminal.attachCustomKeyEventHandler((e) => {
    // Ctrl+Arrow to switch terminals - let event bubble up
    if (e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return false;
    }
    // Ctrl+Shift+C to copy selection
    if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
      return false;
    }
    // Ctrl+Shift+V to paste
    if (e.ctrlKey && e.shiftKey && e.key === 'V' && e.type === 'keydown') {
      navigator.clipboard.readText().then(text => {
        if (text) {
          ipcRenderer.send('terminal-input', { id, data: text });
        }
      });
      return false;
    }
    // Let xterm handle other keys
    return true;
  });

  // Title change handling
  let lastTitle = '';
  terminal.onTitleChange(title => {
    if (title === lastTitle) return;
    lastTitle = title;
    const spinnerChars = /[⠂⠄⠆⠇⠋⠙⠹⠸⠼⠴⠦⠧⠏]/;
    if (title.includes('✳')) updateTerminalStatus(id, 'ready');
    else if (spinnerChars.test(title)) updateTerminalStatus(id, 'working');
  });

  // IPC data handling
  const dataHandler = (event, data) => {
    if (data.id === id) terminal.write(data.data);
  };
  const exitHandler = (event, data) => {
    if (data.id === id) closeTerminal(id);
  };
  ipcRenderer.on('terminal-data', dataHandler);
  ipcRenderer.on('terminal-exit', exitHandler);

  // Input handling
  terminal.onData(data => {
    ipcRenderer.send('terminal-input', { id, data });
    const td = getTerminal(id);
    if (data === '\r' || data === '\n') {
      updateTerminalStatus(id, 'working');
      if (td && td.inputBuffer.trim().length > 0) {
        const title = extractTitleFromInput(td.inputBuffer);
        if (title) {
          // Update terminal tab name instead of window title
          updateTerminalTabName(id, title);
        }
        updateTerminal(id, { inputBuffer: '' });
      }
    } else if (data === '\x7f' || data === '\b') {
      if (td) updateTerminal(id, { inputBuffer: td.inputBuffer.slice(0, -1) });
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      if (td) updateTerminal(id, { inputBuffer: td.inputBuffer + data });
    }
  });

  // Resize handling
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('terminal-resize', { id, cols: terminal.cols, rows: terminal.rows });
  });
  resizeObserver.observe(wrapper);

  // Filter and render
  const selectedFilter = projectsState.get().selectedProjectFilter;
  filterByProject(selectedFilter);
  if (callbacks.onRenderProjects) callbacks.onRenderProjects();

  // Tab events
  tab.onclick = (e) => { if (!e.target.closest('.tab-close') && !e.target.closest('.tab-name-input')) setActiveTerminal(id); };
  tab.querySelector('.tab-name').ondblclick = (e) => { e.stopPropagation(); startRenameTab(id); };
  tab.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeTerminal(id); };

  return id;
}

/**
 * Create a FiveM console as a terminal tab
 */
function createFivemConsole(project, projectIndex, options = {}) {
  // Check if console already exists for this project
  const existingId = fivemConsoleIds.get(projectIndex);
  if (existingId && getTerminal(existingId)) {
    setActiveTerminal(existingId);
    return existingId;
  }

  const id = `fivem-${projectIndex}-${Date.now()}`;

  const terminal = new Terminal({
    theme: {
      background: '#0d0d0d',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#0d0d0d',
      selection: 'rgba(255, 255, 255, 0.2)',
      black: '#1e1e1e',
      red: '#f44747',
      green: '#6a9955',
      yellow: '#d7ba7d',
      blue: '#569cd6',
      magenta: '#c586c0',
      cyan: '#4ec9b0',
      white: '#d4d4d4'
    },
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: false,
    disableStdin: false,
    scrollback: 10000
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const termData = {
    terminal,
    fitAddon,
    project,
    projectIndex,
    name: `🖥️ ${project.name}`,
    status: 'ready',
    type: 'fivem',
    inputBuffer: ''
  };

  addTerminal(id, termData);
  fivemConsoleIds.set(projectIndex, id);

  // Create tab
  const tabsContainer = document.getElementById('terminals-tabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab fivem-tab status-ready';
  tab.dataset.id = id;
  tab.innerHTML = `
    <span class="status-dot fivem-dot"></span>
    <span class="tab-name">${escapeHtml(`🖥️ ${project.name}`)}</span>
    <button class="tab-close"><svg viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" fill="none"/></svg></button>`;
  tabsContainer.appendChild(tab);

  // Create wrapper
  const container = document.getElementById('terminals-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper fivem-wrapper';
  wrapper.dataset.id = id;
  container.appendChild(wrapper);

  document.getElementById('empty-terminals').style.display = 'none';

  terminal.open(wrapper);
  setTimeout(() => fitAddon.fit(), 100);
  setActiveTerminal(id);

  // Write existing logs
  const server = getFivemServer(projectIndex);
  if (server && server.logs && server.logs.length > 0) {
    terminal.write(server.logs.join(''));
  }

  // Custom key handler for global shortcuts and copy/paste
  terminal.attachCustomKeyEventHandler((e) => {
    // Ctrl+Arrow to switch terminals - let event bubble up
    if (e.ctrlKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      return false;
    }
    // Ctrl+Shift+C to copy selection
    if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
      return false;
    }
    // Ctrl+Shift+V to paste
    if (e.ctrlKey && e.shiftKey && e.key === 'V' && e.type === 'keydown') {
      navigator.clipboard.readText().then(text => {
        if (text) {
          ipcRenderer.send('fivem-input', { projectIndex, data: text });
        }
      });
      return false;
    }
    // Let xterm handle other keys
    return true;
  });

  // Handle input to FiveM console
  terminal.onData(data => {
    ipcRenderer.send('fivem-input', { projectIndex, data });
  });

  // Resize handling
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('fivem-resize', {
      projectIndex,
      cols: terminal.cols,
      rows: terminal.rows
    });
  });
  resizeObserver.observe(wrapper);

  // Send initial size
  ipcRenderer.send('fivem-resize', {
    projectIndex,
    cols: terminal.cols,
    rows: terminal.rows
  });

  // Filter and render
  const selectedFilter = projectsState.get().selectedProjectFilter;
  filterByProject(selectedFilter);
  if (callbacks.onRenderProjects) callbacks.onRenderProjects();

  // Tab events
  tab.onclick = (e) => { if (!e.target.closest('.tab-close') && !e.target.closest('.tab-name-input')) setActiveTerminal(id); };
  tab.querySelector('.tab-name').ondblclick = (e) => { e.stopPropagation(); startRenameTab(id); };
  tab.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeFivemConsole(id, projectIndex); };

  return id;
}

/**
 * Close FiveM console
 */
function closeFivemConsole(id, projectIndex) {
  const termData = getTerminal(id);
  if (termData && termData.terminal) termData.terminal.dispose();
  removeTerminal(id);
  fivemConsoleIds.delete(projectIndex);
  document.querySelector(`.terminal-tab[data-id="${id}"]`)?.remove();
  document.querySelector(`.terminal-wrapper[data-id="${id}"]`)?.remove();

  const selectedFilter = projectsState.get().selectedProjectFilter;
  filterByProject(selectedFilter);
  if (callbacks.onRenderProjects) callbacks.onRenderProjects();
}

/**
 * Get FiveM console terminal for a project
 */
function getFivemConsoleTerminal(projectIndex) {
  const id = fivemConsoleIds.get(projectIndex);
  if (id) {
    const termData = getTerminal(id);
    if (termData) {
      return termData.terminal;
    }
  }
  return null;
}

/**
 * Write data to FiveM console
 */
function writeFivemConsole(projectIndex, data) {
  const terminal = getFivemConsoleTerminal(projectIndex);
  if (terminal) {
    terminal.write(data);
  }
}

/**
 * Filter terminals by project
 */
function filterByProject(projectIndex) {
  const tabs = document.querySelectorAll('.terminal-tab');
  const wrappers = document.querySelectorAll('.terminal-wrapper');
  const emptyState = document.getElementById('empty-terminals');
  const filterIndicator = document.getElementById('terminals-filter');
  const filterProjectName = document.getElementById('filter-project-name');
  const projects = projectsState.get().projects;

  if (projectIndex !== null && projects[projectIndex]) {
    filterIndicator.style.display = 'flex';
    filterProjectName.textContent = projects[projectIndex].name;
  } else {
    filterIndicator.style.display = 'none';
  }

  let visibleCount = 0;
  let firstVisibleId = null;

  const terminals = terminalsState.get().terminals;
  terminals.forEach((termData, id) => {
    const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
    const wrapper = document.querySelector(`.terminal-wrapper[data-id="${id}"]`);
    const project = projects[projectIndex];
    const shouldShow = projectIndex === null || (project && termData.project && termData.project.path === project.path);

    if (tab) tab.style.display = shouldShow ? '' : 'none';
    if (wrapper) wrapper.style.display = shouldShow ? '' : 'none';
    if (shouldShow) {
      visibleCount++;
      if (!firstVisibleId) firstVisibleId = id;
    }
  });

  if (visibleCount === 0) {
    emptyState.style.display = 'flex';
    if (projectIndex !== null) {
      const project = projects[projectIndex];
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
        <p>Aucun terminal pour "${project?.name || 'ce projet'}"</p>
        <p class="hint">Cliquez sur "Claude" pour en creer un</p>`;
    } else {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
        <p>Selectionnez un projet et cliquez sur "Claude"</p>
        <p class="hint">Le terminal s'ouvrira ici</p>`;
    }
    setActiveTerminalState(null);
  } else {
    emptyState.style.display = 'none';
    const activeTab = document.querySelector(`.terminal-tab[data-id="${getActiveTerminal()}"]`);
    if (!activeTab || activeTab.style.display === 'none') {
      if (firstVisibleId) setActiveTerminal(firstVisibleId);
    }
  }
}

/**
 * Count terminals for a project
 */
function countTerminalsForProject(projectIndex) {
  if (projectIndex === null || projectIndex === undefined) return 0;
  const projects = projectsState.get().projects;
  const project = projects[projectIndex];
  if (!project) return 0;
  let count = 0;
  const terminals = terminalsState.get().terminals;
  terminals.forEach(termData => {
    if (termData.project && termData.project.path === project.path) count++;
  });
  return count;
}

/**
 * Show all terminals (remove filter)
 */
function showAll() {
  filterByProject(null);
}

module.exports = {
  createTerminal,
  closeTerminal,
  setActiveTerminal,
  filterByProject,
  countTerminalsForProject,
  showAll,
  setCallbacks,
  updateTerminalStatus,
  // FiveM console functions
  createFivemConsole,
  closeFivemConsole,
  getFivemConsoleTerminal,
  writeFivemConsole
};
