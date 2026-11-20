# Drew and Wes on Windows

The link for another PC, including a friend who is not in the family, is https://go7studio.com/products/go7-flicks. Anyone can open it. No Go7 account and no GitHub login. That page is the listing. The Windows setup file is not posted there yet, so the button stays on the install steps.

Another PC installs Go7 Flicks by running `Go7Flicks-Setup-<version>.exe`. Until the public file exists, the exe comes from a Windows build. `npm run dist:win` is the command that builds it. When `go7studio/go7-flicks` is public, the page button should point at `https://github.com/go7studio/go7-flicks/releases/latest`. The product path is in `PRODUCT-BIBLE.md` section 9.

This checkout has built `release\Go7Flicks-Setup-0.1.0.exe` and has not published it. `release\` is not in git. The file is unsigned.

## Already in the repo

- `npm run dist:win` is the one command. It builds the app, then runs `package:win` (`electron-builder --win nsis --publish never`).
- `npm run pack:win` builds the app and writes an unpacked Windows folder. That is not the installer.
- `npm run package:win` makes the NSIS installer only. Run `npm run build` first, or use `dist:win`.
- App id: `com.go7studio.flicks`.
- Installer the script writes: `release\Go7Flicks-Setup-0.1.0.exe`.
- The icon is already in the repo. Windows uses `build/icon.ico`, and `package.json` sets `build.win.icon` to that file. `build/icon.svg`, `build/icon.png`, and `build/icon.icns` are there for the Mac package. Do not regenerate them.
- NSIS is per user, not one-click, and it can change the install folder. It adds a desktop shortcut and a Start menu shortcut named Go7Flicks. Uninstall leaves app data in place.
- GitHub Actions builds the same installer on a manual run, and attaches it to a release when a `v*` tag is pushed. Other pushes do not publish it. The workflow is `.github/workflows/installer.yml`. The setup file stays unsigned.

## Styled export hardware

Styled export uses Remotion `hardwareAcceleration: "if-possible"`, 8 Mbps, and no crf. On a Mac the encoder is `h264_videotoolbox`. On Windows with NVIDIA it is `h264_nvenc`. Intel QSV and AMD AMF are not in Remotion's styled path. The canvas encoder line can still name QSV or AMF for the cut path.

## Drew

Proper git folder on DadOffice is `D:\GitHub\go7-flicks` (same pattern as `D:\GitHub\OperationOops-FunSession`).

1. Install Node.js. From PowerShell on that PC:

   ```
   powershell -ExecutionPolicy Bypass -File \\path\to\setup-windows-d.ps1
   ```

   Or the manual clone:

   ```
   mkdir D:\GitHub -Force
   git clone https://github.com/SteveMLC/go7-flicks.git D:\GitHub\go7-flicks
   cd D:\GitHub\go7-flicks
   git checkout cursor/dual-video-and-locked-ui
   npm install
   ```

   One-shot script in the repo: `scripts/setup-windows-d.ps1`.

2. Run `npm run dist:win`.
3. Run `release\Go7Flicks-Setup-0.1.0.exe` and open Go7Flicks.
4. Library, New channel, pick a folder. That folder is the channel.
5. Home, Video Ranking or Dual video. Add clips that are already on this PC. Open timeline. It asks for a folder on the first one.
6. The encoder line should read `h264_nvenc`, `h264_qsv`, `h264_amf`, or `software (libx264)`. Styled export on an NVIDIA PC uses `h264_nvenc`. QSV and AMF are not used on that styled path.
7. Export cut or Export styled. Styled export uses bitrate 8M and does not set crf.
8. Paste a link and press Get. The clip is saved in the channel.

## Wes

Wes does not clone the repo or run `dist:win`. He opens https://go7studio.com/products/go7-flicks and can send that same link to a friend. When the Windows setup is posted, he downloads `Go7Flicks-Setup-<version>.exe` from that page and runs it. Windows will say unknown publisher. He takes the file only from that page, then chooses More info, then Run anyway.

That page and that file are not live yet. Until the file is posted, he can run a copy of the exe from a Windows build. After it installs, he follows Drew’s steps from Library onward. His Connections and saved templates stay on his install.

## One channel, two PCs

Copy the channel folder from one PC to the other. Open folder there. The flicks open. Connections and templates stay on the install that saved them.
