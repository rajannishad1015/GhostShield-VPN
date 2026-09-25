@echo off
setlocal enabledelayedexpansion
title GhostShield VPN - Automated Environment Setup

color 0B
echo.
echo  ========================================================================
echo   _______  __                 __     ______  __       __          __       __ 
echo  ^|     __^|^|  ^|--.-----.-----.^|  ^|_   ^|   __ \^|  ^|--.---^|  ^|--.-----^|  ^|     ^|  ^|
echo  ^|  ^|  __ ^|     ^|  _  ^|__ --^|   _^|  ^|__   /^|     ^|  _  ^|     ^|  -__^|  ^|__   ^|  ^|
echo  ^|_____^|  ^|__^|__^|_____^|_____^|____^|  ^|______/^|__^|__^|___._^|__^|__^|_____^|_____^|  ^|__^|
echo.
echo           ENTERPRISE DEFENSE-GRADE TOR PRIVACY GATEWAY SETUP
echo  ========================================================================
echo.

cd /d "%~dp0"

:: -----------------------------------------------------------
:: STEP 1: Administrator Privileges Check
:: -----------------------------------------------------------
echo [*] Step 1/6: Verifying System Privileges...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo     [INFO] Running as standard user.
    echo     [NOTE] Windows Firewall Kill Switch works best when run as Administrator.
) else (
    echo     [OK] Elevated Administrator permissions detected.
)
echo.

:: -----------------------------------------------------------
:: STEP 2: Node.js Environment Verification
:: -----------------------------------------------------------
echo [*] Step 2/6: Checking Node.js Environment...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo     [ERROR] Node.js is not installed or not in system PATH!
    echo     [INFO] Attempting automated installation via winget package manager...
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [*] Installing Node.js LTS via winget...
        winget install OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
        echo     [!] Please restart this script after installation completes.
        pause
        exit /b 1
    ) else (
        echo     [!] Please download and install Node.js v18 or higher from: https://nodejs.org/
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VERSION=%%v
echo     [OK] Node.js is available: %NODE_VERSION%

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo     [ERROR] npm package manager not found! Please repair your Node.js installation.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('npm -v 2^>nul') do set NPM_VERSION=%%v
echo     [OK] npm is available: v%NPM_VERSION%
echo.

:: -----------------------------------------------------------
:: STEP 3: Python Runtime Verification
:: -----------------------------------------------------------
echo [*] Step 3/6: Checking Python Runtime for Registry and Firewall Controls...
set PYTHON_CMD=
where python >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
) else (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set PYTHON_CMD=py
    )
)

if "%PYTHON_CMD%"=="" (
    echo     [WARN] Python was not found in system PATH.
    echo     [INFO] GhostShield requires Python for Registry proxy toggling and Netsh firewall scripts.
    where winget >nul 2>&1
    if !errorlevel! equ 0 (
        set /p INSTALL_PY="    Would you like to install Python 3 automatically via winget? [Y/N]: "
        if /i "!INSTALL_PY!"=="Y" (
            echo     [*] Installing Python 3...
            winget install Python.Python.3.11 -e --silent --accept-source-agreements --accept-package-agreements
            echo     [!] Note: You may need to restart terminal for Python PATH changes to take effect.
        )
    ) else (
        echo     [!] Please download Python from https://www.python.org/downloads/
    )
) else (
    for /f "tokens=*" %%p in ('%PYTHON_CMD% --version 2^>nul') do set PY_VER=%%p
    echo     [OK] Python runtime detected: !PY_VER!
)
echo.

:: -----------------------------------------------------------
:: STEP 4: Install Project Dependencies
:: -----------------------------------------------------------
echo [*] Step 4/6: Installing Node.js Production Dependencies...
echo     Running npm install...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo     [ERROR] npm install encountered an error. Please check your internet connection.
    pause
    exit /b 1
)
echo     [OK] All production dependencies installed successfully.
echo.

:: -----------------------------------------------------------
:: STEP 5: Verify Tor Core Binaries and Directories
:: -----------------------------------------------------------
echo [*] Step 5/6: Validating Tor Core Engine and File Structure...

if not exist "tor_data" (
    mkdir "tor_data" >nul 2>&1
    echo     [+] Created ephemeral directory: tor_data\
)

if not exist "sandbox_profiles" (
    mkdir "sandbox_profiles" >nul 2>&1
    echo     [+] Created sandbox directory: sandbox_profiles\
)

if exist "bin\tor\tor.exe" (
    echo     [OK] Portable Tor Core binary verified: bin\tor\tor.exe
) else (
    if exist "..\tor-ip-changer\tor\tor.exe" (
        echo     [*] Syncing Tor binaries from legacy folder...
        xcopy /s /e /y /q "..\tor-ip-changer\tor" "bin\tor\" >nul 2>&1
        echo     [OK] Portable Tor Core binary linked successfully.
    ) else (
        echo     [WARN] bin\tor\tor.exe not found! Checking system-wide Tor...
        where tor >nul 2>&1
        if !errorlevel! equ 0 (
            echo     [OK] System-wide Tor daemon detected.
        ) else (
            echo     [!] Notice: Ensure Tor is installed or place tor.exe into bin\tor\ directory.
        )
    )
)
echo.

:: -----------------------------------------------------------
:: STEP 6: Desktop Shortcut Creation and Finalization
:: -----------------------------------------------------------
echo [*] Step 6/6: Creating 1-Click Desktop Shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$wsh = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $shortcutPath = Join-Path $desktop 'GhostShield VPN.lnk'; $shortcut = $wsh.CreateShortcut($shortcutPath); $target = Join-Path '%~dp0' 'start_portal.bat'; $shortcut.TargetPath = $target; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.Description = 'GhostShield Enterprise Tor Privacy Gateway'; if (Test-Path '%~dp0public\favicon.png') { $shortcut.IconLocation = '%~dp0public\favicon.png'; }; $shortcut.Save()" >nul 2>&1

if exist "%USERPROFILE%\Desktop\GhostShield VPN.lnk" (
    echo     [OK] 1-Click Desktop Shortcut created: 'GhostShield VPN'
) else (
    echo     [NOTE] Shortcut could not be written to Desktop; start_portal.bat is available in root.
)

echo.
echo  ========================================================================
echo   [SUCCESS] GhostShield VPN Environment Setup Complete!
echo  ========================================================================
echo.
echo   Gateway Server Address: http://localhost:3000
echo   SOCKS5 Inbound Tunnel:  127.0.0.1:9050
echo   HTTP Proxy Inbound:     127.0.0.1:9080
echo   Tor Control Port:       127.0.0.1:9051
echo.

set /p LAUNCH_NOW="Would you like to launch GhostShield VPN right now? [Y/N] [Default: Y]: "
if "%LAUNCH_NOW%"=="" set LAUNCH_NOW=Y
if /i "%LAUNCH_NOW%"=="Y" (
    echo.
    echo [*] Initializing GhostShield Gateway...
    start "" "%~dp0start_portal.bat"
    exit /b 0
)

echo.
echo To launch GhostShield anytime, double-click:
echo   - Desktop shortcut: 'GhostShield VPN'
echo   - Or run: start_portal.bat
echo.
pause
