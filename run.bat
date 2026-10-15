@echo off
rem ============================================================================
rem  Tokri - one-command production run
rem ============================================================================
rem
rem  Builds both apps and starts them the way they would run on a server:
rem  `next start` against a real .next build, `node dist/main` against a real
rem  nest build. Not dev mode - no watchers, no on-demand compilation.
rem
rem  WHAT THIS STARTS FROM DOCKER, AND WHAT IT DOES NOT
rem  --------------------------------------------------
rem  docker/docker-compose.yml defines mongo, redis and mongo-express. This
rem  script starts REDIS ONLY, unless MONGO_URI actually points somewhere
rem  local. The deployed database is MongoDB Atlas, so booting the compose
rem  mongo would run a second database that nothing connects to - half a gig
rem  of RAM and a replica-set election, for nothing. The script reads
rem  MONGO_URI and decides; it does not assume.
rem
rem  Redis is genuinely optional too: without it realtime still works on one
rem  machine, it just cannot cross API replicas. So a Docker daemon that is
rem  not running is a WARNING here, never a failure.
rem
rem  Usage:   run.bat              build, then start
rem           run.bat --no-build   skip the build, start what is already built
rem           run.bat --stop       stop everything this script started
rem ============================================================================

setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"

set "ROOT=%CD%"
set "API_PORT=4000"
set "WEB_PORT=3000"
set "COMPOSE=docker\docker-compose.yml"
set "DO_BUILD=1"

for %%A in (%*) do (
    if /I "%%~A"=="--no-build" set "DO_BUILD=0"
    if /I "%%~A"=="--stop"     goto :stop_everything
    if /I "%%~A"=="--help"     goto :usage
    if /I "%%~A"=="-h"         goto :usage
)

echo.
echo  ===========================================================
echo   TOKRI - build and run
echo  ===========================================================
echo.

rem ---------------------------------------------------------------------------
rem  1. Preflight. Fail LOUDLY and early - the whole project is built on the
rem     rule that a missing credential stops the process rather than being
rem     papered over, and this script holds the same line.
rem ---------------------------------------------------------------------------
echo  [1/7] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo        ERROR: node is not on PATH. Install Node.js 20+ and retry.
    goto :fail
)
for /f "delims=" %%V in ('node --version') do echo        node    %%V

where pnpm >nul 2>&1
if errorlevel 1 (
    echo        ERROR: pnpm is not on PATH.
    echo        This is a pnpm workspace - npm and yarn will not resolve
    echo        the @mandi/* packages. Install it with:  npm i -g pnpm
    goto :fail
)
for /f "delims=" %%V in ('pnpm --version') do echo        pnpm    %%V

if not exist "apps\api\.env" (
    echo.
    echo        ERROR: apps\api\.env is missing.
    echo        The API validates every secret at boot and refuses to start
    echo        without them - there are no fallbacks anywhere in the code.
    echo        Copy apps\api\.env.example and fill it in.
    goto :fail
)
if not exist "apps\web\.env.local" (
    echo.
    echo        ERROR: apps\web\.env.local is missing.
    echo        Copy apps\web\.env.example and fill it in.
    goto :fail
)
echo        .env    both present

rem ---------------------------------------------------------------------------
rem  2. Free the ports. A dev server killed by the OS often leaves the node
rem     process alive and still holding its port, so the next start dies with
rem     EADDRINUSE and no obvious cause. Clear them deliberately.
rem
rem     Get-NetTCPConnection rather than netstat+findstr: findstr ":3000"
rem     also matches a REMOTE port 3000 and would kill the wrong process.
rem ---------------------------------------------------------------------------
echo.
echo  [2/7] Freeing ports %WEB_PORT% and %API_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($p in %WEB_PORT%,%API_PORT%) {" ^
  "  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue;" ^
  "  if ($c) {" ^
  "    foreach ($procId in ($c.OwningProcess | Select-Object -Unique)) {" ^
  "      $n = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName;" ^
  "      Write-Host ('        freed ' + $p + ' (was PID ' + $procId + ' ' + $n + ')');" ^
  "      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }" ^
  "  else { Write-Host ('        port ' + $p + ' already free') } }"

rem ---------------------------------------------------------------------------
rem  3. Infrastructure. Redis always; mongo only if MONGO_URI is local.
rem ---------------------------------------------------------------------------
echo.
echo  [3/7] Infrastructure...

set "NEED_MONGO=0"
findstr /R /C:"^MONGO_URI=.*localhost" /C:"^MONGO_URI=.*127\.0\.0\.1" "apps\api\.env" >nul 2>&1
if not errorlevel 1 set "NEED_MONGO=1"

if "%NEED_MONGO%"=="1" (
    echo        MONGO_URI is local - starting mongo + redis
    set "SERVICES=mongo redis"
) else (
    echo        MONGO_URI is remote ^(Atlas^) - starting redis only
    set "SERVICES=redis"
)

docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo        WARNING: the Docker daemon is not responding.
    echo        Start Docker Desktop if you want Redis.
    echo.
    if "%NEED_MONGO%"=="1" (
        echo        MONGO_URI points at a LOCAL mongo that is not running.
        echo        The API cannot start without a database - stopping here.
        goto :fail
    )
    echo        Continuing without Redis. The app runs fine on one machine;
    echo        realtime events just will not cross API replicas.
    echo.
) else (
    docker compose -f "%COMPOSE%" up -d %SERVICES%
    if errorlevel 1 (
        echo        WARNING: compose failed. Continuing without Redis.
    ) else (
        echo        waiting for redis to answer PING...
        set "REDIS_OK=0"
        for /L %%I in (1,1,30) do (
            if "!REDIS_OK!"=="0" (
                docker exec mandi-redis redis-cli ping >nul 2>&1
                if not errorlevel 1 (
                    set "REDIS_OK=1"
                    echo        redis   ready
                )
            )
        )
        if "!REDIS_OK!"=="0" echo        WARNING: redis did not answer in time - continuing without it.
    )
)

rem ---------------------------------------------------------------------------
rem  4. Dependencies. --frozen-lockfile so a run never silently drifts from
rem     the committed lockfile. argon2 and sharp are native modules; pnpm is
rem     told to build them by `onlyBuiltDependencies` in the root
rem     package.json - without that, login and image handling crash at
rem     runtime rather than at install.
rem ---------------------------------------------------------------------------
echo.
echo  [4/7] Installing dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo        ERROR: pnpm install failed.
    goto :fail
)

rem ---------------------------------------------------------------------------
rem  5. Build.
rem ---------------------------------------------------------------------------
if "%DO_BUILD%"=="0" (
    echo.
    echo  [5/7] Build SKIPPED ^(--no-build^)
    if not exist "apps\web\.next" (
        echo        ERROR: apps\web\.next does not exist - there is nothing to
        echo        start. Run without --no-build first.
        goto :fail
    )
    if not exist "apps\api\dist\main.js" (
        echo        ERROR: apps\api\dist\main.js does not exist.
        echo        Run without --no-build first.
        goto :fail
    )
) else (
    echo.
    echo  [5/7] Building both apps ^(this is the slow step^)...
    call pnpm build
    if errorlevel 1 (
        echo.
        echo        ERROR: the build failed. Nothing was started.
        goto :fail
    )
    if not exist "apps\api\dist\main.js" (
        echo        ERROR: the API build produced no dist\main.js.
        echo        Check apps\api\tsconfig.build.json.
        goto :fail
    )
    echo        build   OK
)

rem ---------------------------------------------------------------------------
rem  6. Start. Each server gets its own window so its log stays readable and
rem     closing one does not take the other down.
rem ---------------------------------------------------------------------------
echo.
echo  [6/7] Starting servers...

start "Tokri API  :%API_PORT%" cmd /k "cd /d "%ROOT%\apps\api" && node dist\main"
start "Tokri WEB  :%WEB_PORT%" cmd /k "cd /d "%ROOT%\apps\web" && pnpm start"

rem ---------------------------------------------------------------------------
rem  7. Wait until both actually answer. A window that opened proves nothing;
rem     a reply on the port proves the process booted past config validation.
rem     /auth/me answering 401 IS the healthy response - the whole API is
rem     deny-by-default, so an anonymous 401 means the guard chain is live.
rem ---------------------------------------------------------------------------
echo.
echo  [7/7] Waiting for both servers to answer...

set "API_UP=0"
set "WEB_UP=0"
for /L %%I in (1,1,90) do (
    if "!API_UP!!WEB_UP!" NEQ "11" (
        if "!API_UP!"=="0" (
            for /f %%C in ('curl -s -o NUL -w "%%{http_code}" --max-time 3 http://localhost:%API_PORT%/api/v1/auth/me 2^>NUL') do (
                if "%%C"=="401" (
                    set "API_UP=1"
                    echo        API     up   ^(401 on /auth/me = guards live^)
                )
            )
        )
        if "!WEB_UP!"=="0" (
            for /f %%C in ('curl -s -o NUL -w "%%{http_code}" --max-time 5 http://localhost:%WEB_PORT%/ 2^>NUL') do (
                if "%%C"=="200" (
                    set "WEB_UP=1"
                    echo        WEB     up
                )
            )
        )
        if "!API_UP!!WEB_UP!" NEQ "11" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000" >nul
    )
)

echo.
if "!API_UP!"=="0" (
    echo  ---------------------------------------------------------
    echo   API did NOT come up. Look at the "Tokri API" window.
    echo   Most likely: a variable missing from apps\api\.env, or
    echo   Atlas refusing the connection from this network.
    echo  ---------------------------------------------------------
)
if "!WEB_UP!"=="0" (
    echo  ---------------------------------------------------------
    echo   WEB did NOT come up. Look at the "Tokri WEB" window.
    echo  ---------------------------------------------------------
)

if "!API_UP!!WEB_UP!"=="11" (
    echo  ===========================================================
    echo   RUNNING
    echo  ===========================================================
    echo.
    echo     Web        http://localhost:%WEB_PORT%
    echo     API        http://localhost:%API_PORT%/api/v1
    echo     API docs   http://localhost:%API_PORT%/api/v1/docs
    echo.
    echo   Logins are the seeded accounts - see apps\api\.env for the
    echo   two admin ones. Sign-in is at /login.
    echo.
    echo   To stop everything:   run.bat --stop
    echo  ===========================================================
    echo.
    start "" "http://localhost:%WEB_PORT%"
)

popd
endlocal
exit /b 0

rem ===========================================================================
:stop_everything
echo.
echo  Stopping Tokri...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($p in 3000,4000) {" ^
  "  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue;" ^
  "  if ($c) { foreach ($procId in ($c.OwningProcess | Select-Object -Unique)) {" ^
  "      Write-Host ('   stopped port ' + $p + ' (PID ' + $procId + ')');" ^
  "      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }" ^
  "  else { Write-Host ('   port ' + $p + ' was not running') } }"
docker info >nul 2>&1
if not errorlevel 1 (
    docker compose -f "%COMPOSE%" stop >nul 2>&1
    echo    stopped docker services
)
echo  Done.
popd
endlocal
exit /b 0

rem ===========================================================================
:usage
echo.
echo  run.bat              build both apps, then start them
echo  run.bat --no-build   start what is already built
echo  run.bat --stop       stop the servers and the docker services
echo.
popd
endlocal
exit /b 0

rem ===========================================================================
:fail
echo.
echo  ---------------------------------------------------------
echo   STOPPED. Nothing was started.
echo  ---------------------------------------------------------
echo.
popd
endlocal
pause
exit /b 1
