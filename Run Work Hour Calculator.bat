@echo off
setlocal
cd /d "%~dp0"

set "NPM="
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
  set "NPM=%ProgramFiles%\nodejs\npm.cmd"
)

if not defined NPM (
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/
    start "" "https://nodejs.org/"
    pause
    exit /b 1
  )
  for /f "delims=" %%N in ('where npm.cmd 2^>nul') do if not defined NPM set "NPM=%%N"
)

if not defined NPM (
  echo npm was not found. Reinstall Node.js with npm included.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Work Hour Calculator dependencies...
  call "%NPM%" install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting Work Hour Calculator...
call "%NPM%" start
if errorlevel 1 (
  echo Work Hour Calculator exited with an error.
  pause
  exit /b 1
)
endlocal
