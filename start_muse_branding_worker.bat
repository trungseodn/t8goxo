@echo off
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"
chcp 65001 >nul
title ZTTeam Muse Branding Worker (Port 9245) - t8.goxo.us
cd /d "%~dp0"

echo ========================================================
echo   ZTTeam Muse Branding Worker - Avatar va Cover (Port 9245)
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

node scripts/ztteam_muse_branding_worker.js --target=https://t8.goxo.us --chrome-port=9245 --worker-name=Branding-9245
pause
