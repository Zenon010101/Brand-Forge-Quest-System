# BrandForge v1.7.57 - Amazon optional workflow and Photoshop browsing fix

Base: complete BrandForge v1.7.56 Amazon PSD Fast Loader release.

## New Amazon functions (both workspace modes)

1. **Clear Amazon**: one confirmation before clearing only the active workspace state. Batch imported pool/IDs/assignments and Folder Mode selections/inputs reset; nothing is deleted from disk, including PSD cache.
2. **Global creative as image #2**: pick a source creative image and enable the checkbox. Image #1 is the user-chosen primary photo; creative becomes Image #2; the previous Image #2 onward shift to #3 onward. All main and shared IDs inherit this order. Max 7 original selected images + 1 creative = 8; duplicate creative files and oversubscribed selections fail preflight instead of silently skipping photos. The creative is processed through the normal Amazon generation pipeline and added to the master PSD.
3. **Optional RK Plain**: copy the exact finished Amazon Image #1 JPEG for each main ID to `idplain.jpg` in the folder containing `PLAIN.psd`. The marker is only a destination indicator, never opened/modified. Search a uniquely matching `SINGLE/RAKUTEN/!!RAK PLAIN!!` directory from a linked brand root, or manually browse to any folder containing PLAIN.psd. Overwrite is guarded; source input and Amazon output files cannot be replaced accidentally. Shared variants do not produce duplicate RK Plain files.
4. **No automatic Photoshop for PSD thumbnails**: previously the Batch Workspace requested Photoshop previews for visible/unassigned PSD files, often repeatedly after filtering. PSD/PSB and other Photoshop-only sources now require explicit file preview. Automatic thumbnail previews whitelist JPG/JPEG, PNG and WEBP and use a Sharp-only IPC path with invalidation when the list/filter changes. Corrupt normal images cannot trigger Photoshop. Selected PSDs still work for preview and Generate, using the existing PSD Fast Loader cache.

## QA and limitations

- `npm run validate` includes all preexisting BrandForge module tests and the two new Amazon extras tests.
- The Amazon extras integration test verifies image order, 8-image guard, shared ID identical JPEG output, exact RK Plain byte copies, marker file intact, safe overwrite, and thumbnail policy. UI wiring test covers both modes and Clear.
- Actual Windows Photoshop 2027, file dialogs, Electron render and Google Drive brand roots were not available for live integration testing. Run an Amazon small-batch smoke test on the target PC before production.

## Changed/new code

- `src/modules/amazon/main/amazonExtras.js` (new)
- `src/modules/amazon/shared/thumbnailPolicy.js` (new)
- `src/modules/amazon/main/register.js`
- `src/modules/amazon/renderer/app.js`
- `src/modules/amazon/renderer/batchWorkspace.js`
- `src/modules/amazon/renderer/index.html`
- `src/modules/amazon/renderer/style.css`
- `src/main/preload.js`
- `test/amazonExtras.js` (new)
- `test/amazonExtrasUi.js` (new)
- `package.json`, `package-lock.json`, `README.md`

All other BrandForge modules are preserved.
