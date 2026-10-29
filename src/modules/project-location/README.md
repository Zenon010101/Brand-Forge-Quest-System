# Brand Project Paths (v1.7.17)

Shared, read-only PSD/PSB marker discovery for the Amazon, Slider and Colorbox destinations.

## Actual production folder layout

```text
G:\Shared drives\...\Propper #DOT365\
  COLORBOX\
    Colorbox Template.psd             <- COLORBOX destination
  SLIDER\
    AMAZON [single and slider]\
      Amazon Template.psd              <- AMAZON JPG + master PSD destination
    SLIDER-IMAGES\
      code\                            <- unrelated, not scanned for marker PSDs
      psd\
        Slider Template.psd            <- SLIDER PSD destination
```

- The resolver recognizes capitalization variations as well as `AMAZON (single & slider)` and `SLIDER_IMAGES`.
- Alternative conventional `SLIDER/AMAZON/single and slider` is also accepted.
- Legacy locations (`SLIDER/AMAZON`, `AMAZON`, and `SLIDER` root) remain available as fallbacks.
- When a marker is found in both a specific nested folder and a legacy folder, prefer the specific nested folder.
- Multiple candidate markers in the same priority category are not guessed unless exactly one is recognizably named `Template`.
- The UI displays the FULL resolved output folder for verification before `Use Detected Paths`.
- No recursive folder traversal, and no templates are opened or edited.
- The D: raw-image location has no effect on G: destination detection.
- The selected PSD marker is protected from accidental generated-PSD overwrite.
- Link state remains in Electron userData, not on the shared drive; previously linked projects are rescanned each time.
- Original Amazon, Share Images, cut-side detection, master PSD, optional Colorbox and Slider output rules remain unchanged.
- To use the new paths with a project linked in v1.7.16, click `Detect Folders` and `Use Detected Paths` again; old links are revalidated and may still point to a legacy location until relinked.
