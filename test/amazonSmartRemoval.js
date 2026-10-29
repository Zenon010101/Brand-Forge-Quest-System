"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const load = relative => fs.readFileSync(path.join(root, relative), "utf8");
const exists = relative => fs.existsSync(path.join(root, relative));
const html = load("src/modules/amazon/renderer/index.html");
const renderer = load("src/modules/amazon/renderer/batchWorkspace.js");
const register = load("src/modules/amazon/main/register.js");
const preload = load("src/main/preload.js");
const css = load("src/modules/amazon/renderer/style.css");
for (const file of [
  "src/modules/amazon/main/smartFolderScanner.js",
  "src/modules/amazon/renderer/smartFolderImport.js",
  "src/modules/amazon/shared/smartFolderMapping.js",
]) assert(!exists(file), `Removed module still exists: ${file}`);
for (const name of ["batchSmartFolderBtn", "smartFolderBackdrop", "smartImportGroupsBtn", "smartMappingInput"])
  assert(!html.includes(name), `Removed Smart Folder UI ID remains: ${name}`);
for (const file of [preload, register])
  assert(!/choose-smart-folder|refresh-smart-folder|chooseSmartFolder|refreshSmartFolder|scanSmartParentFolder/.test(file), "Removed Smart Folder IPC hook remains");
assert(!renderer.includes("window.BrandForgeBatchWorkspace"), "Smart Folder import bridge remains");
assert(!css.includes(".smart-modal-backdrop"), "Smart Folder modal styling remains");
for (const name of ["batchSourcePath", "batchScanFolderBtn", "batchLibraryFilter", "batchImagePool", "batchGroupList", "batchShareImagesBtn", "batchShareModalBackdrop", "batchOrderList", "batchGenerateBtn"])
  assert(html.includes(`id="${name}"`), `Required Amazon control missing: ${name}`);
for (const script of ["../shared/sharingPlan.js", "../shared/batchSharingEditor.js", "../shared/imageFilters.js", "../shared/selectionOrder.js", "batchWorkspace.js"])
  assert(html.includes(`src="${script}"`), `Required Amazon script missing: ${script}`);
assert(register.includes("amazon:scan-image-folder") && preload.includes("scanImageFolder"), "Direct image-path scan must remain");
assert(register.includes("amazon:choose-batch-images") && preload.includes("chooseBatchImages"), "Manual image import must remain");
assert(renderer.includes("selectedPool.values().map(key => pool.get(key)?.path)"), "Pick order must remain");
assert(renderer.includes("openBatchShareModal(item.uid, shareButton)"), "Share Images must remain");
assert(html.includes("Original Folder Mode"), "Original Folder Mode missing");
assert(html.includes('id="batchModeTab"'), "Batch Workspace missing");
console.log("PASS Smart Folder Import removed from UI, renderer, IPC and source; manual scan, filters, ordering, sharing and both Amazon modes retained");
