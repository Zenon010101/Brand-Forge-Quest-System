# BrandForge v1.7.59 — Amazon combined filters / single RK Plain selection

- Removed the optional global Creative upload/control. Instead, import creative PNG files alongside PSD/PSB/JPG and place the creative in the desired position (typically Amazon #2) using the existing image order controls. All eight positions are user-assigned.
- Added PSD/PSB + PNG; PSD/PSB + JPG; PNG + JPG; PSD/PSB + PNG + JPG; and all raster (no PSD/PSB) format filters in Folder Mode and the Batch Workspace import/library selectors.
- Changing Folder Mode source filters is now display-only; it does not deselect previously assigned images or alter image order. Batch Workspace filtering remains display-only.
- RK Plain now requires exactly one manually specified Product ID in the new RK ID field. It uses that successful ID's finished Amazon JPG #1, saving only `<id>plain.jpg` next to the PLAIN.psd marker. Shared IDs can be chosen as the single RK target, but are not copied by default. Normal Amazon and Colorbox output for all IDs is unchanged.
- Invalid/missing RK target reports RK Plain as skipped with a clear message; it never changes successfully generated Amazon JPGs.
- Existing Photoshop handling, PSD fast cache, linked brand folder discovery, and original assets remain unchanged.

Automated validation: `npm run check`, `node test/amazonCombinedFiltersOneRk.js`, `node test/amazonExtrasUi.js`, `node test/amazonRkPlainAssignmentUi.js`, `node test/amazonBatchUi.js`, `node test/amazonBatchWorkspace.js`, `node test/amazonBatchVisibility.js`, and `node test/amazonExtras.js`.
Windows G: folder linkage and Photoshop 2027 must still be verified on the user machine.
