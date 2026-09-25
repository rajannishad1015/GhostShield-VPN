@echo off
setlocal enabledelayedexpansion
title GhostShield Tor Privacy Portal

echo ===================================================
echo     GHOSTSHIELD - TOR VIRTUAL IP PRIVACY PORTAL
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/3] Cleaning up any old instances...
:: Kill any existing process on port 3000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo Freeing port 3000 ^(PID: %%a^)...
    taskkill /f /pid %%a >nul 2>&1
)
taskkill /f /im tor.exe >nul 2>&1

echo [2/3] Starting Tor Engine and Web Server...
:: Open browser after 3 seconds in background
start "" /b cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3000"

echo [3/3] Portal is live at http://localhost:3000
echo Press Ctrl+C to stop the portal.
echo.

:: Start Node.js server
node server.js

pause
