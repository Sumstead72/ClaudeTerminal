/**
 * Drag and Drop Feature
 * Handles drag and drop for projects and folders
 */

const { dragState } = require('../state');
const { moveItemToFolder, isDescendantOf } = require('../state');

/**
 * Setup drag and drop on a project list
 * @param {HTMLElement} list - List container element
 * @param {Function} onDrop - Callback after drop
 */
function setupDragAndDrop(list, onDrop) {
  // Draggable elements
  list.querySelectorAll('[draggable="true"]').forEach(el => {
    setupDraggable(el);
  });

  // Folder drop targets
  list.querySelectorAll('.folder-item').forEach(folder => {
    setupFolderDropTarget(folder, onDrop);
  });

  // Root drop zone
  const rootZone = list.querySelector('.drop-zone-root');
  if (rootZone) {
    setupRootDropZone(rootZone, onDrop);
  }
}

/**
 * Setup draggable element
 * @param {HTMLElement} el
 */
function setupDraggable(el) {
  el.addEventListener('dragstart', (e) => {
    e.stopPropagation();

    const projectId = el.dataset.projectId;
    const folderId = el.dataset.folderId;

    if (projectId) {
      dragState.set({
        dragging: { type: 'project', id: projectId },
        dropTarget: null
      });
    } else if (folderId) {
      dragState.set({
        dragging: { type: 'folder', id: folderId },
        dropTarget: null
      });
    }

    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragState.set({ dragging: null, dropTarget: null });
    document.querySelectorAll('.drag-over').forEach(elem => {
      elem.classList.remove('drag-over');
    });
  });
}

/**
 * Setup folder as drop target
 * @param {HTMLElement} folder
 * @param {Function} onDrop
 */
function setupFolderDropTarget(folder, onDrop) {
  const folderId = folder.dataset.folderId;

  folder.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const state = dragState.get();
    if (!state.dragging) return;

    if (state.dragging.type === 'folder') {
      if (state.dragging.id === folderId) return;
      if (isDescendantOf(folderId, state.dragging.id)) return;
    }

    folder.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  });

  folder.addEventListener('dragleave', (e) => {
    if (!folder.contains(e.relatedTarget)) {
      folder.classList.remove('drag-over');
    }
  });

  folder.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    folder.classList.remove('drag-over');

    const state = dragState.get();
    if (!state.dragging) return;

    if (state.dragging.type === 'folder') {
      if (state.dragging.id === folderId) return;
      if (isDescendantOf(folderId, state.dragging.id)) return;
    }

    moveItemToFolder(state.dragging.type, state.dragging.id, folderId);
    if (onDrop) onDrop(state.dragging, folderId);
  });
}

/**
 * Setup root drop zone
 * @param {HTMLElement} zone
 * @param {Function} onDrop
 */
function setupRootDropZone(zone, onDrop) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    const state = dragState.get();
    if (!state.dragging) return;
    zone.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');

    const state = dragState.get();
    if (!state.dragging) return;

    moveItemToFolder(state.dragging.type, state.dragging.id, null);
    if (onDrop) onDrop(state.dragging, null);
  });
}

function isDragging() {
  return dragState.get().dragging !== null;
}

function cancelDrag() {
  dragState.set({ dragging: null, dropTarget: null });
  document.querySelectorAll('.dragging, .drag-over').forEach(el => {
    el.classList.remove('dragging', 'drag-over');
  });
}

module.exports = {
  setupDragAndDrop,
  setupDraggable,
  setupFolderDropTarget,
  setupRootDropZone,
  isDragging,
  cancelDrag
};
