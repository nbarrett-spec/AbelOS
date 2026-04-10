@echo off
echo ============================================
echo  Abel Builder Platform - Real Data Import
echo ============================================
echo.
echo IMPORTANT: Close the dev server terminal
echo window FIRST before continuing!
echo.
echo Press any key AFTER you have closed it...
pause >nul

cd /d "%~dp0"
echo.
echo Current directory: %CD%
echo.

echo Importing your real Abel catalog data...
echo (This may take 1-2 minutes, please wait)
echo.
call npx tsx prisma/seed-real-data.ts
echo.

if errorlevel 1 (
  echo.
  echo Something went wrong. See the error above.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  SUCCESS! Your real catalog is loaded.
echo.
echo  Now double-click SETUP_AND_RUN.bat
echo  to start the app again.
echo ============================================
echo.
pause
