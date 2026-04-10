@echo off
echo.
echo ============================================
echo  ABEL BUILDER PLATFORM - Deploy Ops Module
echo ============================================
echo.
echo [Step 1/3] Pushing schema changes to database...
echo.
call npx prisma db push --accept-data-loss
echo.
echo -------------------------------------------
echo Step 1 finished. Check above for errors.
echo -------------------------------------------
echo.
echo [Step 2/3] Generating Prisma client...
echo.
call npx prisma generate
echo.
echo -------------------------------------------
echo Step 2 finished. Check above for errors.
echo -------------------------------------------
echo.
echo [Step 3/3] Starting dev server...
echo Once running, go to: http://localhost:3000/ops
echo.
call npm run dev
echo.
echo -------------------------------------------
echo Dev server stopped.
echo -------------------------------------------
pause
