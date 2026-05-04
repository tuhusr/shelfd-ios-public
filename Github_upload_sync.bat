@echo off
cd /d "%~dp0"

echo Syncing Shelfd CLEAN repo to GitHub...
echo.

echo Remote:
git remote -v
echo.

echo Adding files...
git add .
echo.

echo Committing changes...
git commit -m "Update Shelfd clean files - %date% %time%"
echo.

echo Pushing to GitHub...
git push origin main
echo.

echo Done. Review output above.
pause