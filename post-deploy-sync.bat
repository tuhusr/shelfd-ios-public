@echo off
REM ============================================================================
REM  post-deploy-sync.bat
REM  Runs automatically after every Cloudflare deploy. Stages, commits, and
REM  pushes the working tree to the SHELFD-CLEAN GitHub repo. No pause — fully
REM  non-interactive so it can be chained off a deploy command without blocking.
REM
REM  Optional first arg = version label (e.g. v652_friends_cards_facts_pulldown).
REM  When provided, that label appears in the commit message; otherwise we fall
REM  back to a timestamp.
REM ============================================================================
cd /d "%~dp0"

set "VERSION_LABEL=%~1"
if "%VERSION_LABEL%"=="" (
  set "COMMIT_MSG=Deploy sync %date% %time%"
) else (
  set "COMMIT_MSG=Deploy %VERSION_LABEL% - %date% %time%"
)

echo [post-deploy-sync] git add .
git add .

echo [post-deploy-sync] git commit -m "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo [post-deploy-sync] Nothing to commit. Skipping push.
  exit /b 0
)

echo [post-deploy-sync] git push origin main
git push origin main

echo [post-deploy-sync] Done.
exit /b 0
