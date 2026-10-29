@echo off
setlocal
cd /d "%~dp0"
echo Removing obsolete Smart Folder Import-only files...
if exist "src\modules\amazon\main\smartFolderScanner.js" del /f /q "src\modules\amazon\main\smartFolderScanner.js"
if exist "src\modules\amazon\shared\smartFolderMapping.js" del /f /q "src\modules\amazon\shared\smartFolderMapping.js"
if exist "src\modules\amazon\renderer\smartFolderImport.js" del /f /q "src\modules\amazon\renderer\smartFolderImport.js"
if exist "test\amazonSmartFolder.js" del /f /q "test\amazonSmartFolder.js"
if exist "test\amazonSmartFolderUi.js" del /f /q "test\amazonSmartFolderUi.js"
if exist "UPGRADE_v1.7.11.txt" del /f /q "UPGRADE_v1.7.11.txt"
echo Cleanup complete. No product images or profile files were touched.
endlocal
