@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Postgres (local 5433)...
"D:\Program Files\working_tools\PostgreSQL-18.1-2\bin\pg_ctl.exe" -D "%~dp0.local-data\pgdata" -l "%~dp0.local-data\pg.log" -o "-p 5433" start

echo [2/5] Migrate + seed...
call npx prisma migrate deploy --schema prisma/schema.prisma
call npx tsx prisma/seed.ts

echo [3/5] API :4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-api" /min cmd /c "cd /d %~dp0apps\api && node dist/main.js"

echo [4/5] Web :3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-web" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/web -- --port 3000"

echo [5/5] Admin :3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3001.*LISTENING"') do taskkill /F /PID %%p >nul 2>&1
start "talkfirst-admin" /min cmd /c "cd /d %~dp0 && npm run start --workspace @talkfirst/admin -- --port 3001"

echo Done:
echo   API   http://localhost:4000/api/v1/health
echo   Web   http://localhost:3000/
echo   Admin http://localhost:3001/login
endlocal
