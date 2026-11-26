# BrandForge v1.7.58 - Linked RK Plain and Explicit Main Assignment

Base: **BrandForge v1.7.57** full source archive.

## RK Plain is a fourth linked G: brand location

- The shared Google Drive project locator now scans **Amazon, Slider, Colorbox, and RK PLAIN**.
- Select the brand's project root, e.g. `G:\Shared drives\Design Team - Single and Six 2026\11. NOVEMBER\CLARKS #QLT244`.
- RK Plain looks only for `SINGLE\RAKUEN\!!RAK PLAIN!!\PLAIN.psd` beneath that brand root. The alternative spelling `RAKUTEN` is also supported. Matching is case-insensitive and tolerates `!!` punctuation.
- No full G: drive recursion. Only **exact PLAIN.psd** is a valid marker; unrelated PSDs in the same directory cannot become markers.
- A unique folder is displayed in the same **Detect Folders > Use Detected Paths** list as the other roles, and automatically populated in Amazon's RK Plain field. Existing v1.7.57 linked projects automatically pick up the role when the new marker is unique, without modifying the saved source data.
- Two competing PLAIN.psd folders are ambiguous: the app does NOT guess. Use the project role dropdown or choose the RK Plain folder explicitly.
- `PLAIN.psd` is a **read-only location marker**. RK Plain saves `idplain.jpg` beside it. It never opens, edits, copies over, or renames the template PSD.
- When switching to a different brand, the RK Plain path is reset so images cannot silently go to the previous brand. Manual Amazon output also clears the old RK location.

## Per-ID Main Image #1

- **Batch Workspace:** Choose a Product ID, pick one library image and click **Set First Pick as Main #1**, or click **Set Main #1** beside an already-assigned image in that ID's order list. The active Product ID visibly shows `Main #1: filename`.
- **Original Folder Mode:** Each variant's file list now has **Set Main #1**. Selecting it moves that item to the first Amazon output slot.
- Main assignment is sent to the backend as `mainPath` per ID and validated against its actual images. A mismatched Main source fails validation instead of silently using the wrong image.
- The final chosen Main #1 is the **actual finished Amazon Image #1** (1001x1001) reused for Colorbox and RK Plain. If Creative is enabled, it is inserted at Image #2, never first.
- **Every successfully exported ID**, including shared IDs, now receives its own `idplain.jpg` in the RK Plain folder; shared IDs inherit the source ID's main image, just as they inherit Amazon image order. For a different Main image under a shared ID, create its own product group instead.
- Up to eight Amazon images per ID; previous no-crop/PSD generation, sharing and PSD Fast Loader continue unchanged.

## Verification

- `npm run test:amazon-rk-plain` covers exact `#QLT244` brand hierarchy; automatic/migrated RK marker role; explicit main reordering; shared-ID images; optional Creative as #2; byte-for-byte RK Plain copies; template integrity; multiple-marker ambiguity; UI wiring.
- `npm run validate` covers existing BrandForge modules plus the new tests.
- No live G: drive, Photoshop 2027 or Windows Electron available in this environment. A small real-brand test is necessary before full production.
