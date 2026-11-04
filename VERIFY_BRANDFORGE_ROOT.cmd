@echo off
setlocal
cd /d "%~dp0"
echo BrandForge project root verification
 echo Current folder: %CD%
if not exist "package.json" goto missing_package
if not exist "src\main\main.js" goto missing_main
if not exist "src\main\preload.js" goto missing_preload
if not exist "src\renderer\index.html" goto missing_ui
echo.
echo [OK] Required Electron startup files are present.
echo [INFO] If your usual launcher still shows a missing-file error,
echo        it may be launching from a different folder.
goto end
:missing_package
echo [ERROR] package.json not found. Wrong project folder.
goto end
:missing_main
echo [ERROR] src\main\main.js missing. Extract FULL SOURCE into this folder.
goto end
:missing_preload
echo [ERROR] src\main\preload.js missing.
goto end
:missing_ui
echo [ERROR] src\renderer\index.html missing.
:end
echo.
pause
