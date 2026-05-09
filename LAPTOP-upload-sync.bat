@echo off
set "TARGET=C:\Users\kooms\OneDrive\Desktop\Shelfd - laptop workspace\shelfd-main\shelfd-main"
set "REPO=https://github.com/tuhusr/SHELFD-CLEAN.git"

cd /d "%TARGET%"

echo Syncing laptop Shelfd files to GitHub...
echo Folder: %TARGET%
echo.

if not exist ".git" (
    echo Git repo not found. Initializing...
    git init
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin "%REPO%"
) else (
    git remote set-url origin "%REPO%"
)

git branch -M main

echo.
echo Adding files...
git add .

echo.
echo Checking for changes...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Update Shelfd laptop files - %date% %time%"
) else (
    echo No file changes to commit.
)

echo.
echo Pulling latest remote changes first...
git pull --rebase origin main

echo.
echo Pushing to GitHub...
git push origin main

echo.
echo Done.