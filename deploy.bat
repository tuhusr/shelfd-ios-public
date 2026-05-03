@echo off
cd /d "C:\Users\kingk\Desktop\websites\chat gpt edits\7"
powershell -NoProfile -ExecutionPolicy Bypass -Command "npx wrangler deploy"
if errorlevel 1 pause