@echo off
echo ============================================
echo   Abel Builder Platform - Setup & Launch
echo ============================================
echo.

cd /d "%~dp0"

echo [1/5] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
)

echo.
echo [2/5] Generating Prisma client...
call npx prisma generate
if %errorlevel% neq 0 (
    echo ERROR: Prisma generate failed.
    pause
    exit /b 1
)

echo.
echo [3/5] Pushing database schema to Neon...
call npx prisma db push
if %errorlevel% neq 0 (
    echo ERROR: Database push failed. Check your .env DATABASE_URL.
    pause
    exit /b 1
)

echo.
echo [4/5] Seeding demo data...
call npx tsx prisma/seed.ts
if %errorlevel% neq 0 (
    echo WARNING: Seed may have partially failed, continuing...
)

echo.
echo [5/5] Starting the app...
echo ============================================
echo   Opening http://localhost:3000 in 10 seconds...
echo   Demo login: demo@abelbuilder.com / Demo1234
echo   Press Ctrl+C to stop the server
echo ============================================
echo.

start "" http://localhost:3000
call npx next dev

pause
