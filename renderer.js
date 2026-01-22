/**
 * Claude Terminal - Renderer Process
 * Main entry point - orchestrates all modules
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Import all modules from src/renderer
const {
  // Utils
  escapeHtml,
  applyAccentColor,
  ensureDirectories,
  dataDir,
  skillsDir,
  agentsDir,
  claudeSettingsFile,

  // State
  projectsState,
  terminalsState,
  settingsState,
  fivemState,
  contextMenuState,
  dragState,
  getFolder,
  getProject,
  getProjectIndex,
  loadProjects,
  saveProjects,
  loadSettings,
  saveSettings,
  createFolder,
  deleteFolder,
  renameFolder,
  setSelectedProjectFilter,
  generateProjectId,
  initializeState,

  // Services
  services: { DashboardService, FivemService },

  // UI Components
  ProjectList,
  TerminalManager,
  showContextMenu,
  hideContextMenu,

  // Features
  initKeyboardShortcuts,
  registerShortcut
} = require('./src/renderer');

// ========== LOCAL MODAL FUNCTIONS ==========
// These work with the existing HTML modal elements in index.html
function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// ========== LOCAL STATE ==========
const localState = {
  skills: [],
  agents: [],
  mcps: [],
  mcpProcesses: {},
  selectedMcp: null,
  mcpLogsCollapsed: false,
  notificationsEnabled: true,
  fivemServers: new Map(),
  gitOperations: new Map(),
  gitRepoStatus: new Map(),
  selectedDashboardProject: null
};

// ========== INITIALIZATION ==========
ensureDirectories();
loadSettings();
loadProjects();
applyAccentColor(settingsState.get().accentColor || '#d97706');

// ========== NOTIFICATIONS ==========
function showNotification(title, body, terminalId) {
  if (!localState.notificationsEnabled) return;
  if (document.hasFocus() && terminalsState.get().activeTerminal === terminalId) return;
  ipcRenderer.send('show-notification', { title, body, terminalId });
}

ipcRenderer.on('notification-clicked', (event, { terminalId }) => {
  if (terminalId) {
    TerminalManager.setActiveTerminal(terminalId);
    document.querySelector('[data-tab="claude"]')?.click();
  }
});

// ========== GIT STATUS ==========
async function checkAllProjectsGitStatus() {
  const projects = projectsState.get().projects;
  for (const project of projects) {
    try {
      const result = await ipcRenderer.invoke('git-status-quick', { projectPath: project.path });
      localState.gitRepoStatus.set(project.id, { isGitRepo: result.isGitRepo });
    } catch (e) {
      localState.gitRepoStatus.set(project.id, { isGitRepo: false });
    }
  }
  ProjectList.render();
}

// ========== GIT NOTIFICATIONS ==========
function showGitToast({ success, title, message, details = [], duration = 5000 }) {
  // Remove any existing toast
  const existingToast = document.querySelector('.git-toast');
  if (existingToast) {
    existingToast.classList.remove('visible');
    setTimeout(() => existingToast.remove(), 150);
  }

  const toast = document.createElement('div');
  toast.className = `git-toast ${success ? 'git-toast-success' : 'git-toast-error'}`;

  // Icônes plus modernes
  const icon = success
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  // Truncate message if too long
  const displayMessage = message && message.length > 150 ? message.substring(0, 150) + '...' : message;

  // Build details HTML if provided
  let detailsHtml = '';
  if (details && details.length > 0) {
    detailsHtml = '<div class="git-toast-details">' +
      details.map(d => `<span class="git-toast-detail"><span class="git-toast-detail-icon">${d.icon || ''}</span>${escapeHtml(d.text)}</span>`).join('') +
      '</div>';
  }

  toast.innerHTML = `
    <span class="git-toast-icon">${icon}</span>
    <div class="git-toast-content">
      <div class="git-toast-title">${escapeHtml(title)}</div>
      ${displayMessage ? `<div class="git-toast-message">${escapeHtml(displayMessage)}</div>` : ''}
      ${detailsHtml}
    </div>
    <button class="git-toast-close" aria-label="Fermer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  // Progress bar for auto-hide
  if (duration > 0) {
    const progressBar = document.createElement('div');
    progressBar.className = 'git-toast-progress';
    progressBar.style.animationDuration = `${duration}ms`;
    toast.appendChild(progressBar);
  }

  document.body.appendChild(toast);

  // Close button handler
  toast.querySelector('.git-toast-close').onclick = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  };

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Auto hide
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return toast;

}

// Parse git output to extract useful info
function parseGitPullOutput(output) {
  const details = [];

  if (!output) return { message: 'Déjà à jour', details };

  // Already up to date
  if (output.includes('Already up to date') || output.includes('Déjà à jour')) {
    return { message: 'Déjà à jour', details: [{ icon: '✓', text: 'Aucune modification' }] };
  }

  // Fast-forward merge
  const filesChanged = output.match(/(\d+) files? changed/);
  const insertions = output.match(/(\d+) insertions?\(\+\)/);
  const deletions = output.match(/(\d+) deletions?\(-\)/);
  const commits = output.match(/(\d+) commits?/);

  if (filesChanged) {
    details.push({ icon: '📄', text: `${filesChanged[1]} fichier${filesChanged[1] > 1 ? 's' : ''} modifié${filesChanged[1] > 1 ? 's' : ''}` });
  }
  if (insertions) {
    details.push({ icon: '+', text: `${insertions[1]} insertion${insertions[1] > 1 ? 's' : ''}` });
  }
  if (deletions) {
    details.push({ icon: '-', text: `${deletions[1]} suppression${deletions[1] > 1 ? 's' : ''}` });
  }

  return { message: '', details };
}

function parseGitPushOutput(output) {
  const details = [];

  if (!output) return { message: 'Modifications envoyées', details };

  // Everything up-to-date
  if (output.includes('Everything up-to-date')) {
    return { message: 'Déjà synchronisé', details: [{ icon: '✓', text: 'Aucune modification à envoyer' }] };
  }

  // Extract branch info
  const branchMatch = output.match(/(\w+)\.\.(\w+)\s+(\S+)\s+->\s+(\S+)/);
  if (branchMatch) {
    details.push({ icon: '↑', text: `${branchMatch[3]} → ${branchMatch[4]}` });
  }

  return { message: 'Modifications envoyées', details };
}

// ========== GIT OPERATIONS ==========

// Refresh dashboard async (stale-while-revalidate pattern)
function refreshDashboardAsync(projectId) {
  const projects = projectsState.get().projects;
  const projectIndex = projects.findIndex(p => p.id === projectId);

  // Only refresh if dashboard tab is active and this project is selected
  const dashboardTab = document.querySelector('[data-tab="dashboard"]');
  const isDashboardActive = dashboardTab?.classList.contains('active');
  const isProjectSelected = localState.selectedDashboardProject === projectIndex;

  if (isDashboardActive && isProjectSelected && projectIndex !== -1) {
    // Invalidate cache to force refresh, but keep old data visible
    DashboardService.invalidateCache(projectId);

    // Re-render - will show old data immediately then update when new data loads
    const content = document.getElementById('dashboard-content');
    const project = projects[projectIndex];
    if (content && project) {
      const terminalCount = TerminalManager.countTerminalsForProject(projectIndex);
      const fivemStatus = localState.fivemServers.get(projectIndex)?.status || 'stopped';

      DashboardService.renderDashboard(content, project, {
        terminalCount,
        fivemStatus,
        onOpenFolder: (p) => ipcRenderer.send('open-in-explorer', p),
        onOpenClaude: (proj) => {
          createTerminalForProject(proj);
          document.querySelector('[data-tab="claude"]')?.click();
        },
        onGitPull: (pid) => gitPull(pid),
        onGitPush: (pid) => gitPush(pid),
        onCopyPath: () => {}
      });
    }
  }
}

async function gitPull(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pulling: true });
  ProjectList.render();
  try {
    const result = await ipcRenderer.invoke('git-pull', { projectPath: project.path });
    localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pulling: false, lastResult: result });
    ProjectList.render();

    if (result.success) {
      const parsed = parseGitPullOutput(result.output);
      showGitToast({
        success: true,
        title: 'Pull réussi',
        message: parsed.message,
        details: parsed.details,
        duration: 4000
      });

      // Refresh dashboard async - keep old data, load new in background
      refreshDashboardAsync(projectId);
    } else {
      showGitToast({
        success: false,
        title: 'Erreur lors du pull',
        message: result.error || 'Une erreur est survenue',
        duration: 6000
      });
    }
  } catch (e) {
    localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pulling: false });
    ProjectList.render();
    showGitToast({
      success: false,
      title: 'Erreur lors du pull',
      message: e.message || 'Une erreur est survenue',
      duration: 6000
    });
  }
}

async function gitPush(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pushing: true });
  ProjectList.render();
  try {
    const result = await ipcRenderer.invoke('git-push', { projectPath: project.path });
    localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pushing: false, lastResult: result });
    ProjectList.render();

    if (result.success) {
      const parsed = parseGitPushOutput(result.output);
      showGitToast({
        success: true,
        title: 'Push réussi',
        message: parsed.message,
        details: parsed.details,
        duration: 4000
      });

      // Refresh dashboard async - keep old data, load new in background
      refreshDashboardAsync(projectId);
    } else {
      showGitToast({
        success: false,
        title: 'Erreur lors du push',
        message: result.error || 'Une erreur est survenue',
        duration: 6000
      });
    }
  } catch (e) {
    localState.gitOperations.set(projectId, { ...localState.gitOperations.get(projectId), pushing: false });
    ProjectList.render();
    showGitToast({
      success: false,
      title: 'Erreur lors du push',
      message: e.message || 'Une erreur est survenue',
      duration: 6000
    });
  }
}

// ========== FIVEM ==========
async function startFivemServer(projectIndex) {
  const projects = projectsState.get().projects;
  const project = projects[projectIndex];
  if (!project) return;
  localState.fivemServers.set(projectIndex, { status: 'starting', logs: [] });
  ProjectList.render();
  try {
    await ipcRenderer.invoke('fivem-start', {
      projectIndex,
      projectPath: project.path,
      runCommand: project.fivemConfig?.runCommand || project.runCommand
    });
    localState.fivemServers.set(projectIndex, { status: 'running', logs: [] });
  } catch (e) {
    localState.fivemServers.set(projectIndex, { status: 'stopped', logs: [] });
  }
  ProjectList.render();
}

async function stopFivemServer(projectIndex) {
  await ipcRenderer.invoke('fivem-stop', { projectIndex });
  localState.fivemServers.set(projectIndex, { status: 'stopped', logs: localState.fivemServers.get(projectIndex)?.logs || [] });
  ProjectList.render();
}

function openFivemConsole(projectIndex) {
  const projects = projectsState.get().projects;
  const project = projects[projectIndex];
  if (!project) return;

  // Create FiveM console as a terminal tab (same location as other terminals)
  TerminalManager.createFivemConsole(project, projectIndex);
}

// Register FiveM listeners - write to TerminalManager's FiveM console
ipcRenderer.on('fivem-data', (event, { projectIndex, data }) => {
  // Update local state logs
  const server = localState.fivemServers.get(projectIndex) || { status: 'running', logs: [] };
  server.logs.push(data);
  if (server.logs.join('').length > 10000) server.logs = [server.logs.join('').slice(-10000)];
  localState.fivemServers.set(projectIndex, server);

  // Write to TerminalManager's FiveM console
  TerminalManager.writeFivemConsole(projectIndex, data);
});

ipcRenderer.on('fivem-exit', (event, { projectIndex, code }) => {
  localState.fivemServers.set(projectIndex, { status: 'stopped', logs: localState.fivemServers.get(projectIndex)?.logs || [] });

  // Write exit message to console
  TerminalManager.writeFivemConsole(projectIndex, `\r\n[Server exited with code ${code}]\r\n`);

  ProjectList.render();
});

// Legacy FiveM listeners via the service (kept for compatibility)
FivemService.registerFivemListeners(
  // onData callback - update local state
  (projectIndex, data) => {
    const server = localState.fivemServers.get(projectIndex) || { status: 'running', logs: [] };
    server.logs.push(data);
    if (server.logs.join('').length > 10000) server.logs = [server.logs.join('').slice(-10000)];
    localState.fivemServers.set(projectIndex, server);
  },
  // onExit callback - update status
  (projectIndex, code) => {
    localState.fivemServers.set(projectIndex, { status: 'stopped', logs: localState.fivemServers.get(projectIndex)?.logs || [] });
    ProjectList.render();
  }
);

// ========== DELETE PROJECT ==========
function deleteProjectUI(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  const projectIndex = getProjectIndex(projectId);
  if (!confirm(`Supprimer "${project.name}" ?`)) return;

  if (project.type === 'fivem' && localState.fivemServers.get(projectIndex)?.status !== 'stopped') {
    stopFivemServer(projectIndex);
  }

  const projects = projectsState.get().projects.filter(p => p.id !== projectId);
  let rootOrder = projectsState.get().rootOrder;
  if (project.folderId === null) {
    rootOrder = rootOrder.filter(id => id !== projectId);
  }

  projectsState.set({ projects, rootOrder });
  saveProjects();

  if (projectsState.get().selectedProjectFilter === projectIndex) {
    setSelectedProjectFilter(null);
  }
  ProjectList.render();
  TerminalManager.filterByProject(projectsState.get().selectedProjectFilter);
}

// ========== TERMINAL CREATION WRAPPER ==========
function createTerminalForProject(project) {
  TerminalManager.createTerminal(project, {
    skipPermissions: settingsState.get().skipPermissions
  });
}

function createBasicTerminalForProject(project) {
  TerminalManager.createTerminal(project, {
    runClaude: false
  });
}

// ========== SETUP COMPONENTS ==========
// Setup ProjectList
ProjectList.setExternalState({
  fivemServers: localState.fivemServers,
  gitOperations: localState.gitOperations,
  gitRepoStatus: localState.gitRepoStatus
});

ProjectList.setCallbacks({
  onCreateTerminal: createTerminalForProject,
  onCreateBasicTerminal: createBasicTerminalForProject,
  onStartFivem: startFivemServer,
  onStopFivem: stopFivemServer,
  onOpenFivemConsole: openFivemConsole,
  onGitPull: gitPull,
  onGitPush: gitPush,
  onDeleteProject: deleteProjectUI,
  onRenderProjects: () => ProjectList.render(),
  onFilterTerminals: (idx) => TerminalManager.filterByProject(idx),
  countTerminalsForProject: TerminalManager.countTerminalsForProject
});

// Setup TerminalManager
TerminalManager.setCallbacks({
  onNotification: showNotification,
  onRenderProjects: () => ProjectList.render()
});

// ========== WINDOW CONTROLS ==========
document.getElementById('btn-minimize').onclick = () => ipcRenderer.send('window-minimize');
document.getElementById('btn-maximize').onclick = () => ipcRenderer.send('window-maximize');
document.getElementById('btn-close').onclick = () => ipcRenderer.send('window-close');

document.getElementById('btn-notifications').onclick = () => {
  localState.notificationsEnabled = !localState.notificationsEnabled;
  document.getElementById('btn-notifications').classList.toggle('active', localState.notificationsEnabled);
  if (localState.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

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
    if (tabId === 'claude') {
      const activeId = terminalsState.get().activeTerminal;
      if (activeId) {
        const termData = terminalsState.get().terminals.get(activeId);
        if (termData) termData.fitAddon.fit();
      }
    }
  };
});

// ========== CONTEXT MENU ==========
function setupContextMenuHandlers() {
  const list = document.getElementById('projects-list');

  list.addEventListener('contextmenu', (e) => {
    const folderItem = e.target.closest('.folder-item');
    const projectItem = e.target.closest('.project-item');

    if (folderItem) {
      e.preventDefault();
      e.stopPropagation();
      showContextMenuForFolder(e.clientX, e.clientY, folderItem.dataset.folderId);
    } else if (projectItem) {
      e.preventDefault();
      e.stopPropagation();
      showContextMenuForProject(e.clientX, e.clientY, projectItem.dataset.projectId);
    } else if (e.target === list || e.target.classList.contains('drop-zone-root')) {
      e.preventDefault();
      showContextMenuEmpty(e.clientX, e.clientY);
    }
  });
}

function showContextMenuForFolder(x, y, folderId) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = `
    <div class="context-menu-item" data-action="new-subfolder">Nouveau sous-dossier</div>
    <div class="context-menu-item" data-action="rename">Renommer</div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">Supprimer le dossier</div>`;
  showContextMenuAt(menu, x, y, { type: 'folder', id: folderId });
}

function showContextMenuForProject(x, y, projectId) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = `
    <div class="context-menu-item" data-action="move-to-root">Deplacer a la racine</div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" data-action="delete">Supprimer</div>`;
  showContextMenuAt(menu, x, y, { type: 'project', id: projectId });
}

function showContextMenuEmpty(x, y) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = `
    <div class="context-menu-item" data-action="new-folder">Nouveau dossier</div>
    <div class="context-menu-item" data-action="new-project">Nouveau projet</div>`;
  showContextMenuAt(menu, x, y, { type: 'empty', id: null });
}

let contextTarget = null;
function showContextMenuAt(menu, x, y, target) {
  contextTarget = target;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('active');

  menu.querySelectorAll('.context-menu-item').forEach(item => {
    item.onclick = () => {
      handleContextAction(item.dataset.action);
      hideContextMenuUI();
    };
  });
}

function hideContextMenuUI() {
  document.getElementById('context-menu').classList.remove('active');
}

document.addEventListener('click', () => hideContextMenuUI());

async function handleContextAction(action) {
  if (!contextTarget) return;
  switch (action) {
    case 'new-folder': await promptCreateFolder(null); break;
    case 'new-subfolder': if (contextTarget.type === 'folder') await promptCreateFolder(contextTarget.id); break;
    case 'rename': if (contextTarget.type === 'folder') await promptRenameFolder(contextTarget.id); break;
    case 'delete':
      if (contextTarget.type === 'folder') {
        if (confirm('Supprimer ce dossier ? Les elements seront deplaces vers le parent.')) {
          deleteFolder(contextTarget.id);
          ProjectList.render();
        }
      } else if (contextTarget.type === 'project') {
        deleteProjectUI(contextTarget.id);
      }
      break;
    case 'move-to-root':
      if (contextTarget.type === 'project') {
        const { moveItemToFolder } = require('./src/renderer');
        moveItemToFolder('project', contextTarget.id, null);
        ProjectList.render();
      }
      break;
    case 'new-project': document.getElementById('btn-new-project').click(); break;
  }
}

// ========== INPUT MODAL ==========
function showInputModal(title, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('input-modal');
    const titleEl = document.getElementById('input-modal-title');
    const input = document.getElementById('input-modal-input');
    const confirmBtn = document.getElementById('input-modal-confirm');
    const cancelBtn = document.getElementById('input-modal-cancel');

    titleEl.textContent = title;
    input.value = defaultValue;
    modal.classList.add('active');
    input.focus();
    input.select();

    const cleanup = () => {
      modal.classList.remove('active');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };
    confirmBtn.onclick = () => { cleanup(); resolve(input.value); };
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { cleanup(); resolve(input.value); }
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    };
  });
}

async function promptCreateFolder(parentId) {
  const name = await showInputModal('Nom du dossier:');
  if (name && name.trim()) {
    createFolder(name.trim(), parentId);
    ProjectList.render();
  }
}

async function promptRenameFolder(folderId) {
  const folder = getFolder(folderId);
  if (!folder) return;
  const name = await showInputModal('Nouveau nom:', folder.name);
  if (name && name.trim()) {
    renameFolder(folderId, name.trim());
    ProjectList.render();
  }
}

// ========== SETTINGS MODAL ==========
function showSettingsModal() {
  const settings = settingsState.get();
  showModal('Parametres', `
    <div class="settings-form">
      <div class="settings-section">
        <div class="settings-title">Mode d'execution</div>
        <div class="execution-mode-selector">
          <div class="execution-mode-card ${!settings.skipPermissions ? 'selected' : ''}" data-mode="safe">
            <div class="execution-mode-icon safe">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
            </div>
            <div class="execution-mode-content">
              <div class="execution-mode-title">Mode securise</div>
              <div class="execution-mode-desc">Claude demande confirmation avant chaque action</div>
            </div>
            <div class="execution-mode-check"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
          </div>
          <div class="execution-mode-card ${settings.skipPermissions ? 'selected' : ''}" data-mode="dangerous">
            <div class="execution-mode-icon dangerous">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>
            </div>
            <div class="execution-mode-content">
              <div class="execution-mode-title">Mode autonome</div>
              <div class="execution-mode-desc">Claude execute les actions sans confirmation</div>
              <div class="execution-mode-flag">--dangerously-skip-permissions</div>
            </div>
            <div class="execution-mode-check"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
          </div>
        </div>
        <div class="settings-warning" id="dangerous-warning" style="display: ${settings.skipPermissions ? 'flex' : 'none'};">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>
          <span>Ce mode permet a Claude d'executer des commandes sans validation.</span>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-title">Couleur d'accent</div>
        <div class="color-picker">
          ${['#d97706', '#dc2626', '#db2777', '#9333ea', '#4f46e5', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#65a30d'].map(c =>
            `<button class="color-swatch ${settings.accentColor === c ? 'selected' : ''}" style="background:${c}" data-color="${c}"></button>`
          ).join('')}
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Fermer</button>
        <button type="button" class="btn-primary" id="btn-save-settings">Sauvegarder</button>
      </div>
    </div>
  `);

  document.querySelectorAll('.execution-mode-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.execution-mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.getElementById('dangerous-warning').style.display = card.dataset.mode === 'dangerous' ? 'flex' : 'none';
    };
  });

  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.onclick = () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    };
  });

  document.getElementById('btn-save-settings').onclick = () => {
    const selectedMode = document.querySelector('.execution-mode-card.selected');
    const newSettings = {
      editor: settings.editor || 'code',
      skipPermissions: selectedMode?.dataset.mode === 'dangerous',
      accentColor: document.querySelector('.color-swatch.selected')?.dataset.color || settings.accentColor
    };
    settingsState.set(newSettings);
    saveSettings();
    applyAccentColor(newSettings.accentColor);
    closeModal();
  };
}

window.closeModal = closeModal;
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };

// ========== SKILLS & AGENTS ==========
function loadSkills() {
  localState.skills = [];
  try {
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir).forEach(item => {
        const itemPath = path.join(skillsDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const skillFile = path.join(itemPath, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            const content = fs.readFileSync(skillFile, 'utf8');
            const parsed = parseSkillMd(content);
            localState.skills.push({
              id: item,
              name: parsed.name || item,
              description: parsed.description || 'Aucune description',
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) { console.error('Error loading skills:', e); }
  renderSkills();
}

/**
 * Parse a SKILL.md file to extract name and description
 * Supports formats:
 * - # Name\nDescription text
 * - # Name\n\nDescription text\n\n## Section
 * - YAML frontmatter with description field
 */
function parseSkillMd(content) {
  let name = null;
  let description = null;

  // Check for YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const descMatch = yaml.match(/description\s*:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1].trim();
    const nameMatch = yaml.match(/name\s*:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) name = nameMatch[1].trim();
  }

  // Get title from first # heading
  const titleMatch = content.match(/^#\s+(.+)/m);
  if (titleMatch && !name) {
    name = titleMatch[1].trim();
  }

  // Get description: text between title and first ## or end of intro
  if (!description) {
    // Remove YAML frontmatter if present
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

    // Find content after the first # heading
    const afterTitle = body.replace(/^#\s+.+\n/, '');

    // Get text until next ## heading or significant section
    const untilNextSection = afterTitle.split(/\n##\s/)[0];

    // Get first non-empty paragraph
    const paragraphs = untilNextSection.split(/\n\n+/);
    for (const p of paragraphs) {
      const cleaned = p.trim();
      // Skip empty, headers, or very short lines
      if (cleaned && !cleaned.startsWith('#') && !cleaned.startsWith('```') && cleaned.length > 10) {
        // Take first line if multi-line paragraph
        description = cleaned.split('\n')[0].trim();
        break;
      }
    }
  }

  return { name, description };
}

function loadAgents() {
  localState.agents = [];
  try {
    if (fs.existsSync(agentsDir)) {
      fs.readdirSync(agentsDir).forEach(item => {
        const itemPath = path.join(agentsDir, item);
        const stat = fs.statSync(itemPath);

        // Handle .md files directly in agents directory (new format)
        if (stat.isFile() && item.endsWith('.md')) {
          const content = fs.readFileSync(itemPath, 'utf8');
          const parsed = parseAgentMd(content);
          const id = item.replace(/\.md$/, '');
          localState.agents.push({
            id,
            name: parsed.name || id,
            description: parsed.description || 'Aucune description',
            tools: parsed.tools || [],
            path: itemPath
          });
        }
        // Handle subdirectories with AGENT.md (legacy format)
        else if (stat.isDirectory()) {
          const agentFile = path.join(itemPath, 'AGENT.md');
          if (fs.existsSync(agentFile)) {
            const content = fs.readFileSync(agentFile, 'utf8');
            const parsed = parseAgentMd(content);
            localState.agents.push({
              id: item,
              name: parsed.name || item,
              description: parsed.description || 'Aucune description',
              tools: parsed.tools || [],
              path: itemPath
            });
          }
        }
      });
    }
  } catch (e) { console.error('Error loading agents:', e); }
  renderAgents();
}

/**
 * Parse an AGENT.md file to extract name, description and tools
 * Supports formats:
 * - # Name\ndescription: "..."\ntools: [...]
 * - YAML frontmatter
 * - # Name\n\nDescription paragraph
 */
function parseAgentMd(content) {
  let name = null;
  let description = null;
  let tools = [];

  // Check for YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const descMatch = yaml.match(/description\s*:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) description = descMatch[1].trim();
    const nameMatch = yaml.match(/name\s*:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) name = nameMatch[1].trim();
    const toolsMatch = yaml.match(/tools\s*:\s*\[([^\]]+)\]/);
    if (toolsMatch) tools = toolsMatch[1].split(',').map(t => t.trim().replace(/["']/g, ''));
  }

  // Get title from first # heading
  const titleMatch = content.match(/^#\s+(.+)/m);
  if (titleMatch && !name) {
    name = titleMatch[1].trim();
  }

  // Try to find description in body (key: value format)
  if (!description) {
    const descInBody = content.match(/description\s*:\s*["']([^"']+)["']/i) ||
                       content.match(/description\s*:\s*(.+)$/im);
    if (descInBody) {
      description = descInBody[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  // Try to find tools in body
  if (tools.length === 0) {
    const toolsInBody = content.match(/tools\s*:\s*\[([^\]]+)\]/i);
    if (toolsInBody) {
      tools = toolsInBody[1].split(',').map(t => t.trim().replace(/["']/g, ''));
    }
  }

  // Fallback: get description from first paragraph after title
  if (!description) {
    let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const afterTitle = body.replace(/^#\s+.+\n/, '');
    const untilNextSection = afterTitle.split(/\n##\s/)[0];

    // Skip lines that look like metadata (key: value)
    const paragraphs = untilNextSection.split(/\n\n+/);
    for (const p of paragraphs) {
      const cleaned = p.trim();
      if (cleaned &&
          !cleaned.startsWith('#') &&
          !cleaned.startsWith('```') &&
          !cleaned.match(/^\w+\s*:/) && // Skip key: value lines
          cleaned.length > 10) {
        description = cleaned.split('\n')[0].trim();
        break;
      }
    }
  }

  return { name, description, tools };
}

function renderSkills() {
  const list = document.getElementById('skills-list');
  if (localState.skills.length === 0) {
    list.innerHTML = `<div class="empty-list"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg><h3>Aucun skill</h3><p>Creez votre premier skill</p></div>`;
    return;
  }
  list.innerHTML = localState.skills.map(s => `
    <div class="list-card" data-path="${s.path.replace(/"/g, '&quot;')}">
      <div class="list-card-header"><div class="list-card-title">${escapeHtml(s.name)}</div><div class="list-card-badge">Skill</div></div>
      <div class="list-card-desc">${escapeHtml(s.description)}</div>
      <div class="list-card-footer">
        <button class="btn-sm btn-secondary btn-open">Ouvrir</button>
        <button class="btn-sm btn-delete btn-del">Suppr</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.list-card').forEach(card => {
    card.querySelector('.btn-open').onclick = () => ipcRenderer.send('open-in-explorer', card.dataset.path);
    card.querySelector('.btn-del').onclick = () => { if (confirm('Supprimer ce skill ?')) { fs.rmSync(card.dataset.path, { recursive: true, force: true }); loadSkills(); } };
  });
}

function renderAgents() {
  const list = document.getElementById('agents-list');
  if (localState.agents.length === 0) {
    list.innerHTML = `<div class="empty-list"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8 17.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM9.5 8c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5S9.5 9.38 9.5 8zm6.5 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg><h3>Aucun agent</h3><p>Creez votre premier agent</p></div>`;
    return;
  }
  list.innerHTML = localState.agents.map(a => `
    <div class="list-card" data-path="${a.path.replace(/"/g, '&quot;')}">
      <div class="list-card-header"><div class="list-card-title">${escapeHtml(a.name)}</div><div class="list-card-badge agent">Agent</div></div>
      <div class="list-card-desc">${escapeHtml(a.description)}</div>
      <div class="list-card-footer">
        <button class="btn-sm btn-secondary btn-open">Ouvrir</button>
        <button class="btn-sm btn-delete btn-del">Suppr</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.list-card').forEach(card => {
    card.querySelector('.btn-open').onclick = () => ipcRenderer.send('open-in-explorer', card.dataset.path);
    card.querySelector('.btn-del').onclick = () => { if (confirm('Supprimer cet agent ?')) { fs.rmSync(card.dataset.path, { recursive: true, force: true }); loadAgents(); } };
  });
}

// ========== MCP ==========
function loadMcps() {
  localState.mcps = [];

  // Load global MCPs from ~/.claude/settings.json
  try {
    if (fs.existsSync(claudeSettingsFile)) {
      const settings = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
      if (settings.mcpServers) {
        Object.entries(settings.mcpServers).forEach(([name, config]) => {
          localState.mcps.push({
            id: `global-${name}`,
            name,
            command: config.command || '',
            args: config.args || [],
            env: config.env || {},
            source: 'global',
            sourceLabel: 'Global'
          });
        });
      }
    }
  } catch (e) { console.error('Error loading global MCPs:', e); }

  // Load project-specific MCPs from each project's .claude/settings.local.json
  const projects = projectsState.get().projects;
  projects.forEach(project => {
    try {
      const projectMcpFile = path.join(project.path, '.claude', 'settings.local.json');
      if (fs.existsSync(projectMcpFile)) {
        const projectSettings = JSON.parse(fs.readFileSync(projectMcpFile, 'utf8'));
        if (projectSettings.mcpServers) {
          Object.entries(projectSettings.mcpServers).forEach(([name, config]) => {
            // Avoid duplicates if same MCP exists globally
            const existingGlobal = localState.mcps.find(m => m.name === name && m.source === 'global');
            if (!existingGlobal) {
              localState.mcps.push({
                id: `project-${project.id}-${name}`,
                name,
                command: config.command || '',
                args: config.args || [],
                env: config.env || {},
                source: 'project',
                sourceLabel: project.name,
                projectId: project.id
              });
            }
          });
        }
      }
    } catch (e) { /* ignore project-specific errors */ }
  });

  // Initialize process tracking
  localState.mcps.forEach(mcp => {
    if (!localState.mcpProcesses[mcp.id]) {
      localState.mcpProcesses[mcp.id] = { status: 'stopped', logs: [] };
    }
  });

  renderMcps();
}

function renderMcps() {
  const list = document.getElementById('mcp-list');
  if (localState.mcps.length === 0) {
    list.innerHTML = `<div class="empty-list"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 16l-4-4V8.82C14.16 8.4 15 7.3 15 6c0-1.66-1.34-3-3-3S9 4.34 9 6c0 1.3.84 2.4 2 2.82V12l-4 4H3v5h5v-3.05l4-4.2 4 4.2V21h5v-5h-4z"/></svg><h3>Aucun serveur MCP</h3><p>Configurez des MCPs dans ~/.claude/settings.json</p></div>`;
    return;
  }

  // Group by source
  const globalMcps = localState.mcps.filter(m => m.source === 'global');
  const projectMcps = localState.mcps.filter(m => m.source === 'project');

  let html = '';

  if (globalMcps.length > 0) {
    html += `<div class="mcp-section"><div class="mcp-section-title">Global</div>`;
    html += globalMcps.map(mcp => renderMcpCard(mcp)).join('');
    html += `</div>`;
  }

  if (projectMcps.length > 0) {
    // Group project MCPs by project
    const byProject = {};
    projectMcps.forEach(mcp => {
      if (!byProject[mcp.sourceLabel]) byProject[mcp.sourceLabel] = [];
      byProject[mcp.sourceLabel].push(mcp);
    });

    Object.entries(byProject).forEach(([projectName, mcps]) => {
      html += `<div class="mcp-section"><div class="mcp-section-title">${escapeHtml(projectName)}</div>`;
      html += mcps.map(mcp => renderMcpCard(mcp)).join('');
      html += `</div>`;
    });
  }

  list.innerHTML = html;
}

function renderMcpCard(mcp) {
  const process = localState.mcpProcesses[mcp.id] || { status: 'stopped' };
  const statusLabel = process.status === 'running' ? 'Actif' : process.status === 'starting' ? 'Demarrage...' : 'Inactif';
  return `<div class="mcp-card" data-id="${mcp.id}">
    <div class="mcp-card-header">
      <div class="mcp-card-info">
        <span class="mcp-status-badge ${process.status}">${statusLabel}</span>
        <div class="mcp-card-title">${escapeHtml(mcp.name)}</div>
      </div>
    </div>
    <div class="mcp-card-details"><code>${escapeHtml(mcp.command)}${mcp.args?.length ? ' ' + mcp.args.join(' ') : ''}</code></div>
  </div>`;
}

// ========== DASHBOARD ==========
function populateDashboardProjects() {
  const list = document.getElementById('dashboard-projects-list');
  if (!list) return;
  const projects = projectsState.get().projects;

  if (projects.length === 0) {
    list.innerHTML = `<div class="dashboard-projects-empty">Aucun projet</div>`;
    return;
  }

  list.innerHTML = projects.map((p, i) => `
    <div class="dashboard-project-item ${localState.selectedDashboardProject === i ? 'active' : ''}" data-index="${i}">
      <div class="dashboard-project-icon">
        ${p.type === 'fivem'
          ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16V4H3v12h18m0-14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7v2h2v2H8v-2h2v-2H3a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2h18"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>'}
      </div>
      <div class="dashboard-project-info">
        <div class="dashboard-project-name">${escapeHtml(p.name)}</div>
        <div class="dashboard-project-path">${escapeHtml(p.path)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.dashboard-project-item').forEach(item => {
    item.onclick = () => {
      const index = parseInt(item.dataset.index);
      localState.selectedDashboardProject = index;
      populateDashboardProjects();
      renderDashboardContent(index);
    };
  });
}

async function renderDashboardContent(projectIndex) {
  const content = document.getElementById('dashboard-content');
  const projects = projectsState.get().projects;
  const project = projects[projectIndex];
  if (!project) return;

  const terminalCount = TerminalManager.countTerminalsForProject(projectIndex);
  const fivemStatus = localState.fivemServers.get(projectIndex)?.status || 'stopped';

  await DashboardService.renderDashboard(content, project, {
    terminalCount,
    fivemStatus,
    onOpenFolder: (p) => ipcRenderer.send('open-in-explorer', p),
    onOpenClaude: (proj) => {
      createTerminalForProject(proj);
      document.querySelector('[data-tab="claude"]')?.click();
    },
    onGitPull: (projectId) => gitPull(projectId),
    onGitPush: (projectId) => gitPush(projectId),
    onCopyPath: () => {}
  });
}

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
      <div class="form-group">
        <label>Type de projet</label>
        <div class="type-selector">
          <div class="type-card selected" data-type="standalone">
            <div class="type-card-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg></div>
            <div class="type-card-content"><div class="type-card-title">Standalone</div><div class="type-card-desc">Terminal Claude classique</div></div>
          </div>
          <div class="type-card" data-type="fivem">
            <div class="type-card-icon fivem"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16V4H3v12h18m0-14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7v2h2v2H8v-2h2v-2H3a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2h18"/></svg></div>
            <div class="type-card-content"><div class="type-card-title">FiveM Server</div><div class="type-card-desc">Demarrer/arreter FXServer</div></div>
          </div>
        </div>
      </div>
      <div class="form-group fivem-config" style="display: none;">
        <label>Script de lancement</label>
        <div class="input-with-button">
          <input type="text" id="inp-fivem-cmd" placeholder="C:\\Serveur\\run.bat">
          <button type="button" id="btn-browse-fivem" class="btn-browse">Parcourir</button>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button>
        <button type="submit" class="btn-primary">Creer</button>
      </div>
    </form>
  `);

  let selectedType = 'standalone';
  document.querySelectorAll('.type-card').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedType = card.dataset.type;
      document.querySelector('.fivem-config').style.display = selectedType === 'fivem' ? 'block' : 'none';
    };
  });

  document.getElementById('btn-browse').onclick = async () => {
    const folder = await ipcRenderer.invoke('select-folder');
    if (folder) {
      document.getElementById('inp-path').value = folder;
      if (!document.getElementById('inp-name').value) document.getElementById('inp-name').value = path.basename(folder);
    }
  };

  document.getElementById('btn-browse-fivem').onclick = async () => {
    const file = await ipcRenderer.invoke('select-file', { filters: [{ name: 'Scripts', extensions: ['bat', 'cmd', 'sh', 'exe'] }] });
    if (file) document.getElementById('inp-fivem-cmd').value = file;
  };

  document.getElementById('form-project').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('inp-name').value.trim();
    const projPath = document.getElementById('inp-path').value.trim();
    if (name && projPath) {
      const project = { id: generateProjectId(), name, path: projPath, type: selectedType, folderId: null };
      if (selectedType === 'fivem') project.fivemConfig = { runCommand: document.getElementById('inp-fivem-cmd').value.trim() };

      const projects = [...projectsState.get().projects, project];
      const rootOrder = [...projectsState.get().rootOrder, project.id];
      projectsState.set({ projects, rootOrder });
      saveProjects();
      ProjectList.render();
      closeModal();
    }
  };
};

document.getElementById('btn-new-folder').onclick = () => promptCreateFolder(null);
document.getElementById('btn-show-all').onclick = () => {
  setSelectedProjectFilter(null);
  ProjectList.render();
  TerminalManager.filterByProject(null);
};

// ========== SKILLS/AGENTS CREATION ==========
document.getElementById('btn-new-skill')?.addEventListener('click', () => {
  showModal('Nouveau Skill', `
    <form id="form-skill">
      <div class="form-group"><label>Nom (sans espaces)</label><input type="text" id="inp-skill-name" pattern="[a-z0-9-]+" required></div>
      <div class="form-group"><label>Description</label><textarea id="inp-skill-desc" rows="3"></textarea></div>
      <div class="form-actions"><button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button><button type="submit" class="btn-primary">Creer</button></div>
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
        loadSkills(); closeModal();
      } else alert('Ce skill existe deja');
    }
  };
});

document.getElementById('btn-new-agent')?.addEventListener('click', () => {
  showModal('Nouvel Agent', `
    <form id="form-agent">
      <div class="form-group"><label>Nom (sans espaces)</label><input type="text" id="inp-agent-name" pattern="[a-z0-9-]+" required></div>
      <div class="form-group"><label>Description</label><textarea id="inp-agent-desc" rows="3"></textarea></div>
      <div class="form-group"><label>Outils</label><input type="text" id="inp-agent-tools" placeholder="Read, Grep, Glob"></div>
      <div class="form-actions"><button type="button" class="btn-cancel" onclick="closeModal()">Annuler</button><button type="submit" class="btn-primary">Creer</button></div>
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
        fs.writeFileSync(path.join(agentPath, 'AGENT.md'), `# ${name}\n\ndescription: "${desc || 'Agent personnalise'}"\ntools: [${tools}]\n\n## Instructions\n\nAjoutez vos instructions ici.\n`);
        loadAgents(); closeModal();
      } else alert('Cet agent existe deja');
    }
  };
});

// ========== IPC LISTENERS ==========
ipcRenderer.on('open-project', (event, project) => {
  const projects = projectsState.get().projects;
  const existingProject = projects.find(p => p.path === project.path);
  if (existingProject) {
    const projectIndex = getProjectIndex(existingProject.id);
    setSelectedProjectFilter(projectIndex);
    ProjectList.render();
    createTerminalForProject(existingProject);
  }
});

ipcRenderer.on('open-terminal-current-project', () => {
  const selectedFilter = projectsState.get().selectedProjectFilter;
  const projects = projectsState.get().projects;
  if (selectedFilter !== null && projects[selectedFilter]) {
    createTerminalForProject(projects[selectedFilter]);
  }
});

// ========== INIT ==========
setupContextMenuHandlers();
checkAllProjectsGitStatus();
ProjectList.render();

// Initialize keyboard shortcuts
initKeyboardShortcuts();

// Navigate between terminals with Ctrl+Left/Right (cycle through all terminals)
registerShortcut('Ctrl+Left', () => {
  const terminals = Array.from(terminalsState.get().terminals.keys());
  const currentId = terminalsState.get().activeTerminal;
  if (terminals.length === 0) return;
  const currentIndex = terminals.indexOf(currentId);
  const prevIndex = (currentIndex - 1 + terminals.length) % terminals.length;
  TerminalManager.setActiveTerminal(terminals[prevIndex]);
}, { global: true });

registerShortcut('Ctrl+Right', () => {
  const terminals = Array.from(terminalsState.get().terminals.keys());
  const currentId = terminalsState.get().activeTerminal;
  if (terminals.length === 0) return;
  const currentIndex = terminals.indexOf(currentId);
  const nextIndex = (currentIndex + 1) % terminals.length;
  TerminalManager.setActiveTerminal(terminals[nextIndex]);
}, { global: true });

// Navigate between projects with Ctrl+Up/Down (only projects with open terminals)
registerShortcut('Ctrl+Up', () => {
  const projects = projectsState.get().projects;
  const terminals = terminalsState.get().terminals;

  // Get projects that have at least one terminal open
  const projectsWithTerminals = projects
    .map((p, idx) => ({ project: p, index: idx }))
    .filter(({ index }) => {
      for (const [, t] of terminals) {
        if (t.projectIndex === index) return true;
      }
      return false;
    });

  if (projectsWithTerminals.length <= 1) return;

  const currentFilter = projectsState.get().selectedProjectFilter;
  const currentIdx = projectsWithTerminals.findIndex(p => p.index === currentFilter);
  const prevIdx = (currentIdx - 1 + projectsWithTerminals.length) % projectsWithTerminals.length;

  const targetProject = projectsWithTerminals[prevIdx];
  setSelectedProjectFilter(targetProject.index);
  ProjectList.render();
  TerminalManager.filterByProject(targetProject.index);
}, { global: true });

registerShortcut('Ctrl+Down', () => {
  const projects = projectsState.get().projects;
  const terminals = terminalsState.get().terminals;

  // Get projects that have at least one terminal open
  const projectsWithTerminals = projects
    .map((p, idx) => ({ project: p, index: idx }))
    .filter(({ index }) => {
      for (const [, t] of terminals) {
        if (t.projectIndex === index) return true;
      }
      return false;
    });

  if (projectsWithTerminals.length <= 1) return;

  const currentFilter = projectsState.get().selectedProjectFilter;
  const currentIdx = projectsWithTerminals.findIndex(p => p.index === currentFilter);
  const nextIdx = (currentIdx + 1) % projectsWithTerminals.length;

  const targetProject = projectsWithTerminals[nextIdx];
  setSelectedProjectFilter(targetProject.index);
  ProjectList.render();
  TerminalManager.filterByProject(targetProject.index);
}, { global: true });

// Settings shortcut
registerShortcut('Ctrl+,', () => showSettingsModal(), { global: true });

// Close current terminal with Ctrl+W
registerShortcut('Ctrl+W', () => {
  const currentId = terminalsState.get().activeTerminal;
  if (currentId) {
    TerminalManager.closeTerminal(currentId);
  }
}, { global: true });

// ========== UPDATE SYSTEM (GitHub Desktop style) ==========
const updateBanner = document.getElementById('update-banner');
const updateMessage = document.getElementById('update-message');
const updateProgressContainer = document.getElementById('update-progress-container');
const updateProgressBar = document.getElementById('update-progress-bar');
const updateProgressText = document.getElementById('update-progress-text');
const updateBtn = document.getElementById('update-btn');
const updateDismiss = document.getElementById('update-dismiss');

let updateState = {
  available: false,
  downloaded: false,
  version: null,
  dismissed: false
};

function showUpdateBanner() {
  if (updateState.dismissed) return;
  updateBanner.style.display = 'block';
  // Adjust main container height
  document.querySelector('.main-container').style.height = 'calc(100vh - 36px - 44px)';
}

function hideUpdateBanner() {
  updateBanner.style.display = 'none';
  document.querySelector('.main-container').style.height = 'calc(100vh - 36px)';
}

function updateProgress(percent) {
  const p = Math.round(percent);
  updateProgressBar.style.setProperty('--progress', `${p}%`);
  updateProgressText.textContent = `${p}%`;
}

// Handle update status from main process
ipcRenderer.on('update-status', (event, data) => {
  switch (data.status) {
    case 'available':
      updateState.available = true;
      updateState.version = data.version;
      updateMessage.textContent = `Nouvelle version disponible: v${data.version}`;
      updateProgressContainer.style.display = 'flex';
      updateBtn.style.display = 'none';
      updateBanner.classList.remove('downloaded');
      showUpdateBanner();
      break;

    case 'downloading':
      updateProgress(data.progress || 0);
      break;

    case 'downloaded':
      updateState.downloaded = true;
      updateMessage.textContent = `v${data.version} prete a installer`;
      updateProgressContainer.style.display = 'none';
      updateBtn.style.display = 'block';
      updateBanner.classList.add('downloaded');
      showUpdateBanner();
      break;

    case 'not-available':
      // Pas de nouvelle version, ne rien afficher
      break;

    case 'error':
      console.error('Update error:', data.error);
      hideUpdateBanner();
      break;
  }
});

// Restart and install button
updateBtn.addEventListener('click', () => {
  ipcRenderer.send('update-install');
});

// Dismiss button
updateDismiss.addEventListener('click', () => {
  updateState.dismissed = true;
  hideUpdateBanner();
});

// Display current version
ipcRenderer.invoke('get-app-version').then(version => {
  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    versionEl.textContent = `v${version}`;
  }
}).catch(() => {});

console.log('Claude Terminal initialized');
