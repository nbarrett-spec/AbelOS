@echo off
REM ============================================================
REM  ABEL OS — Phase 2 brain-wiring runner (Windows cmd.exe)
REM  Runs every import script in the right order.
REM  Safe to re-run: every script is idempotent.
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo.
echo ============================================================
echo   ABEL OS PHASE 2 - FULL BRAIN WIRE
echo ============================================================
echo.

echo [0/9] Source manifest scan
node scripts\scan-source-manifest.mjs
if errorlevel 1 goto :fail

echo.
echo [1/9] Purchase Orders (InFlow)
node scripts\import-purchase-orders.mjs
if errorlevel 1 echo   WARN: PO import had errors, continuing

echo.
echo [2/9] BOM entries
node scripts\import-bom.mjs
if errorlevel 1 echo   WARN: BOM import had errors, continuing

echo.
echo [3/9] Stock levels
node scripts\import-stock-levels.mjs
if errorlevel 1 echo   WARN: stock import had errors, continuing

echo.
echo [4/9] Builder pricing (InFlow)
node scripts\import-builder-pricing.mjs
if errorlevel 1 echo   WARN: pricing import had errors, continuing

echo.
echo [5/9] Hyphen Brookfield
node scripts\import-hyphen-brookfield.mjs
if errorlevel 1 echo   WARN: Hyphen import had errors, continuing

echo.
echo [6/9] BWP Pulte
node scripts\import-bwp-pulte.mjs
if errorlevel 1 echo   WARN: BWP import had errors, continuing

echo.
echo [7/9] Bolt JSON
node scripts\import-bolt-wos.mjs
if errorlevel 1 echo   WARN: Bolt import had errors, continuing

echo.
echo [8/9] HR payroll
node scripts\import-hr-payroll.mjs
if errorlevel 1 echo   WARN: HR import had errors, continuing

echo.
echo [9/9] Brookfield pricing schedule
node scripts\import-brookfield-pricing.mjs
if errorlevel 1 echo   WARN: Brookfield pricing import had errors, continuing

echo.
echo [LINK] Cross-entity linker
node scripts\link-cross-entities.mjs
if errorlevel 1 echo   WARN: linker had errors

echo.
echo [CHECK] Row counts
node scripts\check-progress.mjs

echo.
echo ============================================================
echo   PHASE 2 COMPLETE
echo ============================================================
goto :eof

:fail
echo.
echo *** FATAL - manifest scan failed, stopping
exit /b 1
