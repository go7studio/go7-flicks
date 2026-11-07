# Drew and Wes on Windows

This Mac has not built the Windows installer. Build it on a Windows PC. The product path is in `PRODUCT-BIBLE.md` section 9.

## Already in the repo

- `npm run pack:win` builds the app and writes an unpacked Windows folder.
- `npm run package:win` makes the NSIS installer. Run `npm run build` first, or use `dist:win`.
- `npm run dist:win` is the command. It builds, then runs `package:win`.
- App id: `com.go7studio.flicks`.
- Installer the script writes: `release\Go7Flicks-Setup-0.1.0.exe`.
- NSIS is per user, not one-click, and it can change the install folder. It adds a desktop shortcut and a Start menu shortcut named Go7Flicks. Uninstall leaves app data in place.

## Drew

1. Install Node. Copy this repo onto the PC. Run `npm install`.
2. Run `npm run dist:win`.
3. Run `release\Go7Flicks-Setup-0.1.0.exe` and open Go7Flicks.
4. Library, New channel, pick a folder. That folder is the channel.
5. Home, Video Ranking or Split. Add clips that are already on this PC. Open timeline.
6. The encoder line should read `h264_nvenc`, `h264_qsv`, `h264_amf`, or `software (libx264)`.
7. Export cut or Export styled. Styled export uses bitrate 8M and does not set crf.
8. A pasted TikTok, YouTube, or Instagram link is only a note. The app does not download it.

## Wes

Same install and same path, on his PC. He can copy `Go7Flicks-Setup-0.1.0.exe` from Drew instead of running `dist:win` himself. His Connections and saved templates stay on his install.

## One channel, two PCs

Copy the channel folder from one PC to the other. Open folder there. The flicks open. Connections and templates stay on the install that saved them.
