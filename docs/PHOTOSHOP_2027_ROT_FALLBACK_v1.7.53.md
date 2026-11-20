# Photoshop 2027 / Error 429 — ROT fallback technical notes

When `GetObject(, "Photoshop.Application")` and
`CreateObject("Photoshop.Application")` both raise ActiveX error 429,
Photoshop may be running without an active ProgID registration. BrandForge
v1.7.53 tries a second, non-activating way to locate a live COM scripting
object through Windows' Running Object Table (ROT). This can recover a mismatch
between the ProgID and the live object, *not* a missing Photoshop automation
object. It is experimental and may not work on the user's particular 28.x build.

### Transport and safety

1. The existing VBS launcher runs first, unchanged.
2. Only exit code 52 plus `BRANDFORGE_COM_ERROR` enables ROT fallback.
3. BrandForge invokes locally installed Windows PowerShell in STA, using the
   bundled `src/shared/photoshopRot.ps1` program text. JSX and receipt paths
   are passed in environment variables, not interpolated into command strings.
4. The PowerShell program uses a .NET P/Invoke to enumerate ROT. It accepts only
   objects implementing Photoshop's scripting `_Application` COM IID and
   providing a 27.x or 28.x version. When both are found, 28.x is preferred.
5. It uses the *same* temporary JSX worker/receipt and the *same* existing
   Photoshop task queue. If a worker wrote a receipt, no fallback replays it.
6. The shared backend checks the resulting status file before treating any task
   as successful. Error 429 and ROT failure details are retained together.
7. No registry writes, admin rights, COM class registration, third-party
   executable installation, or execution-policy bypass.

### Field verification on Windows

- Close Photoshop 2026, launch Photoshop 2027, then BrandForge.
- Run `Settings > Test Photoshop`.
- Success on alternate path: Version starts `28.`, Method `rot`,
  Invocation `ROT-DoJavaScriptFile` or `ROT-DoJavaScript-evalFile`, JSX OK.
- If COM still fails, `Settings > Open Diagnostics` should show *both*
  `BRANDFORGE_COM_ERROR` and either `BRANDFORGE_ROT_UNAVAILABLE` or
  `BRANDFORGE_ROT_ERROR`.
- A plain PowerShell command outside BrandForge may also check whether Windows
  can create Photoshop's COM server:

  ```powershell
  try { $ps = New-Object -ComObject Photoshop.Application; $ps.Version }
  catch { "COM 429 or other error: $($_.Exception.Message)" }
  ```

If **both** COM and ROT fail, an Adobe/Windows issue (or a restricted Windows
PowerShell environment) remains. Repair/update Photoshop via Creative Cloud
with IT or temporarily use the working 2026 version. This is not a Select
Subject/Remove BG failure and should not be bypassed with repeated worker
retries or destructive file operations.

Adobe's UXP framework does not offer a direct way to execute legacy JSX scripts
from a plugin. A future native UXP path would need a separate task engine.
