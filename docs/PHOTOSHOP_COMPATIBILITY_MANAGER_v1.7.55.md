# BrandForge Photoshop Compatibility Manager — architecture

## Why this exists

Photoshop updates may change Windows COM activation, ROT exposure or a specific JSX command. In earlier releases, 2027 COM error 429 required the ROT recovery in v1.7.53, followed by an unrelated malformed Slider JSX string fixed in v1.7.54. The manager detects different failure *stages* rather than treating every Photoshop problem as a COM error.

## Connection and safety architecture

```
BrandForge Settings
    |-- Quick Scan (no Photoshop task)
    |   |-- Windows ProgID / LocalServer32 query (read-only)
    |   |-- Standard Adobe Photoshop.exe discovery
    |   |-- Executable path + mtime/size vs. last live pass
    |   `-- Module JSX/worker syntax checks (Node VM; no execution)
    |
    |-- Opt-in Live Test (uses global Photoshop task queue)
    |   |-- GetObject / CreateObject + JSX status receipt
    |   |-- Safe ROT fallback after COM 429 or wrong-version guard
    |   `-- Temporary scratch document (new -> layer -> text
    |       -> save scratch PSD/JPEG -> Place Embedded -> close/discard)
    |
    `-- Version guard: Auto | 27.x | 28.x
        |-- Checks Photoshop.Version before running any job JSX
        `-- ROT candidate must match selected major
```

## Code locations

- `src/modules/settings/main/compatibilityManager.js`: source inventory, static JSX checks, scratch probe, history, report writing and update warnings.
- `src/shared/photoshopVersionPolicy.js`: shared in-process target major guard. Set when preferences are read from Electron userData and changed through Settings IPC.
- `src/shared/photoshopCom.js`: stops a mismatched COM version before JSX, and only then permits the version-filtered ROT fallback. Existing receipt checks prevent re-running an already started production JSX.
- `src/shared/photoshopRot.ps1`: read-only running-object enumeration; matches Photoshop `_Application` IID and requested 27/28 major. No arbitrary ROT objects.
- `src/modules/settings/main/register.js`: IPC endpoints, guarded preference persistence and existing Test Photoshop feature.
- `src/main/preload.js`: limited IPC API. The renderer cannot read/write app files directly.
- `src/renderer/compatibilityUi.js`: Settings UI (user-provided paths/errors are rendered via `textContent`, not HTML).
- `src/renderer/index.html` / `src/renderer/style.css`: Settings panel.
- `test/photoshopCompatibilityManager.js`, `test/photoshopCompatibilityManagerUi.js`: test coverage, including no process-level Photoshop requirement.

## Health definitions

- `STATIC_CHECK_PASSED`: actual JSX syntax parses and installation/registry inventory exists (may be empty). No Photoshop execution occurred.
- `PREFLIGHT_PASSED`: static checks + Photoshop connection/JSX + verified *temporary* PSD/JPEG/Smart Object operations. Does **not** certify real product outputs.
- `FAILED`: a syntax, connection or scratch operation failed. Do not run production batches before investigation.
- Amazon source is marked `PARTIAL` because its Photoshop JSX is composed dynamically. A real Amazon product job is mandatory after changes.
- Select Subject AI, textured shadows, actual Slider/JPEG layouts and per-brand font availability cannot be safely certified using an empty scratch document.

## Version change handling

- The last successful version, method, registered path, executable mtime/size and timestamp are saved in `photoshop-compatibility-settings.json` under Electron userData.
- The next Settings initialization runs a **quick** scan; changed path or executable fingerprint triggers an update warning. A full Live Test also identifies version changes.
- With an explicit 27/28 preference, `buildComConnectVbs()` stops before running JSX if `Photoshop.Version` is wrong. If a suitable *running* ROT object exists, BrandForge can use that instead. If none exists, it fails with a clear version mismatch and leaves output files untouched.
- BrandForge **does not** force COM registration to an older version, install updates, alter permissions, disable security tools or launch an arbitrary Photoshop executable. Selecting a version is not an application switcher.
- UXP migration is a separate future engineering project and is **not** part of this release.

## Windows acceptance tests

1. On Photoshop 2027, with the right version selected, test connection, scratch PSD/JPEG/Smart Object and inspect `photoshop-compatibility-report.txt`.
2. Test one actual Remove BG image (AI cutout), Add Shadow, Slider with Japanese captions, Amazon master PSD, Combine with HTML and PSD, and LP (if used).
3. If 2026 and 2027 are both installed, select the wrong version intentionally and verify a friendly pre-script version mismatch, not accidental writes to the wrong Photoshop.
4. Repeat after an Adobe update and confirm executable version/fingerprint warnings, then rerun the live smoke test.
5. Verify no changes to user source images, no scratch documents left open, no administrator/registry operations, and no changes to history/EXP.
