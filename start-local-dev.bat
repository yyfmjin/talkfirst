@echo off
REM ============================================================================
REM  TalkFirst - local start (builds the API from CURRENT source first)
REM
REM  Why this exists next to start-local.bat:
REM
REM  start-local.bat runs `node apps/api/dist/main.js`, and `dist/` is a build
REM  artefact that is committed in this repo. So after any change to
REM  apps/api/src, `start-local.bat` silently boots the PREVIOUS build - which is
REM  exactly how a fixed bug can still be "reproducible" after the fix landed.
REM  This script builds first, so `dist/` always matches `src/`.
REM
REM  Difference in one line: this one runs `npm run build -w @talkfirst/api`
REM  before starting anything.
REM ============================================================================
setlocal
cd /d "%~dp0"

REM --- 1. configuration ------------------------------------------------------
REM The API validates its configuration on EVERY start: it refuses to boot with a
REM placeholder JWT secret unless it has been told this is a development process.
REM `NODE_ENV=development` (or ALLOW_INSECURE_DEFAULTS=true) is that statement.
REM `.env` also carries it, and main.ts loads `.env` before validating - this is
REM belt-and-braces for the case where `.env` is missing.
if "%NODE_ENV%"=="" set NODE_ENV=development

if not exist ".env" (
  echo [!] .env not found. Copying .env.example to .env ...
  copy /y ".env.example" ".env" >nul
  echo [!] Review .env before using anything beyond localhost.
)

echo [1/6] PostgreSQL ^(local 5433^)...
if exist "D:\Program Files\working_tools\PostgreSQL-18.1-2\bin\pg_ctl.exe" (
  "D:\Program Files\working_tools\PostgreSQL-18.1-2\bin\pg_ctl.exe" -D "%~dp0.local-data\pgdata" -l "%~dp0.local-data\pg.log" -o "-p 5433" start
) else (
  echo     pg_ctl.exe not found at the usual path - assuming PostgreSQL is already running.
)

echo [2/6] Building API from current source...
call npm run build -w @talkfirst/api
if errorlevel 1 (
  echo [X] API build failed. Nothing was started, so you are not looking at a stale dist.
  exit /b 1
)

echo [3/6] Applying migrations + seed...
call npx prisma migrate deploy --schema prisma/schema.prisma
call npx tsx prisma/seed.ts

echo [4/6] API :4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-api" /min cmd /c "cd /d %~dp0apps\api && node dist/main.js > api-run.log 2>&1"

echo [5/6] Web :3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
call npm run build -w @talkfirst/web
start "talkfirst-web" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/web -- --port 3000"

echo [6/6] Admin :3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
call npm run build -w @talkfirst/admin
start "talkfirst-admin" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/admin -- --port 3001"

echo.
echo Done. If the API is not answering, read apps\api\api-run.log - a
echo configuration refusal is written there, not to this window.
echo.
echo   API    http://localhost:4000/api/v1/health
echo   Web    http://localhost:3000/
echo   Admin  http://localhost:3001/login
echo.
endlocal
