/**
 * Project Service
 * Handles project-related operations in the renderer
 */

const { ipcRenderer } = require('electron');
const {
  projectsState,
  getProject,
  getProjectIndex,
  addProject,
  updateProject,
  deleteProject: deleteProjectState,
  loadProjects,
  saveProjects,
  setSelectedProjectFilter,
  setOpenedProjectId
} = require('../state');

/**
 * Open folder dialog and add a new project
 * @param {string} type - Project type ('standalone' or 'fivem')
 * @returns {Promise<Object|null>}
 */
async function addProjectFromDialog(type = 'standalone') {
  const folderPath = await ipcRenderer.invoke('select-folder');
  if (!folderPath) return null;

  // Extract project name from path
  const name = folderPath.split(/[/\\]/).pop();

  const project = addProject({
    name,
    path: folderPath,
    type
  });

  return project;
}

/**
 * Add a FiveM project with run command selection
 * @returns {Promise<Object|null>}
 */
async function addFivemProject() {
  const folderPath = await ipcRenderer.invoke('select-folder');
  if (!folderPath) return null;

  const name = folderPath.split(/[/\\]/).pop();

  // Ask for run command
  const runCommand = await ipcRenderer.invoke('select-file', {
    filters: [
      { name: 'Batch files', extensions: ['bat', 'cmd'] },
      { name: 'Executables', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  const project = addProject({
    name,
    path: folderPath,
    type: 'fivem',
    runCommand: runCommand || null
  });

  return project;
}

/**
 * Delete a project
 * @param {string} projectId
 * @param {Function} onConfirm - Callback before deletion
 * @returns {boolean}
 */
function deleteProjectWithConfirm(projectId, onConfirm) {
  const project = getProject(projectId);
  if (!project) return false;

  if (!confirm(`Supprimer "${project.name}" ?`)) {
    return false;
  }

  if (onConfirm) {
    onConfirm(projectId, project);
  }

  deleteProjectState(projectId);
  return true;
}

/**
 * Open project in external editor
 * @param {string} projectId
 * @param {string} editor - Editor command ('code', 'cursor', etc.)
 */
function openInEditor(projectId, editor = 'code') {
  const project = getProject(projectId);
  if (!project) return;

  const { exec } = require('child_process');
  exec(`${editor} "${project.path}"`);
}

/**
 * Open project folder in file explorer
 * @param {string} projectId
 */
function openInExplorer(projectId) {
  const project = getProject(projectId);
  if (project) {
    ipcRenderer.send('open-in-explorer', project.path);
  }
}

/**
 * Select a project for terminal filtering
 * @param {string} projectId
 */
function selectProject(projectId) {
  const projectIndex = getProjectIndex(projectId);
  setSelectedProjectFilter(projectIndex);
  setOpenedProjectId(null);
}

/**
 * Clear project selection
 */
function clearProjectSelection() {
  setSelectedProjectFilter(null);
  setOpenedProjectId(null);
}

/**
 * Get all projects
 * @returns {Array}
 */
function getAllProjects() {
  return projectsState.get().projects;
}

/**
 * Get projects by type
 * @param {string} type
 * @returns {Array}
 */
function getProjectsByType(type) {
  return projectsState.get().projects.filter(p => p.type === type);
}

/**
 * Search projects by name
 * @param {string} query
 * @returns {Array}
 */
function searchProjects(query) {
  const lowerQuery = query.toLowerCase();
  return projectsState.get().projects.filter(p =>
    p.name.toLowerCase().includes(lowerQuery) ||
    p.path.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Check git status for all projects
 * @param {Function} renderCallback - Callback to render after check
 */
async function checkAllProjectsGitStatus(renderCallback) {
  const { setGitRepoStatus } = require('../state');
  const projects = projectsState.get().projects;

  for (const project of projects) {
    try {
      const result = await ipcRenderer.invoke('git-status-quick', { projectPath: project.path });
      setGitRepoStatus(project.id, result.isGitRepo);
    } catch (e) {
      setGitRepoStatus(project.id, false);
    }
  }

  if (renderCallback) {
    renderCallback();
  }
}

module.exports = {
  addProjectFromDialog,
  addFivemProject,
  deleteProjectWithConfirm,
  openInEditor,
  openInExplorer,
  selectProject,
  clearProjectSelection,
  getAllProjects,
  getProjectsByType,
  searchProjects,
  checkAllProjectsGitStatus,
  loadProjects,
  saveProjects
};
