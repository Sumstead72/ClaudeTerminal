/**
 * Color Utilities
 * Helper functions for color manipulation and theme management
 */

const { ipcRenderer } = require('electron');

/**
 * Convert hex color to RGB object
 * @param {string} hex - Hex color string (e.g., '#d97706')
 * @returns {{r: number, g: number, b: number}|null}
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Convert RGB to hex color
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} - Hex color string
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Lighten a color by a percentage
 * @param {string} hex - Hex color string
 * @param {number} percent - Percentage to lighten (0-100)
 * @returns {string} - Lightened hex color
 */
function lightenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const r = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * percent / 100));
  const g = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * percent / 100));
  const b = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * percent / 100));

  return rgbToHex(r, g, b);
}

/**
 * Darken a color by a percentage
 * @param {string} hex - Hex color string
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} - Darkened hex color
 */
function darkenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const r = Math.floor(rgb.r * (100 - percent) / 100);
  const g = Math.floor(rgb.g * (100 - percent) / 100);
  const b = Math.floor(rgb.b * (100 - percent) / 100);

  return rgbToHex(r, g, b);
}

/**
 * Apply accent color to CSS custom properties
 * @param {string} color - Hex color string
 */
function applyAccentColor(color) {
  const root = document.documentElement;
  const rgb = hexToRgb(color);

  // Main accent color
  root.style.setProperty('--accent', color);

  // Hover state (lighter)
  root.style.setProperty('--accent-hover', lightenColor(color, 30));

  // Dimmed version (transparent)
  if (rgb) {
    root.style.setProperty('--accent-dim', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
  }

  // Notify main process to update tray icon
  ipcRenderer.send('update-accent-color', color);
}

/**
 * Get contrasting text color (black or white) for a background
 * @param {string} hex - Background hex color
 * @returns {string} - '#000000' or '#ffffff'
 */
function getContrastColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';

  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Predefined accent color palette
 */
const ACCENT_COLORS = [
  { name: 'Orange', hex: '#d97706' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Lime', hex: '#65a30d' }
];

module.exports = {
  hexToRgb,
  rgbToHex,
  lightenColor,
  darkenColor,
  applyAccentColor,
  getContrastColor,
  ACCENT_COLORS
};
