# BrandForge v1.7.43 - Changes from v1.7.42

1. `src/shared/photoshopCom.js` - fixed invalid `__bf*` VBScript identifiers, validated COM variable names beginning with a letter, and added a specific VBScript compilation failure message.
2. `test/photoshop2027Bridge.js` - added regression coverage for invalid identifiers and UTF-16LE BOM, plus error output handling.
3. `package.json`, `package-lock.json` - version bump to 1.7.43 (no dependency changes).
4. `README.md`, `docs/PHOTOSHOP_2027_CONNECTION.md` - root cause and verification procedure.

Do not edit or regenerate other modules. Windows Photoshop COM execution remains unverified.
