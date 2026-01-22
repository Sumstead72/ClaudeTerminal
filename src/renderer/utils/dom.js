/**
 * DOM Utilities
 * Helper functions for DOM manipulation and sanitization
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Raw text to escape
 * @returns {string} - Escaped HTML-safe string
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format large numbers with K/M suffixes
 * @param {number} num - Number to format
 * @returns {string} - Formatted string
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * Create an element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes to set
 * @param {Array|string} children - Child elements or text content
 * @returns {HTMLElement}
 */
function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key.startsWith('data')) {
      el.dataset[key.slice(4).toLowerCase()] = value;
    } else {
      el.setAttribute(key, value);
    }
  });

  if (typeof children === 'string') {
    el.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    });
  }

  return el;
}

/**
 * Query selector with error handling
 * @param {string} selector - CSS selector
 * @param {Element} parent - Parent element (defaults to document)
 * @returns {Element|null}
 */
function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Query selector all with array return
 * @param {string} selector - CSS selector
 * @param {Element} parent - Parent element (defaults to document)
 * @returns {Element[]}
 */
function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Delay in ms
 * @returns {Function}
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum time between calls in ms
 * @returns {Function}
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

module.exports = {
  escapeHtml,
  formatNumber,
  createElement,
  $,
  $$,
  debounce,
  throttle
};
