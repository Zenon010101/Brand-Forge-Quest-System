## Individual color variant dragging (v1.7.50)

Horizontal, Vertical and Four Cut Line Up: drag the actual color variant tile to another slot. Occupied slots swap, empty slots move; photo + caption + shadow stay together. A whole Line Up group is not draggable. PA Vertical has one color per linked Item/Item Detail pair, moved by its Color Name grip. Interactive inputs/buttons remain editable instead of starting a drag.

# Slider module

Production Slider Maker module used by the unified app.

Preserved rules:
- 600x600 final canvas
- actual visible/non-transparent pixels determine sizing and positioning
- Lineup ignores transparent source padding
- Cut Detail uses a 600x550 visible area with 50px white at the bottom
- cut-side alignment pushes visible content to the corresponding edge
- editable PSD Main + Shadow sources remain grouped/editable
- existing source Shadow is not normalized independently
- shared generated-shadow values match `src/shared/workflowConfig.js`


## v1.4 lineup modes
- Horizontal = side-by-side standard lineup.
- Vertical = stacked standard lineup.
- PA Vertical = Item 571×280 → Item Detail 571×250 → Color Name 571×50.
- Four Cut = 2×2 lineup.

## v1.7.16 Read-only brand project location linking
Select the G: brand root in the shared panel. The selected SLIDER PSD is a marker for the save directory only; it is never opened, edited, or overwritten. The generated Slider PSD is staged locally, then verified and published to the linked output location with overwrite confirmation/rollback.


## v1.7.27 — Saved PSD handoff

The output folder is required. If no G: project link or output folder has been set, the Generate action prompts for a folder. Photoshop saves an intermediate PSD locally; BrandForge copies and verifies the final PSD at the selected location, closes the intermediate document, and opens the **published PSD** in Photoshop. An unsaved older tab for the same final PSD is not forcibly closed. If re-opening fails, the saved PSD path and warning are shown. The project templates remain location markers only.


## v1.7.30 — Flexible output image count

Slider output item count is **not capped**. Generate with 1, 19, 20, or more items,
subject to Photoshop and system resources. Creative, Lineup, and Detail all
contribute to the displayed output count, and their ordering rules remain intact.
Only an empty job is rejected. This applies both to the Electron Slider interface
and the Photoshop ScriptUI fallback.

## v1.7.32 — Cut Detail maximization

Cut Image (Detail) uses **cover / uniform scaling** against the full 600 x 550
visible area rather than fit-inside. Intentional overflow is hidden by the
existing non-destructive Cut Area clip; the bottom 50px of each 600x600 output
stays white. Left/right/top/bottom cut-edge flags still determine alignment.
Normal Detail (570x530), Creative and Line Up retain their original rules.


## v1.7.54 Photoshop 2027 JSX string-literal hotfix

`runPhotoshopScript()` now generates the entire JSX worker via the pure `buildSliderWorkerJsx()` helper, which safely serializes the status error prefix as a JSON string literal. The prior template literal emitted a raw newline inside `__sliderWriteStatus("ERROR...`) and Photoshop rejected the entire Slider job before running it. `node test/sliderJsxSyntax.js` parses the complete Slider engine+job+wrapper, including Japanese product codes/paths and success/error status writing. The Photoshop 2027 ROT fallback is unchanged.
