@echo off
setlocal EnableExtensions EnableDelayedExpansion

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
set /p "COMMIT_MSG=Commit message (leave blank for auto timestamp): "
if not defined COMMIT_MSG set "COMMIT_MSG=Desktop update %DATE% %TIME%"

git add -A
if errorlevel 1 (
  echo git add failed.
  pause
  exit /b 1
)

git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  git diff --cached --quiet
  if errorlevel 1 (
    echo git commit failed.
    pause
    exit /b 1
  ) else (
    echo No changes to commit. Continuing.
  )
)

git push origin %BRANCH%
if errorlevel 1 (
  echo git push failed.
  pause
  exit /b 1
)

echo.
echo Git push completed.
pause
exit /b 0
