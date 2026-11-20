# BrandForge v1.7.54 — Slider Photoshop 2027 JSX syntax fix

**Base:** BrandForge v1.7.53 (Photoshop 2027 ROT fallback).

## Root cause of user's slider error

The Windows log showed `GetObject=429 / CreateObject=429`, followed by a Windows ROT `InvokeMember` exception: `Photoshop - Error 4: Unterminated string constant. Line: 4060 -> __sliderWriteStatus("ERROR`. That final error demonstrates the ROT fallback **did contact Photoshop** and delivered a Slider worker that Photoshop could not parse.

`src/modules/slider/main/photoshopBridge.js` generated the wrapper using an outer JavaScript template literal containing `"ERROR\n"`. The `\n` was interpreted into a real newline in the **generated** Photoshop JSX, splitting the string across two lines, creating Error 4. This bug did not affect Remove BG because its corresponding wrapper already escaped the backslash correctly.

## Changes

- `src/modules/slider/main/photoshopBridge.js`: Use pure `buildSliderWorkerJsx()` and JSON-stringified error prefix, which emits a valid JSX `"ERROR\n"` string literal. The exact JSX used by the Windows worker can now be tested.
- `src/shared/photoshopCom.js`: If initial COM 429 is followed by a **Photoshop script-execution error** from the ROT path, diagnostic prioritizes the actual JSX rejection instead of incorrectly saying that nothing connected. Real connection failures retain the original COM/ROT guidance.
- `test/sliderJsxSyntax.js` **new**: Parses the entire generated 3,882-line Slider engine + product job + wrapper with Node VM, including Japanese paths and variant captions; asserts success/error receipt writing and safe error classification. This would have detected the v1.7.53 failure.
- `package.json`, `package-lock.json`: Version 1.7.54; `npm run test:slider-jsx` added to full validation.
- README, Slider README, changelog and patch instructions updated.

## Unchanged

Photoshop 2026/2027 connection strategy, ROT fallback safety gates and shared queue, Remove BG, Add Shadow, Slider composition rules, draggable individual colors, Amazon, Combine/JPEG/HTML, outputs, profiles and Arcade.

## QA

Run `npm run validate` and `npm run test:slider-jsx`. Source-level tests can verify correct generated script syntax, but cannot execute Adobe Photoshop 2027 or its Windows COM/ROT API in this environment. On Windows, test one PSD after launching Photoshop 2027.
