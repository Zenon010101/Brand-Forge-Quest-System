"use strict";
// Keep this a dependency-free regression check so it runs with npm validate.
// Interactive button behavior is additionally checked in a Chromium UI test.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../src/modules/amazon/renderer");
const source = fs.readFileSync(path.join(root, "batchWorkspace.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert(source.includes("function deleteGroup(uid)"), "Delete action should target the clicked group UID");
assert(source.includes('remove.addEventListener("click", () => deleteGroup(item.uid))'), "Each group row must have its own Delete action");
assert(source.includes('$("batchRemoveGroupBtn").addEventListener("click", () => deleteGroup(activeUid))'), "Selected Group delete must use the same safe action");
assert(source.includes('if ((item.files.length || item.sharedIds.length) && !confirm('), "Populated groups must require confirmation");
assert(source.includes('groups.splice(index, 1)'), "Delete must remove the virtual product group");
assert(source.includes('activeUid = groups[Math.min(index, groups.length - 1)]?.uid ?? null'), "Active selection must recover after deletion");
assert(source.includes('++previewToken;'), "Deleting the active group must cancel stale previews");
assert(source.includes('renderAll();'), "Deletion must refresh lists, counts, and actions");
assert(source.includes('Original images will remain in the library and on your computer.'), "Confirmation must explain source-image safety");
assert(css.includes('.batch-group-delete'), "Product row delete must be visible/styled");
assert(html.includes('Delete Selected Group'), "Selected Group delete label must be clear");
assert(!source.includes('fs.unlink'), "Product group deletion must not delete source image files");
console.log("PASS Amazon Product Group delete UI wiring, confirmation, active-group recovery and source safety checks");
