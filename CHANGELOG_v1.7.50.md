# BrandForge v1.7.50 - Individual Line Up color drag correction

Base: BrandForge v1.7.49 full project. This patch changes BrandForge Slider only.

## Changed
- Removed the whole-Line-Up-card drag handle from the Slider Maker. A LINEUP 01 group is a static container with 2 or 4 color variants.
- Made **each individual color variant tile** draggable by grabbing anywhere on its non-interactive area, not just the tiny grip.
- Drop one color variant onto another occupied variant to swap their positions; drop on an empty slot to move it. Photo, variant/caption text, and Shadow preference always travel together. The other colors in the group are preserved.
- Horizontal, Vertical and Four Cut modes support independent variant moves within and across Line Up groups.
- PA Vertical consists of one color variant with linked Item + Item Detail. Its Color Name handle moves that ONE linked pair without separating its photos.
- Updated the on-screen instructions, hover affordance, and tests. Text inputs, buttons, and checkboxes are not drag handles.

## Unchanged
- Slider image source upload and existing creative/detail drag/drop.
- New Brand Combine review classification/reorder and JPEG + HTML (+ optional PSD/PSB) export.
- Layout dimensions, gap/spacing, caption font (Hiragino Kaku Gothic Pro W3, 28px), no text removal, and all other BrandForge tools.

## Verification
- `npm run validate` passed with the provided source-based and synthetic tests.
- Real Windows Explorer drag/drop and Photoshop COM exports were not tested in this container.
