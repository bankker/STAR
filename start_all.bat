@echo off
cd /d %~dp0
start "AI Star Studio Server" cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3100
