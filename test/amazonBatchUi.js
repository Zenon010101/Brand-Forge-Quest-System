'use strict';
// This minimal smoke test checks whether new-folderless mode is the selected
// view in the shipped Amazon page, without relying on real Photoshop.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../src/modules/amazon/renderer/index.html'), 'utf8');
const script = fs.readFileSync(path.resolve(__dirname, '../src/modules/amazon/renderer/batchWorkspace.js'), 'utf8');
const dashboard = fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.html'), 'utf8');
assert(html.includes('id="folderModeContent"') && html.includes('folder-mode-view hidden'), 'Folder Mode must not be the initially visible view');
assert(html.includes('id="batchModeContent"') && html.includes('<div class="batch-mode-view" id="batchModeContent">'), 'Batch Workspace must be initially visible');
assert(html.includes('id="batchModeTab"') && html.includes('aria-pressed="true"'), 'Batch tab must be initially selected');
assert(script.includes('setMode("batch");'), 'Batch mode must initialize even after the renderer loads');
assert(script.includes('mode === "folder"') && script.includes('mode === "batch"'), 'Both modes must remain selectable');
assert(dashboard.includes('Open folderless workspace'), 'Dashboard must show the new primary workflow');
console.log('PASS Batch Workspace opens by default, original Folder Mode remains accessible, Dashboard reflects new flow.');
