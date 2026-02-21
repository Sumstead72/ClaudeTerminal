/**
 * FiveM ProjectList Module
 * Provides sidebar buttons, icons, status indicators for FiveM projects
 */

const { t } = require('../../../renderer/i18n');

/**
 * Get primary action buttons for the sidebar
 * @param {Object} ctx - { project, projectIndex, fivemStatus, isRunning, isStarting, escapeHtml }
 * @returns {string} HTML
 */
function getSidebarButtons(ctx) {
  const { project, isRunning, isStarting } = ctx;
  if (isRunning || isStarting) {
    return `
      <button class="btn-action-icon btn-fivem-console" data-project-id="${project.id}" title="${t('fivem.serverConsole')}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
      </button>
      <button class="btn-action-primary btn-fivem-stop" data-project-id="${project.id}" title="${t('fivem.stopServer')}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
      </button>`;
  }
  return `
    <button class="btn-action-primary btn-fivem-start" data-project-id="${project.id}" title="${t('fivem.startServer')}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>`;
}

/**
 * Get project icon SVG for FiveM
 * @param {Object} ctx - { project, projectColor }
 * @returns {string} HTML
 */
function getProjectIcon(ctx) {
  const { projectColor } = ctx;
  const iconColorStyle = projectColor ? `style="color: ${projectColor}"` : '';
  return `<svg viewBox="0 0 24 24" fill="currentColor" class="fivem-icon" ${iconColorStyle}><path d="M22.4 24h-5.225c-.117 0-.455-1.127-1.026-3.375c-1.982-6.909-3.124-10.946-3.417-12.12l3.37-3.325h.099c.454 1.42 2.554 7.676 6.299 18.768ZM12.342 7.084h-.048a3.382 3.385 0 0 1-.098-.492v-.098a102.619 102.715 0 0 1 3.272-3.275c.13.196.196.356.196.491v.05a140.694 140.826 0 0 1-3.322 3.324ZM5.994 10.9h-.05c.67-2.12 1.076-3.209 1.223-3.275L14.492.343c.08 0 .258.524.533 1.562zm1.37-4.014h-.05C8.813 2.342 9.612.048 9.71 0h4.495v.05a664.971 664.971 0 0 1-6.841 6.839Zm-2.69 7.874h-.05c.166-.798.554-1.418 1.174-1.855a312.918 313.213 0 0 1 5.71-5.717h.05c-.117.672-.375 1.175-.781 1.52zM1.598 24l-.098-.05c1.399-4.172 2.148-6.322 2.248-6.45l6.74-6.694v.05C10.232 11.88 8.974 16.263 6.73 24Z"/></svg>`;
}

/**
 * Get status indicator dot
 * @param {Object} ctx - { fivemStatus }
 * @returns {string} HTML
 */
function getStatusIndicator(ctx) {
  const { fivemStatus } = ctx;
  const statusText = fivemStatus === 'stopped' ? t('fivem.stopped')
    : fivemStatus === 'starting' ? t('fivem.starting')
    : t('fivem.running');
  return `<span class="fivem-status-dot ${fivemStatus}" title="${statusText}"></span>`;
}

/**
 * Get CSS class for project item
 * @returns {string}
 */
function getProjectItemClass() {
  return 'fivem-project';
}

/**
 * Get additional menu items for the more-actions menu
 * @param {Object} ctx - { project }
 * @returns {string} HTML
 */
function getMenuItems(ctx) {
  const { project } = ctx;
  return `
    <button class="more-actions-item btn-claude" data-project-id="${project.id}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
      Claude Code
    </button>`;
}

/**
 * Get dashboard project icon for the sidebar list
 * @returns {string} SVG HTML
 */
function getDashboardIcon() {
  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.4 24h-5.225c-.117 0-.455-1.127-1.026-3.375c-1.982-6.909-3.124-10.946-3.417-12.12l3.37-3.325h.099c.454 1.42 2.554 7.676 6.299 18.768ZM12.342 7.084h-.048a3.382 3.385 0 0 1-.098-.492v-.098a102.619 102.715 0 0 1 3.272-3.275c.13.196.196.356.196.491v.05a140.694 140.826 0 0 1-3.322 3.324ZM5.994 10.9h-.05c.67-2.12 1.076-3.209 1.223-3.275L14.492.343c.08 0 .258.524.533 1.562zm1.37-4.014h-.05C8.813 2.342 9.612.048 9.71 0h4.495v.05a664.971 664.971 0 0 1-6.841 6.839Zm-2.69 7.874h-.05c.166-.798.554-1.418 1.174-1.855a312.918 313.213 0 0 1 5.71-5.717h.05c-.117.672-.375 1.175-.781 1.52zM1.598 24l-.098-.05c1.399-4.172 2.148-6.322 2.248-6.45l6.74-6.694v.05C10.232 11.88 8.974 16.263 6.73 24Z"/></svg>';
}

/**
 * Bind sidebar event handlers for FiveM buttons
 * @param {HTMLElement} list - The project list container
 * @param {Object} cbs - { onStartFivem, onStopFivem, onOpenFivemConsole }
 */
function bindSidebarEvents(list, cbs) {
  list.querySelectorAll('.btn-fivem-start').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (cbs.onStartFivem) cbs.onStartFivem(btn.dataset.projectId);
    };
  });
  list.querySelectorAll('.btn-fivem-stop').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (cbs.onStopFivem) cbs.onStopFivem(btn.dataset.projectId);
    };
  });
  list.querySelectorAll('.btn-fivem-console').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (cbs.onOpenFivemConsole) cbs.onOpenFivemConsole(btn.dataset.projectId);
    };
  });
}

module.exports = {
  getSidebarButtons,
  getProjectIcon,
  getStatusIndicator,
  getProjectItemClass,
  getMenuItems,
  getDashboardIcon,
  bindSidebarEvents
};
