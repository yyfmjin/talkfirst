@echo off
REM ============================================================================
REM  TalkFirst — one-double-click Docker deployment (local)
REM
REM  What this does, in order, and why each step is here:
REM
REM   1. Confirms the Docker daemon is actually running. `docker compose up`
REM      against a stopped Docker Desktop fails with a confusing socket error, so
REM      this says it in plain language instead.
REM   2. Makes sure `.env.docker` exists, seeding it from `.env.docker.local`.
REM      The root package.json's `docker:*` scripts all pass
REM      `--env-file .env.docker`, and that file is git-ignored — so on a fresh
REM      clone every one of those scripts fails (audit S-04).
REM   3. Builds and starts the stack.
REM   4. Waits for the API health endpoint and reports what is actually up.
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo [1/4] Docker daemon...
docker info >nul 2>&1
if errorlevel 1 (
  echo [X] Docker is not running, or the CLI is not on PATH.
  echo     Start Docker Desktop, wait for the whale to settle, then re-run this.
  exit /b 1
)

echo [2/4] Environment file...
if not exist ".env.docker" (
  if not exist ".env.docker.local" (
    echo [X] Neither .env.docker nor .env.docker.local exists. Cannot continue.
    exit /b 1
  )
  copy /y ".env.docker.local" ".env.docker" >nul
  echo     Created .env.docker from .env.docker.local.
  echo     WARNING: it contains throwaway local secrets. Rotate JWT_SECRET and
  echo     JWT_REFRESH_SECRET before this is reachable from anywhere but your PC.
) else (
  echo     Using the existing .env.docker.
)

echo [3/4] Building and starting (this takes a few minutes on the first run)...
docker compose --env-file .env.docker up -d --build
if errorlevel 1 (
  echo [X] docker compose failed. Scroll up for the first error - later output is
  echo     usually just the cascade from it.
  exit /b 1
)

echo [4/4] Waiting for the API to answer on :4000 ...
set API_OK=
for /l %%i in (1,1,60) do (
  if not defined API_OK (
    docker compose --env-file .env.docker ps --format "{{.Service}} {{.Status}}" | findstr /i "healthy" >nul 2>&1
    powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4000/api/v1/health).StatusCode}catch{exit 1}" >nul 2>&1
    if not errorlevel 1 set API_OK=1
    if not defined API_OK timeout /t 5 /nobreak >nul
  )
)

echo.
docker compose --env-file .env.docker ps
echo.
if defined API_OK (
  echo API is answering.
) else (
  echo [!] The API did not answer within ~5 minutes.
  echo     Read the API log - a configuration refusal is written there, not here:
  echo         docker compose --env-file .env.docker logs api
  echo     The two most likely causes, both in .env.docker:
  echo       - NODE_ENV=production with ENFORCE_EMAIL_VERIFICATION=true and no SMTP
  echo       - a JWT_SECRET still containing "change-me"
  echo     Both make the API REFUSE to start on purpose.
)
echo.
echo   Web     http://localhost:3000/
echo   Admin   http://localhost:3001/login
echo   API     http://localhost:4000/api/v1/health
echo.
echo Logs:   docker compose --env-file .env.docker logs -f api web
echo Stop:   docker compose --env-file .env.docker down
echo Reset:  docker compose --env-file .env.docker down -v   (deletes the database)
echo.
endlocal
