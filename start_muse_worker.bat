@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"
chcp 65001 >nul
title ZTTeam Muse Reel Worker - t8.goxo.us
cd /d "%~dp0"

echo ========================================================
echo   ZTTeam - Muse Reel Auto Worker (Chrome RPA + VPS)
echo   He thong: https://t8.goxo.us
echo ========================================================
echo.

if not exist "%~dp0node_modules\puppeteer-core" (
    if exist "%~dp0..\t4.goxo.us\node_modules" (
        echo [*] Phat hien node_modules tu t4.goxo.us, dang tao lien ket nhanh...
        powershell -NoProfile -Command "New-Item -ItemType Junction -Path '%~dp0node_modules' -Target '%~dp0..\t4.goxo.us\node_modules' -Force" >nul 2>&1
    )
)

if not exist "%~dp0node_modules\puppeteer-core" (
    echo [*] Dang cai dat thu vien puppeteer-core axios form-data...
    call npm install puppeteer-core axios form-data --no-audit --no-fund
)

set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_PATH%" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if not exist "%CHROME_PATH%" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

echo [1] Kiem tra ket noi Chrome Port 9222...
powershell -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port 9222 -InformationLevel Quiet" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Dang khoi chay Chrome Port 9222...
    start "" "%CHROME_PATH%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\chrome-muse-profile" "https://muse.ai/"
    timeout /t 4 /nobreak >nul
) else (
    echo [OK] Chrome Port 9222 dang chay san sang!
)

echo [2] Khoi dong ZTTeam Muse Worker...
echo.
node scripts/ztteam_muse_worker.js --target=https://t8.goxo.us
pause
