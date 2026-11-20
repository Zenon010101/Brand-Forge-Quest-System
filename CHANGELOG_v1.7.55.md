# BrandForge v1.7.55 — Photoshop Compatibility Manager

**Based on:** v1.7.54, including the working Photoshop 2027 COM/ROT recovery and the Slider JSX string fix.

## New Settings panel

- **Photoshop Compatibility Manager** under Settings. Automatically performs a quick scan when the Settings page initializes on each application launch.
- **Scan Installed + Check Scripts**: read-only Windows registry/Program Files scan, plus Node syntax validation of actual module JSX sources. Slider also validates the fully generated engine/worker to catch malformed JavaScript string literals before Photoshop runs. Amazon Photoshop generation is dynamic, so its scan explicitly states PARTIAL source coverage.
- **Run Photoshop Live Test**: tests COM/ROT + the real Photoshop JSX invocation, then creates a **temporary** 128px Photoshop document, layer and text. Saves temporary PSD/JPEG, tests Smart Object placement, closes it without saving changes to open documents, restores the previous document, and removes all scratch files. The shared Photoshop task queue avoids overlaps with BrandForge's production jobs.
- Displays detected registered Photoshop.exe, installations, last verified working Photoshop version and module preflight statuses. New-version warnings are based on changed registered executable path, executable modification time/size, or different detected version.
- Stores `photoshop-compatibility-settings.json` and `photoshop-compatibility-report.txt` in the existing Electron `userData` folder, separate from profiles and History/EXP. Uses atomic file writes.
- **Require Photoshop version**: Auto / 2026 (27.x) / 2027 (28.x). The version selection is a *guard*: Photoshop jobs refuse to run in the wrong detected major version before JSX execution. It **does not switch versions, install Photoshop, modify Windows registry, or change COM registration**. The safe ROT attach can look for a compatible running object of the chosen major.
- **Use Last Working** selects the major version from the last successful live preflight, when still supported. This does not start or activate that version.
- **Open Compatibility Report** includes per-module status, detailed connection errors, the scratch-test stage, version-change warnings and next steps.

## What stays unchanged

Remove BG + Add Shadow logic, Slider Maker layouts and color dragging, Amazon PSD generation, Combine JPEG/HTML/PSD, LP outputs, templates, image folders, Arcade, local profiles, EXP/History, and the previously fixed Photoshop 2027 script wrapper.

## Important limits

- A green **PREFLIGHT PASSED** means the script parser, Photoshop connection, basic temporary-document commands and scratch PSD/JPEG/Smart Object steps succeeded; it does **not** mean Select Subject, a production Slider, an Amazon master PSD, or all module-specific effects have been exercised. Run one actual product for every module after updates.
- The manager cannot repair Adobe's COM registration, force-install a Photoshop version, guarantee compatibility with future major releases or run a UXP plugin. Future major versions require validation and, if needed, a tested adapter update.
- The tests provided in this ZIP are mocked/Node tests on non-Windows. A real Windows Photoshop 2026/2027 live test must be performed by the user.

## QA

`npm run test:photoshop-compat-manager` checks version guarding, no risky task replay, real source JSX parsers, last-known working persistence, update fingerprint warnings, mocked COM/ROT probes, saved reports and Settings UI controls. `npm run validate` includes this suite as well as all prior regressions.
