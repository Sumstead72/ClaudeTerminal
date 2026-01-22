/**
 * Renderer Utilities - Central Export
 */

const dom = require('./dom');
const color = require('./color');
const paths = require('./paths');
const format = require('./format');

module.exports = {
  ...dom,
  ...color,
  ...paths,
  ...format
};
