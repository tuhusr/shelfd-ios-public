@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo git is not installed or not on PATH.
  pause
  exit /b 1
)

for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%i"
if not defined BRANCH (
  echo This folder is not a git repository, or the current branch could not be detected.
  pause
  exit /b 1
)

echo Current branch: %BRANCH%

git pull origin %BRANCH%
if errorlevel 1 (
  echo git pull failed.
  pause
  exit /b 1
)

echo.
echo Git pull completed.
pause
exit /b 0
