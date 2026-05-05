@echo off
set "TARGET=C:\Users\kooms\OneDrive\Desktop\Shelfd - laptop workspace\shelfd-main\shelfd-main"
set "REPO=https://github.com/tuhusr/SHELFD-CLEAN.git"

echo Downloading latest Shelfd files from GitHub...
echo Folder: %TARGET%
echo.

if not exist "%TARGET%\.git" (
    echo Git repo not found. Cloning clean repo...
    if not exist "%TARGET%" mkdir "%TARGET%"
    git clone "%REPO%" "%TARGET%"
) else (
    cd /d "%TARGET%"
    git remote set-url origin "%REPO%"
    git branch -M main

    echo Fetching latest GitHub files...
    git fetch origin main

    echo Resetting laptop folder to match GitHub...
    git reset --hard origin/main
)

echo.
echo Done. Laptop folder now matches GitHub.
pause