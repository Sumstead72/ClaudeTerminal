/**
 * Quick Picker Feature
 * Handles the quick project picker overlay
 */

const { escapeHtml } = require('../utils/dom');
const { projectsState } = require('../state');

const quickPickerState = {
  isOpen: false,
  selectedIndex: 0,
  filteredProjects: [],
  searchQuery: ''
};

/**
 * Open the quick picker
 * @param {HTMLElement} container
 * @param {Function} onSelect
 */
function openQuickPicker(container, onSelect) {
  quickPickerState.isOpen = true;
  quickPickerState.selectedIndex = 0;
  quickPickerState.searchQuery = '';
  quickPickerState.filteredProjects = [...projectsState.get().projects];

  const picker = document.createElement('div');
  picker.className = 'quick-picker-overlay';
  picker.innerHTML = `
    <div class="quick-picker">
      <div class="quick-picker-header">
        <input type="text" class="quick-picker-input" placeholder="Rechercher un projet..." autofocus>
      </div>
      <div class="quick-picker-list"></div>
    </div>
  `;

  container.appendChild(picker);

  const input = picker.querySelector('.quick-picker-input');
  const list = picker.querySelector('.quick-picker-list');

  renderQuickPickerList(list, onSelect, picker);

  input.oninput = () => {
    quickPickerState.searchQuery = input.value.toLowerCase();
    quickPickerState.filteredProjects = projectsState.get().projects.filter(p =>
      p.name.toLowerCase().includes(quickPickerState.searchQuery) ||
      p.path.toLowerCase().includes(quickPickerState.searchQuery)
    );
    quickPickerState.selectedIndex = 0;
    renderQuickPickerList(list, onSelect, picker);
  };

  input.onkeydown = (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        quickPickerState.selectedIndex = Math.min(
          quickPickerState.selectedIndex + 1,
          quickPickerState.filteredProjects.length - 1
        );
        renderQuickPickerList(list, onSelect, picker);
        break;
      case 'ArrowUp':
        e.preventDefault();
        quickPickerState.selectedIndex = Math.max(quickPickerState.selectedIndex - 1, 0);
        renderQuickPickerList(list, onSelect, picker);
        break;
      case 'Enter':
        e.preventDefault();
        const selected = quickPickerState.filteredProjects[quickPickerState.selectedIndex];
        if (selected) {
          closeQuickPicker(picker);
          if (onSelect) onSelect(selected);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeQuickPicker(picker);
        break;
    }
  };

  picker.onclick = (e) => {
    if (e.target === picker) closeQuickPicker(picker);
  };

  requestAnimationFrame(() => {
    picker.classList.add('active');
    input.focus();
  });

  return picker;
}

function renderQuickPickerList(list, onSelect, picker) {
  if (quickPickerState.filteredProjects.length === 0) {
    list.innerHTML = '<div class="quick-picker-empty">Aucun projet trouvé</div>';
    return;
  }

  list.innerHTML = quickPickerState.filteredProjects.map((project, index) => `
    <div class="quick-picker-item ${index === quickPickerState.selectedIndex ? 'selected' : ''}" data-index="${index}">
      <div class="quick-picker-item-icon">
        ${project.type === 'fivem' ?
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16V4H3v12h18m0-14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7v2h2v2H8v-2h2v-2H3a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2h18"/></svg>' :
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>'
        }
      </div>
      <div class="quick-picker-item-content">
        <div class="quick-picker-item-name">${escapeHtml(project.name)}</div>
        <div class="quick-picker-item-path">${escapeHtml(project.path)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.quick-picker-item').forEach(item => {
    item.onclick = () => {
      const index = parseInt(item.dataset.index);
      const project = quickPickerState.filteredProjects[index];
      if (project) {
        closeQuickPicker(picker);
        if (onSelect) onSelect(project);
      }
    };
    item.onmouseenter = () => {
      quickPickerState.selectedIndex = parseInt(item.dataset.index);
      list.querySelectorAll('.quick-picker-item').forEach(i =>
        i.classList.toggle('selected', i === item)
      );
    };
  });

  const selectedItem = list.querySelector('.quick-picker-item.selected');
  if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest' });
}

function closeQuickPicker(picker) {
  quickPickerState.isOpen = false;
  picker.classList.remove('active');
  setTimeout(() => {
    if (picker.parentNode) picker.parentNode.removeChild(picker);
  }, 200);
}

function isQuickPickerOpen() {
  return quickPickerState.isOpen;
}

module.exports = {
  openQuickPicker,
  closeQuickPicker,
  isQuickPickerOpen,
  quickPickerState
};
