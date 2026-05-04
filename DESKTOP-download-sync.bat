@echo off

set "TARGET=C:\Users\kingk\Desktop\websites\chat gpt edits\7"
set "REPO=https://github.com/tuhusr/SHELFD-CLEAN.git"

echo Downloading / updating Shelfd CLEAN repo...
echo Target: %TARGET%
echo.

if not exist "%TARGET%\.git" (
    echo Repo not found in target folder.
    echo Cloning fresh repo...
    echo.

    if not exist "%TARGET%" mkdir "%TARGET%"
    git clone "%REPO%" "%TARGET%"
) else (
    echo Repo already exists.
    echo Pulling latest changes...
    echo.

    cd /d "%TARGET%"
    git pull origin main
)

echo.
echo Done.
pause