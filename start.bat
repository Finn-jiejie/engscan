@echo off
chcp 65001 >nul 2>nul
title engscan - Photo Reader
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"

if not defined NODE_EXE (
  for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
    "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
  ) do (
    if not defined NODE_EXE if exist %%P set "NODE_EXE=%%~P"
  )
)

if not defined NODE_EXE (
  echo.
  echo   [X] Node.js not found.
  echo       Install it from https://nodejs.org  then run this again.
  echo.
  pause
  exit /b 1
)

set OPEN_BROWSER=1
"%NODE_EXE%" server.js

echo.
echo   Server stopped. Press any key to close.
pause >nul
