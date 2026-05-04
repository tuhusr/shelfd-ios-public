@echo off
cd /d "%~dp0"

echo Syncing Shelfd desktop files to GitHub...

if not exist ".git" (
  echo Git repo not found. Initializing...
  git init
  git remote add origin https://github.com/tuhusr/shelfd.git
  git branch -M main
)

echo.
echo Checking current remote...
git remote -v

echo.
echo Making sure sensitive files are ignored...
(
echo node_modules/
echo .dev.vars
echo .env
echo *.log
echo .wrangler/
echo dist/
) > .gitignore

echo.
echo Adding all safe project files...
git add .

echo.
echo Committing changes...
git commit -m "Update Shelfd desktop files - %date% %time%"

echo.
echo Pushing to GitHub...
git push origin main

if errorlevel 1 pause
exit