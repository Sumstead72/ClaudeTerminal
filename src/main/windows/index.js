/**
 * Windows Module - Central Export
 */

const MainWindow = require('./MainWindow');
const QuickPickerWindow = require('./QuickPickerWindow');
const TrayManager = require('./TrayManager');

module.exports = {
  ...MainWindow,
  ...QuickPickerWindow,
  ...TrayManager
};
