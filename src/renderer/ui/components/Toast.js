/**
 * Toast Component
 * Notification toast messages
 */

const { escapeHtml } = require('../../utils/dom');

// Toast container element
let toastContainer = null;

/**
 * Initialize toast container
 */
function initToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

/**
 * Show a toast message
 * @param {Object} options
 * @param {string} options.message - Toast message
 * @param {string} options.type - Toast type ('success', 'error', 'warning', 'info')
 * @param {number} options.duration - Duration in ms (0 for persistent)
 * @param {string} options.action - Action button label
 * @param {Function} options.onAction - Action button callback
 * @returns {HTMLElement}
 */
function showToast({ message, type = 'info', duration = 4000, action, onAction }) {
  initToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    ${action ? `<button class="toast-action">${escapeHtml(action)}</button>` : ''}
    <button class="toast-close" aria-label="Fermer">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  `;

  // Close button handler
  toast.querySelector('.toast-close').onclick = () => {
    hideToast(toast);
  };

  // Action button handler
  if (action && onAction) {
    toast.querySelector('.toast-action').onclick = () => {
      onAction();
      hideToast(toast);
    };
  }

  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto hide
  if (duration > 0) {
    setTimeout(() => {
      hideToast(toast);
    }, duration);
  }

  return toast;
}

/**
 * Hide a toast
 * @param {HTMLElement} toast
 */
function hideToast(toast) {
  toast.classList.remove('show');
  toast.classList.add('hide');

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

/**
 * Show success toast
 * @param {string} message
 * @param {number} duration
 */
function showSuccess(message, duration = 4000) {
  return showToast({ message, type: 'success', duration });
}

/**
 * Show error toast
 * @param {string} message
 * @param {number} duration
 */
function showError(message, duration = 6000) {
  return showToast({ message, type: 'error', duration });
}

/**
 * Show warning toast
 * @param {string} message
 * @param {number} duration
 */
function showWarning(message, duration = 5000) {
  return showToast({ message, type: 'warning', duration });
}

/**
 * Show info toast
 * @param {string} message
 * @param {number} duration
 */
function showInfo(message, duration = 4000) {
  return showToast({ message, type: 'info', duration });
}

/**
 * Clear all toasts
 */
function clearAllToasts() {
  if (toastContainer) {
    toastContainer.innerHTML = '';
  }
}

module.exports = {
  showToast,
  hideToast,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  clearAllToasts
};
