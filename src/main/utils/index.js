/**
 * Main Process Utilities - Central Export
 */

const paths = require('./paths');
const git = require('./git');

module.exports = {
  ...paths,
  ...git
};
