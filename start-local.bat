@echo off
setlocal
cd /d "%~dp0"

echo [1/6] Postgres (local 5433)...
"D:\Program Files\working_tools\PostgreSQL-18.1-2\bin\pg_ctl.exe" -D "%~dp0.local-data\pgdata" -l "%~dp0.local-data\pg.log" -o "-p 5433" start

echo [2/6] Migrate + seed...
call npx prisma migrate deploy --schema prisma/schema.prisma
call npx tsx prisma/seed.ts

echo [3/6] Build API from current source...
REM  dist/ is gitignored, so a fresh clone has none; and when it does exist it can be
REM  older than src/. Running `node dist/main.js` without this step means the bugs you
REM  just fixed stay broken, and a freshly cloned repo cannot start at all.
call npm run build -w @talkfirst/api
if errorlevel 1 (
  echo [X] API build failed. Nothing was started, so you are not looking at a stale dist.
  exit /b 1
)

echo [4/6] API :4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-api" /min cmd /c "cd /d %~dp0apps\api && node dist/main.js"

echo [5/6] Web :3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-web" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/web -- --port 3000"

echo [6/6] Admin :3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-admin" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/admin -- --port 3001"

echo Done:
echo   API   http://localhost:4000/api/v1/health
echo   Web   http://localhost:3000/
echo   Admin http://localhost:3001/login
endlocal
