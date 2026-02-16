/**
 * GitChangesPanel
 * Git staging area with file selection, commit message generation, and commit
 * Extracted from renderer.js
 */

const { escapeHtml } = require('../../utils');
const { t } = require('../../i18n');
const { getSetting } = require('../../state');

const api = window.electron_api;

let showToast = null;
let showGitToast = null;
let getCurrentFilterProjectId = null;
let getProject = null;
let refreshDashboardAsync = null;
let closeBranchDropdown = null;
let closeActionsDropdown = null;

// DOM elements (acquired lazily)
let gitChangesPanel = null;
let gitChangesList = null;
let gitChangesStats = null;
let gitChangesProject = null;
let gitSelectAll = null;
let gitCommitMessage = null;
let btnCommitSelected = null;
let btnGenerateCommit = null;
let commitCountSpan = null;
let changesCountBadge = null;
let filterBtnChanges = null;

const gitChangesState = {
  files: [],
  selectedFiles: new Set(),
  projectId: null,
  projectPath: null
};

function init(context) {
  showToast = context.showToast;
  showGitToast = context.showGitToast;
  getCurrentFilterProjectId = context.getCurrentFilterProjectId;
  getProject = context.getProject;
  refreshDashboardAsync = context.refreshDashboardAsync;
  closeBranchDropdown = context.closeBranchDropdown;
  closeActionsDropdown = context.closeActionsDropdown;

  // Acquire DOM elements
  gitChangesPanel = document.getElementById('git-changes-panel');
  gitChangesList = document.getElementById('git-changes-list');
  gitChangesStats = document.getElementById('git-changes-stats');
  gitChangesProject = document.getElementById('git-changes-project');
  gitSelectAll = document.getElementById('git-select-all');
  gitCommitMessage = document.getElementById('git-commit-message');
  btnCommitSelected = document.getElementById('btn-commit-selected');
  btnGenerateCommit = document.getElementById('btn-generate-commit');
  commitCountSpan = document.getElementById('commit-count');
  changesCountBadge = document.getElementById('changes-count');
  filterBtnChanges = document.getElementById('filter-btn-changes');

  setupEventListeners();
}

function setupEventListeners() {
  // Toggle changes panel
  filterBtnChanges.onclick = (e) => {
    e.stopPropagation();
    const isOpen = gitChangesPanel.classList.contains('active');

    // Close other dropdowns
    if (closeBranchDropdown) closeBranchDropdown();
    if (closeActionsDropdown) closeActionsDropdown();

    if (isOpen) {
      gitChangesPanel.classList.remove('active');
    } else {
      const btnRect = filterBtnChanges.getBoundingClientRect();
      const headerRect = gitChangesPanel.parentElement.getBoundingClientRect();
      const panelWidth = 480;
      let left = btnRect.left - headerRect.left;
      const maxRight = Math.min(headerRect.width, window.innerWidth - headerRect.left);
      if (left + panelWidth > maxRight) {
        left = Math.max(0, maxRight - panelWidth);
      }
      gitChangesPanel.style.left = left + 'px';

      gitChangesPanel.classList.add('active');
      loadGitChanges();
    }
  };

  // Close panel
  document.getElementById('btn-close-changes').onclick = () => {
    gitChangesPanel.classList.remove('active');
  };

  // Refresh changes
  document.getElementById('btn-refresh-changes').onclick = () => {
    loadGitChanges();
  };

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!gitChangesPanel.contains(e.target) && !filterBtnChanges.contains(e.target)) {
      gitChangesPanel.classList.remove('active');
    }
  });

  // Select all checkbox
  gitSelectAll.onchange = () => {
    const shouldSelect = gitSelectAll.checked;
    gitChangesState.files.forEach((_, index) => {
      if (shouldSelect) {
        gitChangesState.selectedFiles.add(index);
      } else {
        gitChangesState.selectedFiles.delete(index);
      }
    });
    renderGitChanges();
    updateCommitButton();
  };

  // Commit message input
  gitCommitMessage.oninput = () => {
    updateCommitButton();
  };

  // Generate commit message
  btnGenerateCommit.onclick = async () => {
    if (gitChangesState.selectedFiles.size === 0) {
      showToast({ type: 'warning', title: 'Fichiers requis', message: 'Selectionnez au moins un fichier', duration: 3000 });
      return;
    }

    const selectedFiles = Array.from(gitChangesState.selectedFiles)
      .map(i => gitChangesState.files[i])
      .filter(Boolean);

    btnGenerateCommit.disabled = true;
    const btnSpan = btnGenerateCommit.querySelector('span');
    const originalText = btnSpan.textContent;
    btnSpan.textContent = '...';

    try {
      const result = await api.git.generateCommitMessage({
        projectPath: gitChangesState.projectPath,
        files: selectedFiles,
        useAi: getSetting('aiCommitMessages') !== false
      });

      if (result.success && result.message) {
        gitCommitMessage.value = result.message;

        const sourceLabel = result.source === 'ai' ? 'AI' : 'Heuristique';
        showToast({
          type: 'success',
          title: `Message g\u00e9n\u00e9r\u00e9 (${sourceLabel})`,
          message: result.message,
          duration: 3000
        });

        if (result.groups && result.groups.length > 1) {
          const groupNames = result.groups.map(g => g.name).join(', ');
          setTimeout(() => showToast({
            type: 'info',
            title: 'Commits multiples sugg\u00e9r\u00e9s',
            message: `Les fichiers touchent ${result.groups.length} zones (${groupNames}). Envisagez de s\u00e9parer en plusieurs commits.`,
            duration: 6000
          }), 500);
        }
      } else {
        showToast({ type: 'error', title: 'Erreur', message: result.error || 'Impossible de g\u00e9n\u00e9rer le message', duration: 3000 });
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: e.message, duration: 3000 });
    } finally {
      btnGenerateCommit.disabled = false;
      btnSpan.textContent = originalText;
    }
  };

  // Commit selected files
  btnCommitSelected.onclick = async () => {
    const message = gitCommitMessage.value.trim();
    if (!message) {
      showToast({ type: 'warning', title: 'Message requis', message: 'Entrez un message de commit', duration: 3000 });
      return;
    }

    if (gitChangesState.selectedFiles.size === 0) {
      showToast({ type: 'warning', title: 'Fichiers requis', message: 'Selectionnez au moins un fichier', duration: 3000 });
      return;
    }

    const selectedPaths = Array.from(gitChangesState.selectedFiles)
      .map(i => gitChangesState.files[i]?.path)
      .filter(Boolean);

    btnCommitSelected.disabled = true;
    btnCommitSelected.innerHTML = '<span class="loading-spinner"></span> Commit...';

    try {
      const stageResult = await api.git.stageFiles({
        projectPath: gitChangesState.projectPath,
        files: selectedPaths
      });

      if (!stageResult.success) {
        throw new Error(stageResult.error);
      }

      const commitResult = await api.git.commit({
        projectPath: gitChangesState.projectPath,
        message: message
      });

      if (commitResult.success) {
        showGitToast({
          success: true,
          title: 'Commit cree',
          message: `${selectedPaths.length} fichier(s) commites`,
          duration: 3000
        });
        gitCommitMessage.value = '';
        loadGitChanges();
        refreshDashboardAsync(gitChangesState.projectId);
      } else {
        throw new Error(commitResult.error);
      }
    } catch (e) {
      showGitToast({
        success: false,
        title: 'Erreur de commit',
        message: e.message,
        duration: 5000
      });
    } finally {
      btnCommitSelected.disabled = false;
      btnCommitSelected.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> <span>${t('ui.commitSelected')}</span> (<span id="commit-count">${gitChangesState.selectedFiles.size}</span>)`;
      // Re-acquire since innerHTML replaced it
      commitCountSpan = document.getElementById('commit-count');
    }
  };
}

async function loadGitChanges() {
  const projectId = getCurrentFilterProjectId();
  if (!projectId) return;

  const project = getProject(projectId);
  if (!project) return;

  gitChangesState.projectId = projectId;
  gitChangesState.projectPath = project.path;
  gitChangesProject.textContent = `- ${project.name}`;

  gitChangesList.innerHTML = '<div class="git-changes-loading">Chargement des changements...</div>';

  try {
    const status = await api.git.statusDetailed({ projectPath: project.path });

    if (!status.success) {
      gitChangesList.innerHTML = `<div class="git-changes-empty"><p>Erreur: ${status.error}</p></div>`;
      return;
    }

    gitChangesState.files = status.files || [];
    gitChangesState.selectedFiles.clear();

    renderGitChanges();
    updateChangesCount();
  } catch (e) {
    gitChangesList.innerHTML = `<div class="git-changes-empty"><p>Erreur: ${e.message}</p></div>`;
  }
}

function renderGitChanges() {
  const files = gitChangesState.files;

  if (files.length === 0) {
    gitChangesList.innerHTML = `
      <div class="git-changes-empty">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        <p>Aucun changement detecte</p>
      </div>
    `;
    gitChangesStats.innerHTML = '';
    return;
  }

  const tracked = [];
  const untracked = [];
  files.forEach((file, index) => {
    if (file.status === '?') {
      untracked.push({ file, index });
    } else {
      tracked.push({ file, index });
    }
  });

  const stats = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: untracked.length };
  tracked.forEach(({ file }) => {
    if (file.status === 'M') stats.modified++;
    else if (file.status === 'A') stats.added++;
    else if (file.status === 'D') stats.deleted++;
    else if (file.status === 'R') stats.renamed++;
  });

  gitChangesStats.innerHTML = `
    ${stats.modified ? `<span class="git-stat modified">M ${stats.modified}</span>` : ''}
    ${stats.added ? `<span class="git-stat added">A ${stats.added}</span>` : ''}
    ${stats.deleted ? `<span class="git-stat deleted">D ${stats.deleted}</span>` : ''}
    ${stats.renamed ? `<span class="git-stat renamed">R ${stats.renamed}</span>` : ''}
    ${stats.untracked ? `<span class="git-stat untracked">? ${stats.untracked}</span>` : ''}
  `;

  function renderFileItem({ file, index }) {
    const fileName = file.path.split('/').pop();
    const filePath = file.path.split('/').slice(0, -1).join('/');
    const isSelected = gitChangesState.selectedFiles.has(index);

    return `<div class="git-file-item ${isSelected ? 'selected' : ''}" data-index="${index}">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <span class="git-file-status ${file.status}">${file.status}</span>
        <div class="git-file-info">
          <div class="git-file-name">${escapeHtml(fileName)}</div>
          ${filePath ? `<div class="git-file-path">${escapeHtml(filePath)}</div>` : ''}
        </div>
        <div class="git-file-diff">
          ${file.additions ? `<span class="additions">+${file.additions}</span>` : ''}
          ${file.deletions ? `<span class="deletions">-${file.deletions}</span>` : ''}
        </div>
      </div>`;
  }

  let html = '';

  if (tracked.length > 0) {
    const trackedIndices = tracked.map(t => t.index);
    const allTrackedSelected = trackedIndices.every(i => gitChangesState.selectedFiles.has(i));
    const someTrackedSelected = trackedIndices.some(i => gitChangesState.selectedFiles.has(i));
    html += `<div class="git-changes-section">
      <div class="git-changes-section-header" data-section="tracked">
        <svg class="git-section-chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
        <input type="checkbox" class="git-section-checkbox" data-section="tracked" ${allTrackedSelected ? 'checked' : ''} ${!allTrackedSelected && someTrackedSelected ? 'data-indeterminate' : ''}>
        <span class="git-section-title">${t('ui.trackedChanges')}</span>
        <span class="git-section-count">${tracked.length}</span>
      </div>
      <div class="git-changes-section-files">
        ${tracked.map(renderFileItem).join('')}
      </div>
    </div>`;
  }

  if (untracked.length > 0) {
    const untrackedIndices = untracked.map(u => u.index);
    const allUntrackedSelected = untrackedIndices.every(i => gitChangesState.selectedFiles.has(i));
    const someUntrackedSelected = untrackedIndices.some(i => gitChangesState.selectedFiles.has(i));
    html += `<div class="git-changes-section">
      <div class="git-changes-section-header" data-section="untracked">
        <svg class="git-section-chevron" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
        <input type="checkbox" class="git-section-checkbox" data-section="untracked" ${allUntrackedSelected ? 'checked' : ''} ${!allUntrackedSelected && someUntrackedSelected ? 'data-indeterminate' : ''}>
        <span class="git-section-title">${t('ui.untrackedFiles')}</span>
        <span class="git-section-count">${untracked.length}</span>
      </div>
      <div class="git-changes-section-files">
        ${untracked.map(renderFileItem).join('')}
      </div>
    </div>`;
  }

  gitChangesList.innerHTML = html;

  gitChangesList.querySelectorAll('.git-section-checkbox[data-indeterminate]').forEach(cb => {
    cb.indeterminate = true;
    cb.removeAttribute('data-indeterminate');
  });

  gitChangesList.querySelectorAll('.git-file-item').forEach(item => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    const index = parseInt(item.dataset.index);

    item.onclick = (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      toggleFileSelection(index, checkbox.checked);
    };

    checkbox.onchange = () => {
      toggleFileSelection(index, checkbox.checked);
    };
  });

  gitChangesList.querySelectorAll('.git-section-checkbox').forEach(cb => {
    cb.onchange = () => {
      const section = cb.dataset.section;
      const items = section === 'tracked' ? tracked : untracked;
      items.forEach(({ index }) => {
        if (cb.checked) {
          gitChangesState.selectedFiles.add(index);
        } else {
          gitChangesState.selectedFiles.delete(index);
        }
      });
      renderGitChanges();
      updateCommitButton();
      updateSelectAllState();
    };
  });

  gitChangesList.querySelectorAll('.git-changes-section-header').forEach(header => {
    header.onclick = (e) => {
      if (e.target.closest('.git-section-checkbox')) return;
      const filesDiv = header.nextElementSibling;
      if (filesDiv) {
        header.classList.toggle('collapsed');
        filesDiv.classList.toggle('collapsed');
      }
    };
  });

  updateSelectAllState();
}

function toggleFileSelection(index, selected) {
  if (selected) {
    gitChangesState.selectedFiles.add(index);
  } else {
    gitChangesState.selectedFiles.delete(index);
  }

  const item = gitChangesList.querySelector(`[data-index="${index}"]`);
  if (item) {
    item.classList.toggle('selected', selected);
  }

  updateSectionCheckboxes();
  updateCommitButton();
  updateSelectAllState();
}

function updateSectionCheckboxes() {
  const files = gitChangesState.files;
  gitChangesList.querySelectorAll('.git-section-checkbox').forEach(cb => {
    const section = cb.dataset.section;
    const indices = [];
    files.forEach((f, i) => {
      if (section === 'tracked' && f.status !== '?') indices.push(i);
      else if (section === 'untracked' && f.status === '?') indices.push(i);
    });
    if (indices.length === 0) return;
    const allSelected = indices.every(i => gitChangesState.selectedFiles.has(i));
    const someSelected = indices.some(i => gitChangesState.selectedFiles.has(i));
    cb.checked = allSelected;
    cb.indeterminate = !allSelected && someSelected;
  });
}

function updateSelectAllState() {
  const total = gitChangesState.files.length;
  const selected = gitChangesState.selectedFiles.size;
  gitSelectAll.checked = total > 0 && selected === total;
  gitSelectAll.indeterminate = selected > 0 && selected < total;
}

function updateCommitButton() {
  const count = gitChangesState.selectedFiles.size;
  if (commitCountSpan) commitCountSpan.textContent = count;
  btnCommitSelected.disabled = count === 0 || !gitCommitMessage.value.trim();
}

function updateChangesCount() {
  const count = gitChangesState.files.length;
  if (count > 0) {
    changesCountBadge.textContent = count;
    changesCountBadge.style.display = 'inline';
    filterBtnChanges.classList.add('has-changes');
  } else {
    changesCountBadge.style.display = 'none';
    filterBtnChanges.classList.remove('has-changes');
  }
}

async function refreshGitChangesIfOpen() {
  if (gitChangesPanel && gitChangesPanel.classList.contains('active')) {
    await loadGitChanges();
  }
}

module.exports = { init, loadGitChanges, refreshGitChangesIfOpen };
