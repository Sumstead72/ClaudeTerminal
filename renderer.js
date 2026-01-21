const { ipcRenderer } = require('electron');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ========== STATE ==========
const state = {
  projects: [],
  activeProject: null,
  selectedProjectFilter: null, // Index du projet dont on affiche les terminaux
  terminals: new Map(),
  activeTerminal: null,
  skills: [],
  agents: [],
  mcps: [],           // Liste des MCPs configurés
  mcpProcesses: {},   // Map id -> { status, logs[] }
  selectedMcp: null,  // ID du MCP sélectionné pour les logs
  mcpLogsCollapsed: false, // État du panel logs
  notificationsEnabled: true,
  settings: {
    editor: 'code', // 'code', 'cursor', 'webstorm', 'idea'
    shortcut: 'Ctrl+Shift+P',
    skipPermissions: false // --dangerously-skip-permissions
  }
};

// Quick picker state
const quickPicker = {
  isOpen: false,
  selectedIndex: 0,
  filteredProjects: []
};

// ========== NOTIFICATIONS ==========
function showNotification(title, body, terminalId) {
  if (!state.notificationsEnabled) return;

  // Don't notify if window is focused and terminal is active
  if (document.hasFocus() && state.activeTerminal === terminalId) return;

  ipcRenderer.send('show-notification', { title, body, terminalId });
}

// Handle notification click from main process
ipcRenderer.on('notification-clicked', (event, { terminalId }) => {
  if (terminalId) {
    setActiveTerminal(terminalId);
    document.querySelector('[data-tab="claude"]').click();
  }
});

// ========== PATHS ==========
const dataDir = path.join(os.homedir(), '.claude-terminal');
const projectsFile = path.join(dataDir, 'projects.json');
const settingsFile = path.join(dataDir, 'settings.json');
const mcpsFile = path.join(dataDir, 'mcps.json');
const claudeDir = path.join(os.homedir(), '.claude');
const skillsDir = path.join(claudeDir, 'skills');
const agentsDir = path.join(claudeDir, 'agents');

// Create directories
[dataDir, skillsDir, agentsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========== DATA ==========
function loadProjects() {
  try {
    if (fs.existsSync(projectsFile)) {
      state.projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    }
  } catch (e) {
    state.projects = [];
  }
  renderProjects();
}

function saveProjects() {
  fs.writeFileSync(projectsFile, JSON.stringify(state.projects, null, 2));
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      state.settings = { ...state.settings, ...saved };
    }
  } catch (e) {}
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(state.settings, null, 2));
}

function loadSkills() {
  state.skills = [];
  try {
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir).forEach(item => {
        const itemPath = path.join(skillsDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const skillFile = path.join(itemPath, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            const content = fs.readFileSync(skillFile, 'utf8');
            const nameMatch = content.match(/^#\s+(.+)/m);
            const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
            state.skills.push({
              id: item,
              name: nameMatch ? nameMatch[1] : item,
              description: lines[0] || 'Aucune description',
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) {}
  renderSkills();
}

function loadAgents() {
  state.agents = [];
  try {
    if (fs.existsSync(agentsDir)) {
      fs.readdirSync(agentsDir).forEach(item => {
        const itemPath = path.join(agentsDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const agentFile = path.join(itemPath, 'AGENT.md');
          if (fs.existsSync(agentFile)) {
            const content = fs.readFileSync(agentFile, 'utf8');
            const nameMatch = content.match(/^#\s+(.+)/m);
            const descMatch = content.match(/description[:\s]+["']?([^"'\n]+)/i);
            state.agents.push({
              id: item,
              name: nameMatch ? nameMatch[1] : item,
              description: descMatch ? descMatch[1] : 'Aucune description',
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) {}
  renderAgents();
}

// ========== WINDOW CONTROLS ==========
document.getElementById('btn-minimize').onclick = () => ipcRenderer.send('window-minimize');
document.getElementById('btn-maximize').onclick = () => ipcRenderer.send('window-maximize');
document.getElementById('btn-close').onclick = () => ipcRenderer.send('window-close');

// ========== NOTIFICATIONS TOGGLE ==========
document.getElementById('btn-notifications').onclick = () => {
  state.notificationsEnabled = !state.notificationsEnabled;
  const btn = document.getElementById('btn-notifications');
  btn.classList.toggle('active', state.notificationsEnabled);

  // Request permission if enabling and not granted
  if (state.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

// ========== SETTINGS BUTTON ==========
document.getElementById('btn-settings').onclick = () => showSettingsModal();

// ========== TAB NAVIGATION ==========
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.onclick = () => {
    const tabId = tab.dataset.tab;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if (tabId === 'skills') loadSkills();
    if (tabId === 'agents') loadAgents();
    if (tabId === 'mcp') loadMcps();
    if (tabId === 'dashboard') populateDashboardProjects();
    // Resize active terminal when switching back
    if (tabId === 'claude' && state.activeTerminal) {
      const termData = state.terminals.get(state.activeTerminal);
      if (termData) termData.fitAddon.fit();
    }
  };
});

// ========== PROJECTS ==========
function renderProjects() {
  const list = document.getElementById('projects-list');
  if (state.projects.length === 0) {
    list.innerHTML = `
      <div class="empty-state small">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
        <p>Aucun projet</p>
        <p class="hint">Cliquez sur + pour ajouter</p>
      </div>`;
    return;
  }

  list.innerHTML = state.projects.map((p, i) => {
    const terminalCount = countTerminalsForProject(i);
    const isSelected = state.selectedProjectFilter === i;
    return `
    <div class="project-item ${isSelected ? 'active' : ''}" data-index="${i}">
      <div class="project-info">
        <div class="project-name">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
          <span>${p.name}</span>
          ${terminalCount > 0 ? `<span class="terminal-count">${terminalCount}</span>` : ''}
        </div>
        <div class="project-path">${p.path}</div>
      </div>
      <div class="project-actions">
        <button class="btn-action btn-claude" data-index="${i}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
          Claude
        </button>
        <button class="btn-action btn-folder" data-index="${i}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7l2 2h5v12zm0-12h-5l-2-2H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z"/></svg>
        </button>
        <button class="btn-action btn-delete" data-index="${i}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  `}).join('');

  list.querySelectorAll('.project-item').forEach(item => {
    item.onclick = (e) => {
      if (!e.target.closest('button')) {
        const index = parseInt(item.dataset.index);
        // Toggle: si on clique sur le meme projet, deselectionner (afficher tous)
        if (state.selectedProjectFilter === index) {
          state.selectedProjectFilter = null;
        } else {
          state.selectedProjectFilter = index;
        }
        renderProjects();
        filterTerminalsByProject(state.selectedProjectFilter);
      }
    };
  });

  list.querySelectorAll('.btn-claude').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      // Selectionner ce projet et creer le terminal
      state.selectedProjectFilter = index;
      renderProjects();
      createTerminal(state.projects[index]);
    };
  });

  list.querySelectorAll('.btn-folder').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      ipcRenderer.send('open-in-explorer', state.projects[parseInt(btn.dataset.index)].path);
    };
  });

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.index);
      if (confirm(`Supprimer "${state.projects[i].name}" ?`)) {
        state.projects.splice(i, 1);
        if (state.selectedProjectFilter === i) {
          state.selectedProjectFilter = null;
        } else if (state.selectedProjectFilter !== null && state.selectedProjectFilter > i) {
          state.selectedProjectFilter--;
        }
        saveProjects();
        renderProjects();
        filterTerminalsByProject(state.selectedProjectFilter);
      }
    };
  });
}

// ========== TERMINALS ==========
async function createTerminal(project) {
  const id = await ipcRenderer.invoke('terminal-create', {
    cwd: project.path,
    runClaude: true,
    skipPermissions: state.settings.skipPermissions
  });

  const terminal = new Terminal({
    theme: {
      background: '#0d0d0d',
      foreground: '#e0e0e0',
      cursor: '#d97706',
      selection: 'rgba(217, 119, 6, 0.3)',
      black: '#1a1a1a',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#e0e0e0'
    },
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 14,
    cursorBlink: true
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  state.terminals.set(id, { terminal, fitAddon, project, name: project.name, status: 'ready' });

  // Create tab
  const tabsContainer = document.getElementById('terminals-tabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab status-ready';
  tab.dataset.id = id;
  tab.innerHTML = `
    <span class="status-dot"></span>
    <span class="tab-name">${project.name}</span>
    <button class="tab-close">
      <svg viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
    </button>
  `;
  tabsContainer.appendChild(tab);

  // Create terminal container
  const container = document.getElementById('terminals-container');
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.dataset.id = id;
  container.appendChild(wrapper);

  // Hide empty state
  document.getElementById('empty-terminals').style.display = 'none';

  // Open terminal
  terminal.open(wrapper);
  setTimeout(() => fitAddon.fit(), 100);

  setActiveTerminal(id);

  // Status detection via terminal title (OSC sequences)
  // Claude Code sets emoji in the terminal title to indicate status
  let lastTitle = '';

  terminal.onTitleChange(title => {
    if (title === lastTitle) return;
    lastTitle = title;

    // Claude Code uses:
    // ✳ = waiting for user input (ready)
    // ⠂⠄⠆⠇⠋⠙⠹⠸⠼⠴⠦⠧ (braille spinner) = working

    const spinnerChars = /[⠂⠄⠆⠇⠋⠙⠹⠸⠼⠴⠦⠧⠏]/;

    if (title.includes('✳')) {
      updateTerminalStatus(id, 'ready');
    } else if (spinnerChars.test(title)) {
      updateTerminalStatus(id, 'working');
    }
  });

  // Handle data from main process
  const dataHandler = (event, data) => {
    if (data.id === id) {
      terminal.write(data.data);
    }
  };
  ipcRenderer.on('terminal-data', dataHandler);

  // Handle exit
  const exitHandler = (event, data) => {
    if (data.id === id) closeTerminal(id);
  };
  ipcRenderer.on('terminal-exit', exitHandler);

  // Terminal input - when user types, Claude is working
  terminal.onData(data => {
    ipcRenderer.send('terminal-input', { id, data });
    if (data === '\r' || data === '\n') {
      updateTerminalStatus(id, 'working');
    }
  });

  // Resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    ipcRenderer.send('terminal-resize', { id, cols: terminal.cols, rows: terminal.rows });
  });
  resizeObserver.observe(wrapper);

  // Appliquer le filtre actuel (le nouveau terminal doit etre visible si son projet est selectionne)
  filterTerminalsByProject(state.selectedProjectFilter);

  // Mettre a jour le compteur dans la liste des projets
  renderProjects();

  // Tab click - select terminal
  tab.onclick = (e) => {
    if (!e.target.closest('.tab-close') && !e.target.closest('.tab-name-input')) {
      setActiveTerminal(id);
    }
  };

  // Double-click on name to rename
  tab.querySelector('.tab-name').ondblclick = (e) => {
    e.stopPropagation();
    startRenameTab(id);
  };

  tab.querySelector('.tab-close').onclick = (e) => {
    e.stopPropagation();
    closeTerminal(id);
  };
}

function updateTerminalStatus(id, status) {
  const termData = state.terminals.get(id);
  if (termData && termData.status !== status) {
    const previousStatus = termData.status;
    termData.status = status;
    const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
    if (tab) {
      tab.classList.remove('status-working', 'status-ready');
      tab.classList.add(`status-${status}`);
    }

    // Send notification when Claude becomes ready (was working)
    if (status === 'ready' && previousStatus === 'working') {
      showNotification(
        `✅ ${termData.name}`,
        'Claude attend votre réponse',
        id
      );
    }
  }
}

function startRenameTab(id) {
  const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
  const nameSpan = tab.querySelector('.tab-name');
  const termData = state.terminals.get(id);
  const currentName = termData.name;

  // Create input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-name-input';
  input.value = currentName;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = () => {
    const newName = input.value.trim() || currentName;
    termData.name = newName;
    const newSpan = document.createElement('span');
    newSpan.className = 'tab-name';
    newSpan.textContent = newName;
    newSpan.ondblclick = (e) => {
      e.stopPropagation();
      startRenameTab(id);
    };
    input.replaceWith(newSpan);
  };

  input.onblur = finishRename;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      input.value = currentName;
      input.blur();
    }
  };
}

function setActiveTerminal(id) {
  state.activeTerminal = id;
  document.querySelectorAll('.terminal-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.id == id);
  });
  document.querySelectorAll('.terminal-wrapper').forEach(w => {
    w.classList.toggle('active', w.dataset.id == id);
  });
  const termData = state.terminals.get(id);
  if (termData) {
    termData.fitAddon.fit();
    termData.terminal.focus();
  }
}

function closeTerminal(id) {
  ipcRenderer.send('terminal-kill', { id });
  const termData = state.terminals.get(id);
  if (termData) termData.terminal.dispose();
  state.terminals.delete(id);

  document.querySelector(`.terminal-tab[data-id="${id}"]`)?.remove();
  document.querySelector(`.terminal-wrapper[data-id="${id}"]`)?.remove();

  // Re-filtrer les terminaux pour le projet actuel
  filterTerminalsByProject(state.selectedProjectFilter);

  // Mettre a jour le compteur dans la liste des projets
  renderProjects();
}

// Compte les terminaux associes a un projet
function countTerminalsForProject(projectIndex) {
  if (projectIndex === null || projectIndex === undefined) return 0;
  const project = state.projects[projectIndex];
  if (!project) return 0;

  let count = 0;
  state.terminals.forEach(termData => {
    if (termData.project && termData.project.path === project.path) {
      count++;
    }
  });
  return count;
}

// Filtre les terminaux pour n'afficher que ceux du projet selectionne
function filterTerminalsByProject(projectIndex) {
  state.selectedProjectFilter = projectIndex;

  const tabs = document.querySelectorAll('.terminal-tab');
  const wrappers = document.querySelectorAll('.terminal-wrapper');
  const emptyState = document.getElementById('empty-terminals');
  const filterIndicator = document.getElementById('terminals-filter');
  const filterProjectName = document.getElementById('filter-project-name');

  // Mettre a jour l'indicateur de filtre
  if (projectIndex !== null && state.projects[projectIndex]) {
    filterIndicator.style.display = 'flex';
    filterProjectName.textContent = state.projects[projectIndex].name;
  } else {
    filterIndicator.style.display = 'none';
  }

  let visibleCount = 0;
  let firstVisibleId = null;

  state.terminals.forEach((termData, id) => {
    const tab = document.querySelector(`.terminal-tab[data-id="${id}"]`);
    const wrapper = document.querySelector(`.terminal-wrapper[data-id="${id}"]`);

    // Si pas de filtre (null), tout afficher
    // Sinon, verifier si le terminal appartient au projet
    const project = state.projects[projectIndex];
    const shouldShow = projectIndex === null ||
      (project && termData.project && termData.project.path === project.path);

    if (tab) tab.style.display = shouldShow ? '' : 'none';
    if (wrapper) wrapper.style.display = shouldShow ? '' : 'none';

    if (shouldShow) {
      visibleCount++;
      if (!firstVisibleId) firstVisibleId = id;
    }
  });

  // Gerer l'etat vide
  if (visibleCount === 0) {
    emptyState.style.display = 'flex';
    if (projectIndex !== null) {
      const project = state.projects[projectIndex];
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/>
        </svg>
        <p>Aucun terminal pour "${project?.name || 'ce projet'}"</p>
        <p class="hint">Cliquez sur "Claude" pour en creer un</p>
      `;
    } else {
      emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/>
        </svg>
        <p>Selectionnez un projet et cliquez sur "Claude"</p>
        <p class="hint">Le terminal s'ouvrira ici</p>
      `;
    }
    state.activeTerminal = null;
  } else {
    emptyState.style.display = 'none';

    // Si le terminal actif n'est plus visible, switcher vers le premier visible
    const activeTab = document.querySelector(`.terminal-tab[data-id="${state.activeTerminal}"]`);
    if (!activeTab || activeTab.style.display === 'none') {
      if (firstVisibleId) {
        setActiveTerminal(firstVisibleId);
      }
    }
  }
}

// ========== SHOW ALL TERMINALS ==========
document.getElementById('btn-show-all').onclick = () => {
  state.selectedProjectFilter = null;
  renderProjects();
  filterTerminalsByProject(null);
};

// ========== NEW PROJECT ==========
document.getElementById('btn-new-project').onclick = () => {
  showModal('Nouveau Projet', `
    <form id="form-project">
      <div class="form-group">
        <label>Nom du projet</label>
        <input type="text" id="inp-name" placeholder="Mon Projet" required>
      </div>
      <div class="form-group">
        <label>Chemin du projet</label>
        <div class="input-with-btn">
          <input type="text" id="inp-path" placeholder="C:\\chemin\\projet" required>
          <button type="button" class="btn-browse" id="btn-browse">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
          </button>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-primary">Creer</button>
      </div>
    </form>
  `);

  document.getElementById('btn-browse').onclick = async () => {
    const folder = await ipcRenderer.invoke('select-folder');
    if (folder) {
      document.getElementById('inp-path').value = folder;
      if (!document.getElementById('inp-name').value) {
        document.getElementById('inp-name').value = path.basename(folder);
      }
    }
  };

  document.getElementById('form-project').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('inp-name').value.trim();
    const projPath = document.getElementById('inp-path').value.trim();
    if (name && projPath) {
      state.projects.push({ name, path: projPath });
      saveProjects();
      renderProjects();
      closeModal();
    }
  };
};

// ========== SKILLS ==========
function renderSkills() {
  const list = document.getElementById('skills-list');
  if (state.skills.length === 0) {
    list.innerHTML = `
      <div class="empty-list">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        <h3>Aucun skill</h3>
        <p>Creez votre premier skill</p>
      </div>`;
    return;
  }

  list.innerHTML = state.skills.map(s => `
    <div class="list-card" data-id="${s.id}" data-path="${s.path.replace(/"/g, '&quot;')}">
      <div class="list-card-header">
        <div class="list-card-title">${s.name}</div>
        <div class="list-card-badge">Skill</div>
      </div>
      <div class="list-card-desc">${s.description}</div>
      <div class="list-card-footer">
        <button class="btn-sm btn-secondary btn-open">Ouvrir</button>
        <button class="btn-sm btn-delete btn-del">Suppr</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.list-card').forEach(card => {
    card.querySelector('.btn-open').onclick = () => ipcRenderer.send('open-in-explorer', card.dataset.path);
    card.querySelector('.btn-del').onclick = () => {
      if (confirm('Supprimer ce skill ?')) {
        fs.rmSync(card.dataset.path, { recursive: true, force: true });
        loadSkills();
      }
    };
  });
}

document.getElementById('btn-new-skill').onclick = () => {
  showModal('Nouveau Skill', `
    <form id="form-skill">
      <div class="form-group">
        <label>Nom (sans espaces)</label>
        <input type="text" id="inp-skill-name" placeholder="mon-skill" pattern="[a-z0-9-]+" required>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="inp-skill-desc" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-primary">Creer</button>
      </div>
    </form>
  `);

  document.getElementById('form-skill').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('inp-skill-name').value.trim().toLowerCase();
    const desc = document.getElementById('inp-skill-desc').value.trim();
    if (name) {
      const skillPath = path.join(skillsDir, name);
      if (!fs.existsSync(skillPath)) {
        fs.mkdirSync(skillPath, { recursive: true });
        fs.writeFileSync(path.join(skillPath, 'SKILL.md'), `# ${name}\n\n${desc || 'Description'}\n\n## Instructions\n\nAjoutez vos instructions ici.\n`);
        loadSkills();
        closeModal();
      } else {
        alert('Ce skill existe deja');
      }
    }
  };
};

// ========== AGENTS ==========
function renderAgents() {
  const list = document.getElementById('agents-list');
  if (state.agents.length === 0) {
    list.innerHTML = `
      <div class="empty-list">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        <h3>Aucun agent</h3>
        <p>Creez votre premier agent</p>
      </div>`;
    return;
  }

  list.innerHTML = state.agents.map(a => `
    <div class="list-card" data-id="${a.id}" data-path="${a.path.replace(/"/g, '&quot;')}">
      <div class="list-card-header">
        <div class="list-card-title">${a.name}</div>
        <div class="list-card-badge agent">Agent</div>
      </div>
      <div class="list-card-desc">${a.description}</div>
      <div class="list-card-footer">
        <button class="btn-sm btn-secondary btn-open">Ouvrir</button>
        <button class="btn-sm btn-delete btn-del">Suppr</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.list-card').forEach(card => {
    card.querySelector('.btn-open').onclick = () => ipcRenderer.send('open-in-explorer', card.dataset.path);
    card.querySelector('.btn-del').onclick = () => {
      if (confirm('Supprimer cet agent ?')) {
        fs.rmSync(card.dataset.path, { recursive: true, force: true });
        loadAgents();
      }
    };
  });
}

document.getElementById('btn-new-agent').onclick = () => {
  showModal('Nouvel Agent', `
    <form id="form-agent">
      <div class="form-group">
        <label>Nom (sans espaces)</label>
        <input type="text" id="inp-agent-name" placeholder="mon-agent" pattern="[a-z0-9-]+" required>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="inp-agent-desc" rows="3"></textarea>
      </div>
      <div class="form-group">
        <label>Outils (separes par virgules)</label>
        <input type="text" id="inp-agent-tools" placeholder="Read, Grep, Glob">
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-primary">Creer</button>
      </div>
    </form>
  `);

  document.getElementById('form-agent').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('inp-agent-name').value.trim().toLowerCase();
    const desc = document.getElementById('inp-agent-desc').value.trim();
    const tools = document.getElementById('inp-agent-tools').value.trim() || 'Read, Grep, Glob';
    if (name) {
      const agentPath = path.join(agentsDir, name);
      if (!fs.existsSync(agentPath)) {
        fs.mkdirSync(agentPath, { recursive: true });
        fs.writeFileSync(path.join(agentPath, 'AGENT.md'), `# ${name}\n\ndescription: "${desc || "Agent personnalise"}"\ntools: [${tools}]\n\n## Instructions\n\nAjoutez vos instructions ici.\n`);
        loadAgents();
        closeModal();
      } else {
        alert('Cet agent existe deja');
      }
    }
  };
};

// ========== MCP ==========
function loadMcps() {
  try {
    if (fs.existsSync(mcpsFile)) {
      state.mcps = JSON.parse(fs.readFileSync(mcpsFile, 'utf8'));
    } else {
      state.mcps = [];
    }
  } catch (e) {
    state.mcps = [];
  }
  // Initialiser les états des processus
  state.mcps.forEach(mcp => {
    if (!state.mcpProcesses[mcp.id]) {
      state.mcpProcesses[mcp.id] = { status: 'stopped', logs: [] };
    }
  });
  renderMcps();
}

function saveMcps() {
  fs.writeFileSync(mcpsFile, JSON.stringify(state.mcps, null, 2));
}

function renderMcps() {
  const list = document.getElementById('mcp-list');
  if (state.mcps.length === 0) {
    list.innerHTML = `
      <div class="empty-list">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 16l-4-4V8.82C14.16 8.4 15 7.3 15 6c0-1.66-1.34-3-3-3S9 4.34 9 6c0 1.3.84 2.4 2 2.82V12l-4 4H3v5h5v-3.05l4-4.2 4 4.2V21h5v-5h-4z"/></svg>
        <h3>Aucun serveur MCP</h3>
        <p>Ajoutez un serveur MCP pour commencer</p>
      </div>`;
    return;
  }

  list.innerHTML = state.mcps.map(mcp => {
    const process = state.mcpProcesses[mcp.id] || { status: 'stopped', logs: [] };
    const isRunning = process.status === 'running';
    const isSelected = state.selectedMcp === mcp.id;
    return `
    <div class="mcp-card ${isSelected ? 'selected' : ''}" data-id="${mcp.id}">
      <div class="mcp-card-header">
        <div class="mcp-card-info">
          <span class="mcp-status-badge ${process.status}">${process.status === 'running' ? 'Running' : 'Stopped'}</span>
          <div class="mcp-card-title">${escapeHtml(mcp.name)}</div>
        </div>
        <div class="mcp-card-actions">
          ${isRunning ? `
            <button class="btn-mcp btn-stop" data-id="${mcp.id}" title="Arreter">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
            </button>
          ` : `
            <button class="btn-mcp btn-start" data-id="${mcp.id}" title="Demarrer">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          `}
          <button class="btn-mcp btn-logs" data-id="${mcp.id}" title="Voir les logs">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
          </button>
          <button class="btn-mcp btn-edit" data-id="${mcp.id}" title="Modifier">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="btn-mcp btn-delete" data-id="${mcp.id}" title="Supprimer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
      <div class="mcp-card-details">
        <div class="mcp-detail">
          <span class="mcp-detail-label">Commande:</span>
          <code>${escapeHtml(mcp.command)} ${(mcp.args || []).map(a => escapeHtml(a)).join(' ')}</code>
        </div>
        ${mcp.env && Object.keys(mcp.env).length > 0 ? `
          <div class="mcp-detail">
            <span class="mcp-detail-label">Env:</span>
            <code>${Object.entries(mcp.env).map(([k, v]) => `${k}=${v}`).join(', ')}</code>
          </div>
        ` : ''}
      </div>
    </div>
  `}).join('');

  // Event handlers
  list.querySelectorAll('.btn-start').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      startMcp(btn.dataset.id);
    };
  });

  list.querySelectorAll('.btn-stop').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      stopMcp(btn.dataset.id);
    };
  });

  list.querySelectorAll('.btn-logs').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectMcpForLogs(btn.dataset.id);
    };
  });

  list.querySelectorAll('.btn-edit').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      editMcp(btn.dataset.id);
    };
  });

  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteMcp(btn.dataset.id);
    };
  });

  list.querySelectorAll('.mcp-card').forEach(card => {
    card.onclick = () => selectMcpForLogs(card.dataset.id);
  });
}

function selectMcpForLogs(id) {
  state.selectedMcp = id;
  renderMcps();
  renderMcpLogs();

  // Expand logs panel if collapsed
  if (state.mcpLogsCollapsed) {
    toggleMcpLogsPanel();
  }
}

function renderMcpLogs() {
  const logsName = document.getElementById('mcp-logs-name');
  const logsContent = document.getElementById('mcp-logs-content');

  if (!state.selectedMcp) {
    logsName.textContent = '';
    logsContent.innerHTML = '<div class="mcp-logs-empty">Selectionnez un MCP pour voir ses logs</div>';
    return;
  }

  const mcp = state.mcps.find(m => m.id === state.selectedMcp);
  const process = state.mcpProcesses[state.selectedMcp] || { status: 'stopped', logs: [] };

  logsName.textContent = mcp ? `- ${mcp.name}` : '';

  if (process.logs.length === 0) {
    logsContent.innerHTML = '<div class="mcp-logs-empty">Aucun log disponible</div>';
    return;
  }

  logsContent.innerHTML = process.logs.map(log => {
    const typeClass = log.type === 'stderr' ? 'log-error' : 'log-stdout';
    return `<div class="mcp-log-line ${typeClass}">${escapeHtml(log.text)}</div>`;
  }).join('');

  // Scroll to bottom
  logsContent.scrollTop = logsContent.scrollHeight;
}

function appendMcpLog(id, type, text) {
  if (!state.mcpProcesses[id]) {
    state.mcpProcesses[id] = { status: 'stopped', logs: [] };
  }

  // Split by lines and add each
  text.split('\n').forEach(line => {
    if (line.trim()) {
      state.mcpProcesses[id].logs.push({ type, text: line, time: new Date() });
    }
  });

  // Keep only last 1000 lines
  if (state.mcpProcesses[id].logs.length > 1000) {
    state.mcpProcesses[id].logs = state.mcpProcesses[id].logs.slice(-1000);
  }

  // Update display if this MCP is selected
  if (state.selectedMcp === id) {
    renderMcpLogs();
  }
}

async function startMcp(id) {
  const mcp = state.mcps.find(m => m.id === id);
  if (!mcp) return;

  // Clear previous logs
  if (state.mcpProcesses[id]) {
    state.mcpProcesses[id].logs = [];
  }

  appendMcpLog(id, 'stdout', `[System] Demarrage de ${mcp.name}...`);

  try {
    await ipcRenderer.invoke('mcp-start', {
      id: mcp.id,
      command: mcp.command,
      args: mcp.args || [],
      env: mcp.env || {}
    });

    state.mcpProcesses[id].status = 'running';
    renderMcps();
    selectMcpForLogs(id);
  } catch (err) {
    appendMcpLog(id, 'stderr', `[Error] ${err.message}`);
    state.mcpProcesses[id].status = 'stopped';
    renderMcps();
  }
}

async function stopMcp(id) {
  const mcp = state.mcps.find(m => m.id === id);
  if (!mcp) return;

  appendMcpLog(id, 'stdout', `[System] Arret de ${mcp.name}...`);

  try {
    await ipcRenderer.invoke('mcp-stop', { id });
    state.mcpProcesses[id].status = 'stopped';
    appendMcpLog(id, 'stdout', `[System] ${mcp.name} arrete`);
    renderMcps();
  } catch (err) {
    appendMcpLog(id, 'stderr', `[Error] ${err.message}`);
  }
}

function editMcp(id) {
  const mcp = state.mcps.find(m => m.id === id);
  if (!mcp) return;

  showMcpModal(mcp);
}

function deleteMcp(id) {
  const mcp = state.mcps.find(m => m.id === id);
  if (!mcp) return;

  if (!confirm(`Supprimer le MCP "${mcp.name}" ?`)) return;

  // Stop if running
  if (state.mcpProcesses[id]?.status === 'running') {
    stopMcp(id);
  }

  state.mcps = state.mcps.filter(m => m.id !== id);
  delete state.mcpProcesses[id];

  if (state.selectedMcp === id) {
    state.selectedMcp = null;
  }

  saveMcps();
  renderMcps();
  renderMcpLogs();
}

function showMcpModal(mcp = null) {
  const isEdit = mcp !== null;
  const title = isEdit ? 'Modifier le MCP' : 'Nouveau MCP';

  showModal(title, `
    <form id="form-mcp">
      <div class="form-group">
        <label>Nom</label>
        <input type="text" id="inp-mcp-name" placeholder="Chrome DevTools" value="${mcp?.name || ''}" required>
      </div>
      <div class="form-group">
        <label>Commande</label>
        <input type="text" id="inp-mcp-command" placeholder="npx" value="${mcp?.command || ''}" required>
      </div>
      <div class="form-group">
        <label>Arguments (un par ligne)</label>
        <textarea id="inp-mcp-args" rows="3" placeholder="@anthropic-ai/mcp-devtools">${(mcp?.args || []).join('\n')}</textarea>
      </div>
      <div class="form-group">
        <label>Variables d'environnement (KEY=value, un par ligne)</label>
        <textarea id="inp-mcp-env" rows="3" placeholder="HEADLESS=true">${mcp?.env ? Object.entries(mcp.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''}</textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-primary">${isEdit ? 'Enregistrer' : 'Creer'}</button>
      </div>
    </form>
  `);

  document.getElementById('form-mcp').onsubmit = (e) => {
    e.preventDefault();

    const name = document.getElementById('inp-mcp-name').value.trim();
    const command = document.getElementById('inp-mcp-command').value.trim();
    const argsText = document.getElementById('inp-mcp-args').value.trim();
    const envText = document.getElementById('inp-mcp-env').value.trim();

    if (!name || !command) return;

    // Parse args
    const args = argsText ? argsText.split('\n').map(a => a.trim()).filter(a => a) : [];

    // Parse env
    const env = {};
    if (envText) {
      envText.split('\n').forEach(line => {
        const idx = line.indexOf('=');
        if (idx > 0) {
          env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
        }
      });
    }

    if (isEdit) {
      // Update existing
      const idx = state.mcps.findIndex(m => m.id === mcp.id);
      if (idx >= 0) {
        state.mcps[idx] = { ...state.mcps[idx], name, command, args, env };
      }
    } else {
      // Create new
      const id = 'mcp-' + Date.now();
      state.mcps.push({ id, name, command, args, env });
      state.mcpProcesses[id] = { status: 'stopped', logs: [] };
    }

    saveMcps();
    renderMcps();
    closeModal();
  };
}

function toggleMcpLogsPanel() {
  state.mcpLogsCollapsed = !state.mcpLogsCollapsed;
  const panel = document.getElementById('mcp-logs-panel');
  const btn = document.getElementById('btn-toggle-logs');

  panel.classList.toggle('collapsed', state.mcpLogsCollapsed);
  btn.innerHTML = state.mcpLogsCollapsed
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
}

function clearMcpLogs() {
  if (state.selectedMcp && state.mcpProcesses[state.selectedMcp]) {
    state.mcpProcesses[state.selectedMcp].logs = [];
    renderMcpLogs();
  }
}

// MCP event handlers
document.getElementById('btn-new-mcp').onclick = () => showMcpModal();
document.getElementById('btn-toggle-logs').onclick = toggleMcpLogsPanel;
document.getElementById('btn-clear-logs').onclick = clearMcpLogs;

// Listen for MCP output from main process
ipcRenderer.on('mcp-output', (event, { id, type, data }) => {
  appendMcpLog(id, type, data);
});

// Listen for MCP exit
ipcRenderer.on('mcp-exit', (event, { id, code }) => {
  const mcp = state.mcps.find(m => m.id === id);
  if (state.mcpProcesses[id]) {
    state.mcpProcesses[id].status = 'stopped';
  }
  appendMcpLog(id, 'stdout', `[System] Process termine avec code ${code}`);
  renderMcps();
});

// ========== MODAL ==========
function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
  setTimeout(() => document.querySelector('#modal-body input')?.focus(), 100);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-overlay').onclick = (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
};
document.onkeydown = (e) => {
  if (e.key === 'Escape') closeModal();
};

// Ctrl + Arrow shortcuts (capture phase to work even when terminal has focus)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    // Ctrl + Up/Down: switch projects
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (state.projects.length === 0) return;

      let newIndex;
      if (state.activeProject === null) {
        newIndex = e.key === 'ArrowDown' ? 0 : state.projects.length - 1;
      } else {
        if (e.key === 'ArrowDown') {
          newIndex = (state.activeProject + 1) % state.projects.length;
        } else {
          newIndex = (state.activeProject - 1 + state.projects.length) % state.projects.length;
        }
      }
      state.activeProject = newIndex;
      renderProjects();

      // Scroll to selected project
      const projectItem = document.querySelector(`.project-item[data-index="${newIndex}"]`);
      if (projectItem) projectItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Ctrl + Left/Right: switch terminals
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      const terminalIds = Array.from(state.terminals.keys());
      if (terminalIds.length === 0) return;

      const currentIndex = terminalIds.indexOf(state.activeTerminal);
      let newIndex;

      if (currentIndex === -1) {
        newIndex = e.key === 'ArrowRight' ? 0 : terminalIds.length - 1;
      } else {
        if (e.key === 'ArrowRight') {
          newIndex = (currentIndex + 1) % terminalIds.length;
        } else {
          newIndex = (currentIndex - 1 + terminalIds.length) % terminalIds.length;
        }
      }

      setActiveTerminal(terminalIds[newIndex]);

      // Make sure we're on the Claude tab
      document.querySelector('[data-tab="claude"]').click();
    }
  }
}, true); // true = capture phase

window.closeModal = closeModal;

// ========== QUICK PICKER ==========
function openQuickPicker() {
  quickPicker.isOpen = true;
  quickPicker.selectedIndex = 0;
  quickPicker.filteredProjects = [...state.projects];

  document.getElementById('quick-picker-overlay').classList.add('active');
  const input = document.getElementById('quick-picker-input');
  input.value = '';
  input.focus();

  renderQuickPickerList();
}

function closeQuickPicker() {
  quickPicker.isOpen = false;
  document.getElementById('quick-picker-overlay').classList.remove('active');
  document.getElementById('quick-picker-input').value = '';
}

function renderQuickPickerList() {
  const list = document.getElementById('quick-picker-list');

  if (quickPicker.filteredProjects.length === 0) {
    list.innerHTML = `
      <div class="quick-picker-empty">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
        <p>Aucun projet trouve</p>
      </div>`;
    return;
  }

  list.innerHTML = quickPicker.filteredProjects.map((p, i) => `
    <div class="quick-picker-item ${i === quickPicker.selectedIndex ? 'selected' : ''}" data-index="${i}">
      <div class="quick-picker-item-icon">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>
      </div>
      <div class="quick-picker-item-info">
        <div class="quick-picker-item-name">${p.name}</div>
        <div class="quick-picker-item-path">${p.path}</div>
      </div>
      <div class="quick-picker-item-actions">
        <button class="quick-picker-action action-folder" title="Ouvrir le dossier" data-action="folder" data-index="${i}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7l2 2h5v12zm0-12h-5l-2-2H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2z"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  // Event handlers
  list.querySelectorAll('.quick-picker-item').forEach(item => {
    item.onclick = (e) => {
      if (e.target.closest('.quick-picker-action')) return;
      const index = parseInt(item.dataset.index);
      selectQuickPickerProject(index);
    };
  });

  list.querySelectorAll('.quick-picker-action[data-action="folder"]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      ipcRenderer.send('open-in-explorer', quickPicker.filteredProjects[index].path);
    };
  });
}

function filterQuickPicker(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    quickPicker.filteredProjects = [...state.projects];
  } else {
    quickPicker.filteredProjects = state.projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q)
    );
  }
  quickPicker.selectedIndex = 0;
  renderQuickPickerList();
}

async function selectQuickPickerProject(index) {
  const project = quickPicker.filteredProjects[index];
  if (!project) return;

  closeQuickPicker();

  // Creer le terminal Claude
  createTerminal(project);

  // Switch vers l'onglet Claude
  document.querySelector('[data-tab="claude"]').click();
}

// Quick picker input handling
document.getElementById('quick-picker-input').addEventListener('input', (e) => {
  filterQuickPicker(e.target.value);
});

// Quick picker keyboard navigation
document.getElementById('quick-picker-input').addEventListener('keydown', (e) => {
  if (!quickPicker.isOpen) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      quickPicker.selectedIndex = Math.min(
        quickPicker.selectedIndex + 1,
        quickPicker.filteredProjects.length - 1
      );
      renderQuickPickerList();
      scrollToSelected();
      break;

    case 'ArrowUp':
      e.preventDefault();
      quickPicker.selectedIndex = Math.max(quickPicker.selectedIndex - 1, 0);
      renderQuickPickerList();
      scrollToSelected();
      break;

    case 'Enter':
      e.preventDefault();
      if (quickPicker.filteredProjects.length > 0) {
        selectQuickPickerProject(quickPicker.selectedIndex);
      }
      break;

    case 'Escape':
      e.preventDefault();
      closeQuickPicker();
      break;
  }
});

function scrollToSelected() {
  const selected = document.querySelector('.quick-picker-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Close quick picker on overlay click
document.getElementById('quick-picker-overlay').onclick = (e) => {
  if (e.target.id === 'quick-picker-overlay') {
    closeQuickPicker();
  }
};

// Listen for project selection from quick picker window
ipcRenderer.on('open-project', (event, project) => {
  createTerminal(project);
  document.querySelector('[data-tab="claude"]').click();
});

// ========== DASHBOARD ==========
let currentDashboardProject = null;

function populateDashboardProjects() {
  const select = document.getElementById('dashboard-project');
  select.innerHTML = '<option value="">Selectionnez un projet</option>';
  state.projects.forEach((p, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = p.name;
    select.appendChild(option);
  });
}

document.getElementById('dashboard-project').onchange = async (e) => {
  const index = e.target.value;
  if (index === '') {
    currentDashboardProject = null;
    document.getElementById('dashboard-content').innerHTML = `
      <div class="dashboard-empty">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        <p>Selectionnez un projet pour voir son dashboard</p>
      </div>`;
    return;
  }
  currentDashboardProject = state.projects[parseInt(index)];
  await loadDashboard();
};

document.getElementById('btn-refresh-dashboard').onclick = async () => {
  if (currentDashboardProject) {
    await loadDashboard();
  }
};

async function loadDashboard() {
  if (!currentDashboardProject) return;

  const content = document.getElementById('dashboard-content');
  content.innerHTML = `
    <div class="dashboard-loading">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>
    </div>`;

  const projectPath = currentDashboardProject.path;

  // Charger toutes les infos en parallele
  const [gitInfo, todos, stats] = await Promise.all([
    ipcRenderer.invoke('git-info', projectPath),
    ipcRenderer.invoke('scan-todos', projectPath),
    ipcRenderer.invoke('project-stats', projectPath)
  ]);

  renderDashboard(gitInfo, todos, stats);
}

function renderDashboard(gitInfo, todos, stats) {
  const content = document.getElementById('dashboard-content');

  content.innerHTML = `
    <div class="dashboard-grid">
      <!-- Git Branch & Info -->
      <div class="dashboard-card">
        <div class="dashboard-card-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3v12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2v-1h4v1c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2V3h-2v12H8V3H6zm12 0v9h-2V3h2z"/></svg>
          <h3>Git</h3>
        </div>
        <div class="dashboard-card-content">
          ${gitInfo.isGitRepo ? `
            <div class="git-info">
              <div class="git-info-row">
                <span class="git-info-label">Branche</span>
                <span class="git-branch">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3v12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2v-1h4v1c0 1.1.9 2 2 2s2-.9 2-2-.9-2-2-2V3h-2v12H8V3H6z"/></svg>
                  ${gitInfo.branch}
                </span>
              </div>
            </div>
          ` : `
            <div class="status-empty">Pas un repo Git</div>
          `}
        </div>
      </div>

      <!-- Last Commit -->
      <div class="dashboard-card">
        <div class="dashboard-card-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
          <h3>Dernier Commit</h3>
        </div>
        <div class="dashboard-card-content">
          ${gitInfo.commit ? `
            <div class="commit-info">
              <div class="commit-message">${escapeHtml(gitInfo.commit.message)}</div>
              <div class="commit-meta">
                <span>${gitInfo.commit.hash}</span>
                <span>${gitInfo.commit.author}</span>
                <span>${gitInfo.commit.date}</span>
              </div>
            </div>
          ` : `
            <div class="status-empty">Aucun commit</div>
          `}
        </div>
      </div>

      <!-- Changed Files -->
      <div class="dashboard-card">
        <div class="dashboard-card-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
          <h3>Fichiers Modifies</h3>
        </div>
        <div class="dashboard-card-content">
          ${gitInfo.files && gitInfo.files.length > 0 ? `
            <div class="status-list">
              ${gitInfo.files.slice(0, 10).map(f => `
                <div class="status-item">
                  <span class="status-badge ${f.type}">${f.type}</span>
                  <span>${escapeHtml(f.file)}</span>
                </div>
              `).join('')}
              ${gitInfo.files.length > 10 ? `<div class="status-empty">+ ${gitInfo.files.length - 10} autres fichiers</div>` : ''}
            </div>
          ` : `
            <div class="status-empty">Aucune modification</div>
          `}
        </div>
      </div>

      <!-- Stats -->
      <div class="dashboard-card">
        <div class="dashboard-card-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
          <h3>Stats</h3>
        </div>
        <div class="dashboard-card-content">
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">${stats.files}</div>
              <div class="stat-label">Fichiers</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${formatNumber(stats.lines)}</div>
              <div class="stat-label">Lignes</div>
            </div>
          </div>
        </div>
      </div>

      <!-- TODOs -->
      <div class="dashboard-card" style="grid-column: span 2;">
        <div class="dashboard-card-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <h3>TODO / FIXME (${todos.length})</h3>
        </div>
        <div class="dashboard-card-content">
          ${todos.length > 0 ? `
            <div class="todo-list">
              ${todos.map(t => `
                <div class="todo-item ${t.type.toLowerCase()}">
                  <div class="todo-item-header">
                    <span class="todo-item-type ${t.type.toLowerCase()}">${t.type}</span>
                    <span class="todo-item-file">${escapeHtml(t.file)}:${t.line}</span>
                  </div>
                  <div class="todo-item-text">${escapeHtml(t.text)}</div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="status-empty">Aucun TODO/FIXME trouve</div>
          `}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ========== SETTINGS MODAL ==========
function showSettingsModal() {
  showModal('Parametres', `
    <div class="settings-section">
      <h4 class="settings-title">Raccourci Global</h4>
      <div style="text-align: center; padding: 16px 0;">
        <div style="display: inline-block; padding: 12px 24px; background: var(--bg-tertiary); border-radius: var(--radius); border: 1px solid var(--accent);">
          <span style="font-family: 'Cascadia Code', monospace; font-size: 16px; color: var(--accent); font-weight: 600;">
            Ctrl + Shift + P
          </span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 10px;">
          Ouvre le selecteur de projets depuis n'importe ou
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h4 class="settings-title">Options Claude</h4>
      <label class="toggle-option">
        <input type="checkbox" id="setting-skip-permissions" ${state.settings.skipPermissions ? 'checked' : ''}>
        <span class="toggle-slider"></span>
        <div class="toggle-content">
          <span class="toggle-label">Mode sans confirmation</span>
          <span class="toggle-desc">Lance Claude avec --dangerously-skip-permissions</span>
        </div>
      </label>
      <div class="settings-warning">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
        <span>Ce mode permet a Claude d'executer des commandes sans demander de confirmation. A utiliser avec precaution.</span>
      </div>
    </div>

    <div class="form-actions" style="justify-content: center;">
      <button type="button" class="btn-primary" onclick="closeModal()">Fermer</button>
    </div>
  `);

  // Event listener pour le toggle
  document.getElementById('setting-skip-permissions').onchange = (e) => {
    state.settings.skipPermissions = e.target.checked;
    saveSettings();
  };
}

// ========== INIT ==========
loadSettings();
loadProjects();
loadSkills();
loadAgents();
loadMcps();
