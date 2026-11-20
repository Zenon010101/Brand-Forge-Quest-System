# BrandForge v1.7.52 — Photoshop 2027 compatibility hardening

**Base:** user-uploaded `brandforge latest.zip`, whose `package.json` reports v1.7.50.
This is a fresh compatibility patch to that upload, **not** a patch against the
separately delivered v1.7.51 Photoshop-2026-only branch.

## Photoshop automation updates

1. **Photoshop 2026 AND 2027:** Both versions are allowed through the shared
   `Photoshop.Application` COM bridge. The Windows-registered Photoshop version
   is used when no running compatible COM object is available. No hard-coded
   unregistered `.2027` ProgID and no registry modifications.
2. **Safer JSX invocation on 2027:** Use `DoJavaScriptFile` first; if it raises
   a COM error *before the worker has written its status file*, try
   `DoJavaScript` with `$.evalFile(new File(...))` once. If a receipt exists,
   never retry the same task to avoid duplicate exports or destructive edits.
   This fallback cannot bypass Photoshop's broken COM registration.
3. **Single Photoshop task queue across modules:** Serializes Remove BG,
   Add Shadow, Slider, Amazon/Colorbox, LP/Folder LP, Combine (including
   previews/cleanup where routed through the shared bridge), and Settings
   connection tests, reducing active-document interference and clashes in
   application-wide Photoshop preferences.
4. **Unicode-safe generated scripts:** All generated worker `.jsx` files now
   use UTF-8 BOM for Japanese variant text, usernames, and file paths. VBScript
   launchers remain UTF-16LE with BOM.
5. **Unified result processing:** Remove BG and Landing Page now use the same
   cscript runner as Slider, Amazon and Settings. Exit codes, stdout/stderr,
   timeouts, and worker status are handled consistently. Slider also captures
   unexpected JSX exceptions, not just the expected generator status.
6. **More precise Settings > Test Photoshop:** Shows actual Photoshop version,
   attached/created connection, the successful JSX invocation method and a
   diagnostic report. 28.x is no longer described as the only Photoshop target.

## Remove BG compatibility

For opaque images, Photoshop's Select Subject `autoCutout` still runs only on
**a disposable duplicate**, not the original. If the existing descriptor
fails or returns empty/full-canvas selection, try the same native action with
an empty descriptor once. If both fail, keep the original untouched, do not
publish an opaque PNG, and return both Photoshop error details.

The Photoshop AI selection engine is owned by Adobe; these changes do not
promise accurate segmentation of every product or repair a broken 28.x GPU/
Cloud/model installation. Continue checking PNG transparency before Add Shadow.

## Unchanged

Original file safety, creative/layout image geometry, Slider Line Up color drag,
New Brand Combine JPEG/HTML, Amazon shared images, LP and Combine 2-column
rules, location markers, folder memory, profile/history/EXP, and Arcade.

## Tests / limitation

- `npm run validate`: tests of all original modules and new compatibility tests.
- `npm run test:photoshop-2027-compat`: receipt-safe fallback and Unicode,
  cross-module task serialization, mock COM response, module wiring.
- `npm run test:remove-bg-jsx`: failure and recovery simulations.
- Photoshop 2027 itself, live Windows COM, Photoshop GPU/Cloud Select Subject,
  and Photoshop output PSD/PSB **not run in this Linux test environment**.

Follow `docs/PHOTOSHOP_2027_COMPATIBILITY_v1.7.52.md` for PC verification.
