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
