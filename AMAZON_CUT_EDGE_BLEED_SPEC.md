# Amazon cut-edge rendering — BrandForge v1.7.24

- Canvas: 1001 x 1001 px. Normal Image 1 fits 801 x 801; normal Images 2–8 fit 921 x 921.
- Detect visible product pixels excluding external white/transparent background margins. Determine cut sides from the source BEFORE trimming.
- Cut source: use a SINGLE uniform scale and enlarge by 4% beyond the prior relevant target. No independent x/y scaling.
- 1–3 cut sides: align cut sides to corresponding full-canvas edges. Center on free axes. Opposite sides attempt full-canvas reach, limited by safe overscan.
- 4 cut sides: use proportional cover +4% centered in both axes. For extreme aspect ratios, cap requested cover relative to full-canvas contain to avoid destructive large crops (current cap: 1.12 before 1.04 enlargement).
- Preserve genuine white/transparent corners; do not force-fill corners or invent product content.
- The final JPG and its temporary 1001px PNG are canvas-viewports only. Image overflow is allowed and only those viewports are clipped.
- The flat master PSD must embed an independent full-sized, uncropped PNG Smart Object for each overflowing image and place it at the exact off-canvas bounds. Shared IDs reuse the same uncropped data with their own layer names.
- Keep original PSD source files unmodified; Photoshop second-top-level-layer-hide behavior unchanged.
- Keep max 8 images, selected order, Share Images, original JPG naming, optional Colorbox from Image 1, project marker protection, and all non-Amazon modules unchanged.

## Acceptance tests

1. Four-edge near-square image: 1001 view from a centered 1041px image; -20px offsets.
2. Left/right/top/bottom + adjacent cut: relevant cut sides align to canvas; 4% enlargement is proportional.
3. Extreme tall/wide four-edge: bounded overflow; full enlarged Smart Object retains all source edges.
4. Opaque white-background source and transparent cutout detection both work.
5. No-cut sources preserve 801/921 sizing, no extra zoom or overflow.
6. Shared-ID PSD assets point to uncropped full smart-object PNG when required, but the JPG export remains identical across shared IDs.
7. Source files, PSD template markers, Colorbox opt-in, and unrelated modules are unchanged.

Run `npm run test:amazon-cut`, `npm run test:amazon-no-crop`, `npm run test:amazon-bleed`, and `npm run validate`.
