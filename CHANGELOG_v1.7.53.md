# BrandForge v1.7.53 — Photoshop 2027 COM error 429 ROT fallback

**Base:** BrandForge v1.7.52. This is a targeted response to a real Windows
Photoshop 2027 (28.x) report: `GetObject=429 / CreateObject=429`, despite
Photoshop being open. The failure occurs before Remove BG's JSX runs.

## What changed

- Added an **experimental, non-activating Windows Running Object Table (ROT)**
  fallback after and **only after** the standard Photoshop COM launcher exits 52
  with `BRANDFORGE_COM_ERROR`.
- Uses built-in Windows PowerShell and .NET to enumerate *already-running* COM
  objects. It accepts only an object implementing the Photoshop `_Application`
  interface IID and reporting Photoshop 27.x or 28.x, preferring 28.x if both
  are running. It does not create or modify any Windows COM registrations.
- Runs the **existing, identical JSX worker** through the selected object.
  `DoJavaScriptFile` is preferred; `DoJavaScript` / `$.evalFile` is attempted
  only if the first call failed and no completion receipt exists. No duplicate
  work is allowed after a receipt.
- Shared Photoshop task queue still prevents simultaneous workers. The same
  fallback is wired to **Settings > Test Photoshop**, Remove Background and
  Add Shadow, Slider, Amazon, Landing Page, and workflows reusing those bridges.
- Settings shows `attached via Windows ROT fallback` if this path works, along
  with version 28.x, method `rot`, and JSX invocation method.
- If ROT is unavailable or PowerShell is blocked by the company policy,
  **the exact failure is shown** (`BRANDFORGE_ROT_UNAVAILABLE` or
  `BRANDFORGE_ROT_ERROR`) alongside the original 429 error. Fail closed.

## What this does NOT promise

- A Photoshop 2027 instance may **not** publish a usable `_Application` object
  in ROT; in that case the fallback cannot succeed and Adobe/IT repair is
  required. If Photoshop's COM scripting engine is broken, neither ROT nor
  normal ProgID lookup will make it work.
- No automatic conversion to UXP was attempted: Adobe's UXP platform cannot
  directly execute an existing JSX script. The current extensive Photoshop
  PSD tasks rely on JSX and would require a separate migration.
- No actual Windows Photoshop 2027 runtime was available for testing here.
  PowerShell/ROT success is **not verified** until tested on the user's machine.

## Unchanged

The original 2026 COM path and all existing Photoshop JSX algorithms, Remove BG
original-safety checks, Slider/Combine/Amazon/LP layouts, PSD/JPEG/HTML outputs,
folder memory, variant drag-and-drop, History, EXP and Arcade remain unchanged.

## Validation

- `npm run validate` passed all available tests.
- `node test/photoshopRotFallback.js` verifies fallback gating, success
  parsing, failure visibility, no unsafe worker replay, and module wiring
  using mocked Windows process responses.
- Live Windows ROT, PowerShell COM interface dispatch, Photoshop 2027 and
  Photoshop Select Subject still require Windows field QA.
