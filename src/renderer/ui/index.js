/**
 * UI Module - Central Export
 */

const components = require('./components');
const themes = require('./themes/terminal-themes');
const panels = require('./panels');

module.exports = {
  components,
  ...components,
  themes,
  ...themes,
  panels,
  ...panels
};
