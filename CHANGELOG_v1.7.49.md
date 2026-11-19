# BrandForge v1.7.49 — Slider drag/drop and Line Up ordering

Base: full BrandForge v1.7.48. This changes **BrandForge**, not Rakuten Combine Batch Standalone.

## Added
- Windows Explorer file drops to Creative, Details, and Line Up tabs/lists/sidebars.
- Line Up bulk import that fills cells in order, creating rows without losing images.
- Line Up card handle to reorder entire cards; variant/color handle swaps or moves **photo + color caption + shadow** across slots, with row layout preserved.
- Drag/drop reclassification and ordering in the Slider → New Brand Combine review, plus additional file drops there and Single drop.
- Main-process validation and Explorer file-path resolution via Electron `webUtils.getPathForFile`, with remembered last-image folder.
- Shared, testable row/slot ordering functions; regression tests for 2-cut, 4-cut, vertical, PA Vertical safety, and final Combine handoff.

## Preserved
- JPEG + HTML (+ optional PSD/PSB) New Brand output, font Hiragino Kaku Gothic Pro W3 28px, no text removal.
- Original Slider PSD positioning/sizing, Creative and Details UI, Overview sorting, output folder management.
- Photoshop save logic and all other modules.

## Known verification limits
- JS unit/regression tests run here; a full Electron drag/drop session and Photoshop export need Windows QA.
- Images that are not supported by the installed Photoshop/Sharp versions will be rejected during processing; the drop zone does not convert formats.
