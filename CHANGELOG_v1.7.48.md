# BrandForge v1.7.48 — Slider -> Create Combine for New Brand

**Base:** v1.7.47 full project. Only BrandForge source is modified.

## New workflow

- Slider Maker footer: **CREATE COMBINE FOR NEW BRAND** opens a review section.
- Import current Slider Line Up, Detail and Creative images in source order. Slider Line Up groups (2, vertical, 4-cut) are expanded into individual variation source photos, with their existing variant text. Slider Detail/Creative are suggested as Details. For PA Vertical, the second photo is a Detail suggestion.
- Users may change Line Up/Details classifications, reorder, adjust color captions, choose horizontal dual/vertical combined photo modes, and upload Single manually.
- The reviewed output uses the existing BrandForge Combine planner and its unchanged layout dimensions (600 canvas, Single 15px gap, 293px two columns, 8/7px gaps, 28px Hiragino Kaku Gothic Pro W3 captions, DETAILS heading).
- No OCR text removal or source modification. Source photos with already-printed color names can leave the additional caption blank.
- Save location selected via native directory dialog; last Single and output directories remembered in Electron userData/dialog-state.json. Output filenames version safely.
- JPEG + adjacent HTML output created and verified directly with Sharp, independent of Photoshop. Optional layered PSD/PSB export using original BrandForge Combine JSX. If optional PSD fails, JPEG/HTML are retained and an explicit warning is shown. Tall JPEGs are segmented into 18,000px strips, with matching HTML rows.
- HTML is a Rakuten-friendly table-only fragment (no iframe or CSS), using local relative JPEG names by default. Optional HTTPS base URL creates publishable image src links, but files must be separately uploaded to that host.

## Source changes

- `src/modules/slider/main/combineFromSlider.js` — NEW detection/handoff, direct JPEG, HTML, optional PSD pipeline.
- `src/modules/slider/main/register.js` — NEW slider-specific dialogs, remembered folders, IPC/progress, history/EXP.
- `src/main/preload.js` — safe bridge methods for the New Brand workflow.
- `src/modules/slider/renderer/index.html`, `style.css`, `combineNewBrandUi.js` — review UI with Single, Line Up, Details, captions, reorder, output location.
- `src/modules/combine/main/planner.js` — opt-in blank captions for Slider handoff only (normal Combine constraints unchanged).
- `src/modules/combine/jsx/compose.jsx` — Hiragino Kaku Gothic Pro W3 captions when Photoshop font is installed, skip omitted labels.
- `test/sliderNewBrandCombine.js`, `test/sliderNewBrandUi.js` — regression tests.
- `package.json`, `package-lock.json`, `README.md` — version and guidance.

## Validation limitations

Automated tests cover source-to-section mapping, true generated 600px JPEG + HTML, safe name versioning, no-captions, and an optional PSD failure preserving JPEG/HTML. Windows Electron/Photoshop and installed Hiragino font have not been verified here.
