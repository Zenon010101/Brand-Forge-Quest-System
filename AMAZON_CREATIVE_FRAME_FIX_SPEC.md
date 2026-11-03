# BrandForge v1.7.25 — Amazon full-frame and cut-edge rules

## Source of truth
Original user-supplied `amazonRules(3).js`: 1001px canvas; Image 1 safe area x/y100, size801; Images 2–8 safe area x/y40, size921; cut detection and proportional scaling; four-edge detail cover; JPG quality95.

## Corrected classification
- Transparent assets: detect visible alpha content; trim only external transparent pixels for normal/partial cuts.
- Opaque white isolated product: determine content from actual foreground vs confirmed white background.
- Opaque creative/photo frame: preserve entire original frame when corner patterns indicate a non-white photographic background or consistent white-plus-photo split. Such regions are not disposable padding.
- Four-edge source: never perform inferred tight cropping before scaling.

## Placement
- Image 1: fit uniformly into 801px area; always center; no cut-induced full bleed.
- Images 2–8 without cuts: uniformly fit to 921px area, centered.
- Images 2–8 with 1–3 cuts: proportional fit and slight 4% enlargement, then align detected sides and center other axes.
- Images 2–8 with 4 cuts: use full source and one uniform scale. Near-square artwork uses canvas cover +4%. Strongly portrait/landscape photographic imagery uses canvas contain +4% instead of destroying its composition in a forced square crop. Other four-edge assets use the previous bounded overscan behavior.
- Final JPG and PNG: exactly 1001px, natural canvas viewport clipping only. Off-canvas content remains in a separate complete embedded PNG backing the Smart Object in master PSD.

## Quality gates
- No independent X/Y stretching, content splitting, internal rearrangement or aggressive background segmentation.
- Verify preservation of split white/photographic compositions and beige studio backgrounds.
- Shared ID copies and Colorbox source remain identical to Image 1 final JPG; do not change their processing rules.
- Never open/modify existing brand PSD marker templates on Google Drive.

## Known limit
A rectangular photograph cannot simultaneously retain its entire frame and fill all four sides of a square output. For tall/wide photos, preserve the composition and allow side margins rather than a severe crop.
