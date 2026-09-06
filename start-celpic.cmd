@echo off
setlocal
cd /d "%~dp0"
node -e "require('node:sqlite')" >nul 2>&1
if errorlevel 1 goto bundled
set "NODE_EXE=node"
goto run
:bundled
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_EXE%" goto run
echo Node.js 24 or later is required. Install Node.js, then run this file again.
pause
exit /b 1
:run
echo CelPic admin - open http://localhost:1018 in your browser.
echo Image port: http://localhost:23133
echo Keep this window open. Press Ctrl+C to stop.
"%NODE_EXE%" server.js
pause
