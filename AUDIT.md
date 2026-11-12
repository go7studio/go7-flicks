# Go7Flicks walkthrough and audit

Tested 9 Nov 2026 on the dev window, not the installed shortcut. Launch with `npm run dev` after setting `GO7FLICKS_DEBUG=1`. That window is `http://localhost:5173/` with DevTools on port 9223. The installed exe under `%LOCALAPPDATA%\Programs\Go7Flicks` was closed and was not rebuilt. Opening that shortcut still shows the old screen.

The frame stays 1080x1920. There is no size menu.

## Walkthrough

1. Home is the start screen. Library is the channel list. Connections is the account screen. Video Ranking and Split Screen are the two desks.
2. Open a channel, then a flick. The top bar is Home, Library, Back to the channel name, the flick name, Connections, Export cut, and Export styled.
3. The left column is Shelf. It says what it is for, then Add clip and Link clip. Add clip copies a file into the channel. Link clip leaves a local file where it is. A network file is copied into Working copies first.
4. Place a clip, trim In and Out, and split at the playhead. Undo and Redo put the cut back and bring it again. Full frame and Split evenly are on the canvas. Drag the seam to change the share. Half, Face larger, and Gameplay larger are on the split desk.
5. Save a template from the canvas. A new flick from that template keeps the cuts and the seam, and does not keep the clips.
6. Add music takes a local audio file. Export cut keeps the top picture. Export styled paints both regions. Both are 1080x1920.
7. Library shows Working copies, Change, and Clean unused. Clean unused drops working copies no timeline still uses, an unfinished export, and a numbered extra such as `Name (1).mp4` when `Name.mp4` is already saved. An export with its own name stays. It does not delete a source clip that is still on a timeline, and it does not change a network drive.

## What the running window shows

Home, Library, Back to Emoji Loop 55941, and Connections are on the canvas bar, with Export cut and Export styled. The shelf heading is Shelf. The line under it is "Clips available to place on the timeline." Rows show names such as flower and a dated filename, not raw ids. The preview did not paint a filename across the picture.

## Test results

Clips used: three different local files (flower, sample, phone) and one NAS file, `20210326_082125.mp4` on K:. The NAS file was not edited in place.

- Open a flick, Home, Library, and Back to the channel, then return. Pass. Each landing was the start screen, the channel list, or the flick list, and the flick opened again. One script check missed the title because it is a field, then the same flick was opened and the rest of the test ran on it.
- Add clip and link clip. Pass. Three local links, about 2 seconds each. The new NAS row said "7.5s · On this computer." The NAS file stayed 15,812,245 bytes.
- Place clips. Pass. Flower on the face track, sample on gameplay. About a third of a second.
- Trim in and out. Pass. Gameplay out set to 2.0.
- Split at the playhead. Pass. 2 blocks to 3 in 119ms.
- Undo and redo. Pass. Undo 112ms back to 2. Redo 167ms to 3.
- Dual share. Pass on the split desk: Half 50%, Face larger 60%, Gameplay larger 40%. Canvas Split evenly ran. Half, Face larger, and Gameplay larger are not on the canvas.
- Save a template, then start a flick from it. Pass. Both were 1080x1920, 3 clips, 0 with media.
- Add music. Pass. A 0.4s local tone attached in about 2.6 seconds. No music was downloaded.
- Export cut. Pass. `Audit pass.mp4`, about 3 seconds to finish, 1080x1920, 2.0 seconds, and ffmpeg decoded frames. Encoder h264_nvenc.
- Export styled. Pass. About 22 seconds for 2 seconds of a two-region flick, 1080x1920, 2.048 seconds, from the staged local file. That one is the slow step.
- Ranking desk and split desk. Pass. Both open from Home and return there.
- Connections. Pass. The screen opens and Back returns to the canvas.
- Write line. Fail. No connection answered. See below.

## Grok and Cursor

Grok is a connection kind. Choosing it fills `https://api.x.ai/v1` and model `grok-4.7`, which is a model id the provider lists. No key was on this machine (`XAI_API_KEY`, `GROK_API_KEY`, or a saved app secret). The grok program is installed and is not signed in. Not connected. Pasting a key on that row is all that is left.

Cursor is a connection kind and calls `cursor-agent` the same way Codex calls its program. This screen does not keep a Cursor key. `cursor-agent status` said not logged in, and `CURSOR_API_KEY` is not set. The Cursor SDK would need that key, which would be a new secret. Not connected.

Claude is on the path and returned 401, OAuth expired. Codex is not on the path. Write line was not sent.

## Cleanup

Library, next to Working copies. The first click used a rule that deleted every export whose name was not exactly a flick name. That removed 23 files from `D:\GitHub\Emoji Loop 55941\exports`, including the channel copy of `splice-four.mp4`. Desktop `Splice-Four.mp4`, `Long-ranking.mp4`, `Long-split.mp4`, `Long-dual.mp4`, and `Long-blank.mp4` were not touched. The rule is now narrower.

The retest, on the new rule, said "Removed 0 unused working copies and 2 exports." It deleted `go7-narrow.partial` and `Split screen (1).mp4`. It left `splice-four.mp4` (7,200,068 bytes, copied back from the Desktop file), `Split screen.mp4`, and `long-report.json`. Flower and the phone file in the channel are still there. The NAS file is still 15,812,245 bytes.

This session's debris was removed: flicks Audit pass and Audit from template, the Audit template, the test links and the tone file, and `Audit pass.mp4`. Channel-only exports from earlier sessions that had their own names, such as `02-split.mp4`, were not on the Desktop and could not be put back.

## Files changed

`electron/cleanup.ts`, `electron/stage.ts`, `electron/settings.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/providers.ts`, `electron/library.ts`, `electron/seed-accounts.ts`, `src/shared/api.ts`, `src/shared/model.ts`, `src/ui/HomeScreen.tsx`, `src/ui/ConnectionsScreen.tsx`, `src/ui/CanvasScreen.tsx`, `PRODUCT-BIBLE.md`, `TRAINING.md`, `test/cleanup.test.ts`. Other canvas, desk, and export files were already edited in this working tree.

## Still broken

- The installed shortcut is the old build. Use the dev window.
- Grok needs a key. Cursor needs `cursor-agent login` or `CURSOR_API_KEY`. Write line has nothing that can answer.
- Half, Face larger, and Gameplay larger are on the split desk only.
- Styled export of about 2 seconds took about 22 seconds.
- The first Clean unused pass removed uniquely named channel exports that are not on the Desktop. Those copies are gone.
