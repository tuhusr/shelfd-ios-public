# Shelfd Desktop for Windows

Minimal Tauri wrapper for the live Shelfd website.

- App name: Shelfd
- Live URL: https://myscreenlist.com/
- Target: Windows 10/11
- Installer target: NSIS `.exe`

This project intentionally loads the live website instead of bundling Shelfd frontend files. The live Cloudflare Worker and website remain the source of truth.

## Commands

```powershell
npm.cmd install
npm.cmd run build
```

The Windows installer is expected under:

```text
src-tauri\target\release\bundle\nsis\
```
