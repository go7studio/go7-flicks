# Go7Flicks training

This is the short index. The baseline is [PRODUCT-BIBLE.md](PRODUCT-BIBLE.md). The plan at `~/.cursor/plans/go7_shorts_local_editor_c31fa3ff.plan.md` points here and at the bible. When a control is added or refused, update the bible first, then this index.

Go7Flicks is its own Windows and Mac app. Workhorse stays the desk. A template starts a flick. The canvas can then be cut by hand. A pasted link is a note. The video has to already be a file on the computer.

Status words: **in the app**, **next**, **refused**. The full list, the screen-by-screen path, the performance numbers, and the Workhorse call paths are in the bible.

## Index

- **Home.** Baseline is one greeting and two cards: Video Ranking and Split. Auto Clipping, Text Story, the transcriber, and image gen stay later and off the first click. See bible sections 2 and 4. Frames: `docs/concepts/home.png`, `docs/concepts/ranking.png`.
- **Drew and Wes.** Both on Windows. Installer steps are in `WINDOWS.md`. This Mac has not built it.
- **Video ranking.** In the app: title, highlight words, stroke, 5–7 slots, countdown, listed, shuffle. Polish and local auto-clip candidates are next.
- **Split, commentary, canvas, templates.** In the app. Script-to-scenes, chat templates, kinetic captions, and the heavier timeline tools are next.
- **Dual video.** In the app, from the Split Screen card. Half by default, face or gameplay on top, both clips heard, seam still moves. Frame: `docs/concepts/dual-video.png`.
- **Voice, cut export, styled export.** In the app. Styled export uses hardware acceleration when possible, bitrate 8M, and `crf` null.
- **Connections.** Claude, Codex, ElevenLabs, MiniMax, Other. No auto-router and no usage rings. Grok, Cursor, and Gemini rows are next.
- **Refused.** Video downloader, scene-detect clone, sending someone else’s video to a model, the Remotion Timeline component, and reading Workhorse’s secret store.
- **Packaging.** Mac dmg script is in the repo. Windows NSIS still has to be built on a Windows PC. The $10 month waits until both boys can make a channel.

## Where a few rules live in code

`playbackOrder` in `src/shared/canvas.ts` is the ranking rule. Countdown sorts by rank, high to low. Listed keeps the rail. Shuffle follows the id list from the last Shuffle press and does not rewrite `rank`. The ranking desk shows that play position on each slot, then Open timeline writes the clips in that order.

Create and save timing for an empty channel lives in `test/create-save.perf.test.ts`. The latest run is recorded in the bible.
