# Go7Flicks product bible

Baseline for the team. Updated 2026-11-07 from the local editor plan, the viral-video PDF, and the app in this repo. Updated again on 2026-11-10: Find clips is the subject finder on the ranking desk, and Which clip stays. `TRAINING.md` is the short index. When a control is added or refused, change this file first, then the index.

The app is Electron, Vite, and React at `~/workspace/go7-flicks`. The window is the product. The renderer never starts ffmpeg, a Remotion encode, or a download. The main process does.

## 1. What the product is

Go7Flicks is a separate local app for Drew and Wes. Both of them run Windows. A person makes a channel folder, starts a flick from the ranking desk or the split desk, cuts it on the one canvas, and exports an MP4 on that computer. This Mac has the Mac package scripts and has not produced the Windows installer. Later, after both of them can do that on their own PCs, it may be a $10 a month app. That price is not real until the Remotion Automators minimum is checked. Local family use of Remotion fits the free license. A sold native app that renders for customers is the Automators license.

A channel is a folder. `channel.json` holds the name, the accent color, the media list, and the flick list. Each flick is `flicks/<id>/flick.json`. Copy the folder to the other PC or to a disk the other boy can open. There is no Go7Flicks account and no cloud project. Connections stay on the computer that saved them. Saved templates stay on that install. The flick’s canvas travels inside the channel, so the other PC opens the edit without the template library. Workhorse does not have to be running.

A template is the baseline, not a lock. The editor is a canvas. Start from a template or from blank. The person can change the layout and the cuts. Save as template stores the layout and the cuts and drops the media. Built-in templates are never overwritten. A template the person saved can be replaced, or saved again under a new name.

Get downloads a pasted link into `media/` and keeps the address on the clip (`sourceUrl`). Add clip copies a file that is already on the computer. Link clip stores an absolute path. A file already on a local disk stays where it is when linked, and is copied into the channel when added. A file on a network drive or a UNC path is copied into the working-copies folder on this computer. That includes a download or a channel copy whose channel folder itself sits on a network drive. Preview, cut, and styled export read the local file. The person can change the working-copies folder. It starts in this app’s user data.

Go7Flicks copies Workhorse’s connection pattern and keeps its own encrypted keys. It does not open Workhorse’s saved secrets, and it does not print keys or dump env files.

It is not the desk. Workhorse stays the desk. It is not a browser NLE, and it does not buy or embed the Remotion Timeline component. The first timeline is ours, and it is small. It is not Viblo. Viblo’s public prices are about $25, $49, and $99 a month with credit caps. This app wins only if export is reliable on an ordinary Windows PC and the screen stays obvious.

The loop that matters is the subject. The person names something specific, the clips are of that subject, and then those clips are cut. Which clip does not do that search. It ranks clips already on the flick. The subject finder is Find clips, at the top of the ranking desk.

The PDF at `~/Downloads/go7workhorse_viral_video_engine_spec.pdf` is right about the picture: a wizard first, a timeline second, Remotion for the vertical frame, and fetching a link the person pasted. It is wrong about living inside Workhorse, and about `--codec=h264-videotoolbox` as the encode switch. The styled path uses `hardwareAcceleration: "if-possible"` and `videoBitrate: "8M"`, with `crf` set to null.

## 2. How a person uses it

This is the baseline. The two desks replace the dense tool list. There is one canvas, and it is the cut surface. There is no second editor.

1. **Home.** A white left rail and a light main area. The rail is Home, Library, and Connections. The greeting is “Hello, what would you like to create today?” Under it, three small pills: Quick, Full, and AI. The cards on that first screen are Video Ranking and Split. Those are the two starts. A kid can tell which one to click.
2. **Library, when a channel is needed.** Channel name, New channel, Open folder, and the recent folders. The library shows when a video was made and when a flick was clipped. Working copies sits on this screen: the folder on this computer, a button to change it, and Clean unused. Clean unused removes working copies no timeline still uses, unfinished export pieces, and a numbered extra such as `Name (1).mp4` when `Name.mp4` is already there. An export with its own name stays. It does not delete a source clip that is still on a timeline, and it does not change a network drive. New channel asks for a parent folder and writes `channel.json`, `media/`, `flicks/`, and `exports/`.
3. **Channel.** The channel name, five accent swatches, Connections, New flick, and one row per flick with its name and clipped date. New flick asks for a name and a template. The choices that ship are Split screen, Dual video, Video ranking, and Blank. Blank is one full-frame region and an empty video track. Blank stays on this dialog. It is not a home card.
4. **Ranking desk, or split desk.** A phone in the middle. Open timeline is the only strong button. It writes the flick and opens the canvas.
5. **Canvas.** Seam, trim, split, delete, reorder, write line, make voice, text style, export. That is the whole cut surface.
6. **Export.** The person picks where the MP4 goes. The top bar already shows the encoder name, or “software”.

### What leaves the first click

These cards are in the current home, and they come off that first screen. They stay later, until the thing they name actually exists. They do not get a second editor.

- **Auto Clipping.** The card says Clip It Now and opens a blank canvas. The scan that offers in-out points is not built. It stays off the first screen.
- **Text Story.** The card opens a blank canvas. A text-story desk is not built. It stays off the first screen.
- **Video Commentary.** The card already opens the split desk. Split is the start, so this card does not sit beside it.
- **Simple Editor.** The card opens a blank canvas. Blank stays on New flick, inside the channel.
- **Video Transcriber.** The button says Coming later. It stays off the first screen.
- **Generate Image**, and an AI video card if one is added. Still pictures and generated footage are not in this build. They stay off the first screen.
- **Generate AI Voiceover.** Voice is Make voice on the canvas, after a cut is selected. The home card that only opens Connections comes off the first screen. Connections stays on the rail.

The pills stay. Clicking Full or AI does not bring those later tools back onto the first screen.

### What is on each screen

**Home.** White rail, the greeting, three pills, two cards: Video Ranking and Split. The frames in section 4 show the light shell. The saved home frame still draws Auto Clipping, Video Commentary, and Text Story. Those three are the cards this baseline removes.

**Ranking desk.** Top bar: Home, “Video ranking”, Open timeline. Left rail: 5, 6, and 7, then one slot per rank, then the words Countdown, Listed, Skip around, and Shuffle. Center: a 9:16 phone, with Play under it. On the ranking desk, Play ranking plays every filled cut in the current order, and This clip plays the selected video from start to end. Open timeline opens that same ranking on the full timeline. The phone shows the rank and the clip title. The headline stays in the inspector and on the export. The title is on the frame. The selected slot’s clip plays in the phone when a local file is added. A rank number sits on the frame when “Show the rank number” is on. The clip title sits under it with the stroke. Right side, one quiet inspector: video title, Which clip, words to color, highlight color, stroke, the rank checkbox, font, line size, line color, warmth, Paste lines, Add clip, clip title, link, Get, in, out, Earlier, Later.

**Ranking desk.** Top bar: Home, “Video ranking”, Open timeline. Left rail: 5, 6, and 7, then one slot per rank, then Countdown, Listed, Skip around, and Shuffle. Center: a 9:16 phone, with Play under it. On the ranking desk, Play ranking plays every filled cut in the current order, and This clip plays the selected video from start to end. Open timeline opens that same ranking on the full timeline. The phone shows the rank and the clip title. The headline stays in the inspector and on the export. The title is on the frame. The selected slot’s clip plays in the phone when a local file is added. A rank number sits on the frame when “Show the rank number” is on. The clip title sits under it with the stroke. Right side: video title, Which clip, words to color, highlight color, stroke, the rank checkbox, font, line size, line color, warmth, Paste lines, Add clip, clip title, link, Get, in, out, Earlier, Later.

**Split desk.** This is the dual desk. Top bar: Home, Dual video, Open timeline. Left: Face on top or Gameplay on top, then Half, Face larger, and Gameplay larger. Half starts selected, with the face on top. Center: the phone, split by that seam. Right: the flick name, Add face clip, Add gameplay clip, and a sound switch for each clip. Both clips start heard. Open timeline writes the Dual video template.

**Canvas.** One cut surface. Top bar: Channel, the flick name, the encoder line, Export cut, Export styled. Center: the 1080×1920 frame and the seam. The selected cut has trim, split, delete, and reorder. Write line and Make voice sit on that cut. Which clip sits under Text and style. Bottom: Play and one lane per track. B splits at the playhead. Delete closes the gap. Save as template stays on this screen. Do not add a second editor beside it.

**Connections.** Back, a form, and one card per saved row. The form is kind, name, login, key, model, base URL, and format. The card shows Connected or Not tested, and Test, Edit, and delete. A key field is a password field. The renderer is told that a key is saved. The key itself stays in this app’s encrypted store.

**Channel** is the list of flicks, described above.

### Descriptions after the Codex Terra pass

Codex Terra reviewed these five paragraphs on 2026-11-07 through `~/.local/bin/codex-api-call --model gpt-5.6-terra --effort low`. The caller reported model `gpt-5.6-terra`, status completed. The shorter wording below is what we kept.

**Home.** Hello, what would you like to create today? Choose Quick, Full, or AI. Start a ranking or a split. Library holds the channel folders. Connections is where you choose who writes a line.

**Ranking.** Rankings use a phone frame and numbered slots. The title sits on the frame. A return starts the second line. Named words take the highlight color. Stroke is the black outline. Start with five slots. Six and seven use the same control. Countdown plays 5, then 4, then 3. Listed plays the rail order. Earlier and Later move a slot. Shuffle changes the play order and leaves the rank numbers where they are. Open timeline writes that order onto the canvas.

**Split.** Split Screen is the dual desk. A face or a UGC clip sits on one half and gameplay on the other. Half is the start. Face larger gives the face 60%. Gameplay larger gives the gameplay 60%. Either clip can be on top. Move the seam on the timeline. Both clips are heard unless a sound switch is off. Add the two files from this computer, then open the timeline.

**Export.** Export cut uses ffmpeg. Matching clips are copied. Clips that need scale or crop are encoded with the probed encoder, VideoToolbox, NVENC, QSV, or AMF, at 8M. Export styled uses Remotion to draw the split and the titles, then encodes with hardware acceleration when the machine has it, at 8M. Styled export sets `crf` to null. The window shows the encoder name before the render starts. When only software encoding is available, the window says software.

**Connections.** Each account has its own row: Claude, Codex, ElevenLabs, MiniMax, or Other. Choose the row when you write a line or make a voice. There is no automatic router and no usage ring. Keys stay encrypted in this app. This app cannot open Workhorse’s saved secrets. A pasted link is downloaded when the person presses Get. Preview, cut, and styled export read a file on this computer. When the download or the channel folder is on a network drive, that file is the working copy.

Terra also wanted the `crf` sentence and the probed-encoder wording removed as implementation detail. Those stay. They are product rules, and a later edit that puts `crf` back on the styled path would be a bug. The on-screen greeting stays because that sentence is what the home page shows. “Writes that order onto the canvas” stays because Open timeline saves the clips in that order.

## 3. Feature list

Status words: **in the app**, **next**, **refused**. The first screen in section 2 is the baseline even where the current home still shows a later card.

### First screen

- **In the app.** The light shell: white rail, greeting, three pills, Library, Connections.
- **Baseline.** Two cards only: Video Ranking and Split. Open timeline on that desk is the handoff to the canvas.
- **Next, and off the first click.** Auto Clipping, Text Story, Video Transcriber, Generate Image, Generate AI Voiceover, Simple Editor, and Video Commentary as its own card. The work they point at is still listed under those names below. None of them become a second editor.

### Channels and library

- **In the app.** New channel, open a folder, recent channels on Library, accent color, flick cards, the folder layout above.
- **In the app.** Add clip copies into `media/`. Link clip stores an absolute path. A file already on a local disk can stay where it is. Network and UNC files are copied into the working-copies folder on this computer, including a copy that landed in a channel folder on a network drive. Preview, cut, and styled export read that local file. The channel list can still show the original path. A missing linked file shows as missing on the canvas. Working copies is on Library. The folder defaults to this app’s user data. An empty or invalid choice falls back to that default.
- **In the app.** Get, on the ranking desk, the split desk, and the canvas, downloads a pasted link into `media/`. The address stays on the clip. The download runs in the main process. If `media/` is on a network drive, the working file for preview, cut, and styled export is the local copy.
- **Next.** A library of finished exports inside the app. Today the MP4 is whatever path the save dialog returned, and the channel has an `exports/` folder ready for that.
- **Refused.** A Go7Flicks account, a cloud project, and opening Workhorse’s channel or secret store.

### Canvas and templates

- **In the app.** Four built-ins in `builtinTemplates()`: `builtin-split` (top 60 / bottom 40, hook, beat, payoff, muted loop), `builtin-dual` (half / half, face and gameplay, both heard), `builtin-ranking` (five rank slots plus a muted loop), `builtin-blank` (one region, no clips). `flickFromTemplate` copies the recipe onto the flick and leaves the original template alone.
- **In the app.** Drag the seam (`dragSeam`), Full frame, Split evenly, trim in and out, split at the playhead, delete closes the gap, reorder with Earlier and Later. Undo and redo keep the last 30 canvas edits in the window. Cuts stay on that flick.
- **In the app.** Save as template (`templateFromFlick`) keeps regions, tracks, cut lengths, the font, the line size, the line color, and the warmth. It sets `mediaId` to null and drops the link, the music file, and the music credit. Replace is offered only for templates the person saved. Built-ins are not in that menu.
- **In the app.** Add music copies one local audio file into the channel. A credit is optional and is removed with that file. The credit is drawn on Export styled and on Export cut when the music is in that file. Files already added on this computer are kept in a shelf and can be used on the next flick. There is no bundled song catalog.
- **In the app.** Preview is `@remotion/player` in the window. Frame is 1080×1920 at 30 fps (`FRAME` in `src/shared/model.ts`).
- **Next.** Text-story and chat-story templates. Commentary as a script that becomes scenes, instead of only opening the split desk.
- **Refused.** Buying or embedding the Remotion Timeline component. Treating a template as a lock.

### Video ranking

- **In the app.** Multiline title on the frame. A return starts the second line. Named words, comma-separated, take the highlight color. Stroke width from 0 to 12. Rank number shown or hidden for every slot together.
- **In the app.** The on-screen text uses one font: Segoe UI, Arial, Georgia, or Impact. The phone and Export styled use that face.
- **In the app.** The line under the headline has its own size and its own color. The highlight color still belongs to the named words. The stroke stays on that line.
- **In the app.** Picture warmth is one slider, Cool to Warm. It tints the picture on the phone and on Export styled. There is no color wheel.
- **In the app.** Paste lines puts one line on each slot, starting at the selected slot and moving down the rail. It does not call a model.
- **In the app.** Which clip, described below. It sits under the headline on this desk.
- **In the app.** Find clips, at the top of the inspector. A subject field and that button. The main process searches that subject and downloads three short clips into empty slots. A slot that already has a clip stays put. Get still takes a pasted link.
- **In the app.** One slot per rank. Each slot takes a local clip or a pasted link, a short clip title, and in and out. Get downloads the link. Default is five slots. Six and seven are the same control. New slots are numbered from the top of the list downward, so five slots start at #5.
- **In the app.** Playback is Countdown, Listed, Skip around, or Shuffle. Countdown sorts by rank, high to low, so the film plays 5 then 4 then 3. Listed keeps the rail. Skip around plays the ranks out of numeric order: five ranks play 1, 5, 2, 4, 3, and three ranks play 1, 3, 2. Earlier and Later move the selected slot on that rail. Shuffle runs `shuffleIds` and stores the id list. Pressing Shuffle again rolls a new order. Rank numbers stay on the slots. The rail shows “Play 1”, “Play 2”, and so on. Open timeline writes the clips onto `track-top` in that play order. The clip label is `#` plus the rank when the number is shown, otherwise the clip title. The spoken line is the clip title. `playbackOrder` in `src/shared/canvas.ts` is the rule.
- **Next.** Fade-in and bounce on the clip title. Drag the clip title so it sits under the headline. Edit one slot’s number on its own. A black plate behind the headline, separate from the stroke.
- **Next.** Auto clipping inside a ranking: pick a long local file and offer a few in-out candidates. That scan stays on this machine.

### Subject finder

The person names a specific subject. The assistant looks for clips of that subject, not a generic viral video. Parkour brings parkour clips. Gardening brings gardening. Baking brings baking. A military subject brings military clips. The clips it finds are staged locally and can be cut with the tools already in the app. Which clip still ranks a set that is already on the flick. ElevenLabs speaks a line. It does not search for footage. The app does not browse on behalf of a vague “make me something viral” request. The subject is the point.

**In the app.** Find clips is on the ranking desk, at the top of the inspector. The person types a specific subject and presses Find clips. The main process uses the same yt-dlp downloader as Get, searches that subject, and downloads three clips under 90 seconds, skipping a longer video, a compilation, and a robot, news, interview, or building-collapse title. It skips a result that is not a video. When several short clips are in the list, it keeps the ones whose title names the subject. The subject picks the kind of clip, a fall or a jump counts, and the result is a short set the person can rank and cut. Find clips trims to the loudest moment on this computer, keeps the crop centered, and Skip around plays the ranks out of numeric order. The headline and the accent word come from the subject. The clips are staged the same way as other downloads, then the desk puts them in empty ranking slots. It does not reorder or delete a slot that already has a clip. The window does not call yt-dlp or the network. The cut stays on this computer. Find clips does not call the Gemini subscription or Antigravity. Get still downloads a link the person already pasted.

Two jobs showed up on the pages read on 2026-11-10. They are not the same job.

One job finds footage that already exists. The ranking walkthroughs start by naming the subject. The examples on those pages are “ranking best parkour fails,” “ranking funniest dog moments,” and “ranking cutest cats in history.” The clips in the edit are of that subject. In the walkthrough, that subject is typed into TikTok search, the link is copied, and Viblo downloads the clip into a ranking slot. The person then trims it and gives it a title. The highlight page is a smaller find. It scans footage already in hand for energy, pacing, and motion. The TikTok editor page says a pasted link from TikTok, Instagram, or YouTube is pulled into the editor. Home: `https://viblo.ai/`. Highlight: `https://viblo.ai/ai-highlight-video-maker/`. Link import: `https://viblo.ai/tiktok-video-editor/`. The walkthroughs are `https://www.youtube.com/watch?v=ygeCgN-SfE8`, `https://www.youtube.com/watch?v=LzN4meAwbxc`, and the Wealthy Tent writeup at `https://wealthytent.com/youtube-shorts-ai-income-strategy-2026` (November 6, 2026).

The other job generates a new idea. The idea generator drafts a concept and a script, then a voiceover and scenes. If there is no footage, it says the video generator makes pictures from a prompt. That is a new idea. It is not a clip of the named subject. Those pages do not publish a virality formula. Idea generator: `https://viblo.ai/video-idea-generator/`. On `https://viblo.ai/pricing/`, the Creator plan is a price tier at $49 a month, and ElevenLabs is the voice list. There is no creator feature page at `https://viblo.ai/creator/` or `https://viblo.ai/ai-shorts-creator/`.

**In the app.** The search is Find clips, described above. It is not a browser, and it is not the idea generator.

### Which clip

**In the app.** Which clip is on the ranking desk, under the headline, and on the canvas, under Text and style. It is one control. It is not a home card and it is not a second editor. It reads the clips already on that flick: the name, the line, the length, and the date. Ask which clip sends that list to the connected chat row. The main process makes the call. The window does not. The screen shows the model’s own words, the strongest hook it named, a headline for the video, and a short title for each clip. Apply headline writes that headline into the headline field. Apply title writes that title into the existing line field for that clip. The assistant does not reorder clips, delete clips, or change the timeline on its own. What trend is the quieter button. It asks the same model what kind of video this set already is. It does not browse the web, download a video, or open a new account. Claude, Codex, Grok, Cursor, or Other can answer when that row is already connected and tested. ElevenLabs and MiniMax stay voice. When no chat row is connected, the control says so and does not invent a ranking. When the model declines, that reply is what the screen shows.

### Split layouts

- **In the app.** The Split Screen card opens the dual desk. See Dual video. `builtin-split` still ships on New flick: top 60 / bottom 40, hook, beat, payoff, and a muted bottom loop. Full frame and Split evenly stay on the canvas.
- **In the app, off the first screen.** Video Commentary opens this same dual desk. The separate card stays in Later. A script that becomes scenes is next, and it still opens this canvas.
- **Next.** PiP, feathered dividers, and a speed ramp on the bottom loop. Those are in the PDF. They wait until the two-region split is the one the boys actually use.

### Dual video

A reusable half-and-half template. The top half starts as the face or the UGC clip. The bottom half starts as the gameplay. Swapping them is the same template. It can be any game. Both pictures are files the person added, or links they pressed Get on. The address stays on the clip. A network file is copied onto this computer before the preview and the export.

Drew or Wes opens Split Screen on the home. That card is this desk, and it is still one of the two first-screen cards. Half is already selected, with the face on top. They choose Face on top or Gameplay on top, and a seam preset before Open timeline: Half (0.5 / 0.5), Face larger (the face region is 60%), or Gameplay larger (the gameplay region is 60%). They add the two local files. Open timeline writes a flick from `builtin-dual`. On the canvas they drag the seam with `dragSeam`. Save as template stores that layout for the next flick and leaves the built-in alone.

Both tracks start unmuted. The phone on the desk plays a side when that side is heard. The timeline and Export styled play both clips under the voice. Each clip has a sound switch, so turning one off is the mute. Export cut still concatenates the top region and drops clip audio. Its sound is the voice and any added music.

- **In the app.** `builtin-dual` in `builtinTemplates()`: two regions at 0.5 and 0.5, clips Face and Gameplay, tracks `track-face` and `track-game`, both unmuted. `applyDualLayout` writes the arrangement and the preset onto the flick. The seam still moves after Open timeline.
- **In the app.** The home card stays Split Screen. Its copy says face and gameplay. Later tools stay off the first screen.
- Concept frame: `docs/concepts/dual-video.png`.

### Auto clipping

- **In the app, off the first screen.** The Auto Clipping card opens a blank canvas named Clip. Hand cuts on that canvas already work. The card comes off the home.
- **Next.** A local scan that offers a few in-out candidates, used from the ranking desk. That scan stays on this machine. It does not become its own editor, and it is not blocked because the file arrived from a link.

### Text, captions, and kinetic type

- **In the app.** Captions are the words on the picture for the clip that is playing. On the ranking desk that field is Caption, Paste captions fills the slots, and Show captions turns them on or off. On the canvas the same words are the Caption field, with the same switch. The headline, the highlight words, the stroke, the rank numeral, the font, the caption size, the caption color, and the warmth stay. Write line still writes that caption. Paste captions fills the selected cut and the cuts after it on the same track, one caption each.
- **Next.** A sound catalog, and a hit on top of the music file. One local music file is already the audio path. A second sound would be its own control, so it stays off this screen.
- **In the app, off the first screen.** Text Story opens a blank canvas. That card comes off the home. The line stays on the canvas.
- **Next.** Kinetic captions, emoji pops, a black plate, fade and bounce, word-level captions, and a caption lane that can delete a word.
- **Next.** Video Story and Text Story as their own desks, including a chat or card layout. The PDF’s iMessage, Reddit, and comment-ladder rigs live here.
- **In the app.** Write line sends the prompt the person asked for. If the model declines, that reply is shown. The app does not add its own block.

### Transcription

- **In the app.** Nothing that transcribes. The Video Transcriber card says “Coming later”, and it comes off the first screen.
- **Next.** Word-level captions from a local whisper build. NVIDIA Windows uses CUDA. Mac uses Metal. The transcriber card waits on a build that actually runs. `/opt/homebrew/bin/whisper` is openai-whisper and, on 2026-11-07, it fails at import because PyTorch cannot load `libabsl`. Do not call it from the app until that import works. There is no `faster-whisper` binary on this Mac.
- **Refused.** Uploading the boys’ footage, or anyone else’s, to a hosted transcription API as the default. A hosted call is allowed only when the person picked that connection for a line they typed.

### Voice

- **In the app.** Make voice on the canvas, for the clip under the playhead. The person picks an ElevenLabs or MiniMax row. The file is `flicks/<id>/voice.mp3`. The styled composition plays it at full level and keeps heard clip audio. Added music plays at 0.22, or at 0.10 while the voice file is present. The cut export muxes the voice and the music under the picture and still drops clip audio. Connections on the rail is where the key is saved and tested. The Generate AI Voiceover home card comes off the first screen.
- **Next.** A voice picker with a short preview on the desk, before the timeline. Two voices on one flick, for a chat story.

### Rendering

- **In the app.** Startup of the canvas calls the GPU probe and writes one line: the encoder name, or “software”, or “ffmpeg missing”.
- **In the app.** Export cut (`electron/cut.ts`). The top visible region’s clips are trimmed and concatenated with the probed ffmpeg. A clip that is already H.264 at 1080×1920 is stream-copied. Anything else is scaled and cropped, then encoded. Hardware encoders use `-b:v 8M`. The software fallback `libx264` uses `-preset veryfast -crf 20` on this cut path only. VideoToolbox, NVENC, QSV, and AMF are the probe order that can win. On this Mac the preference is VideoToolbox, then libx264. On Windows the preference is NVENC, then QSV, then AMF, then libx264. Remotion cannot use QSV or AMF. That is why the cut path exists. ffmpeg reads a file on this computer. `-ss` stays before `-i`. A network file is copied into the working-copies folder first.
- **In the app.** Export styled (`electron/styled.ts`). `renderMedia` uses `codec: "h264"`, `hardwareAcceleration: "if-possible"`, `videoBitrate: "8M"`, and `crf: null`. Mac uses VideoToolbox when the encoder allows it. Windows with NVIDIA uses NVENC. Anything else is software x264, and the encoder line has already said software. The styled picture includes the split, the headline, the rank, the line in the chosen font, size, and color, the warmth on the picture, the voice file, and the music credit when one is set. A region plays its own clip audio unless that track is muted. A voice file does not mute it. The picture is served from this computer. A network file is copied into the working-copies folder first.
- **In the app.** Mac dmg scripts are in `package.json` (`pack:mac`, `package:mac`, `dist:mac`, arm64). Windows scripts are in the same file: `pack:win`, `package:win`, `dist:win`, app id `com.go7studio.flicks`, NSIS installer `release/Go7Flicks-Setup-0.1.0.exe`. This Mac has not run that build. Drew and Wes run it on their own PCs. The steps are in section 9 and in `WINDOWS.md`.
- **Refused.** A `crf` setting on the styled path. It silently falls back to software x264. A Mac-only `--codec=h264-videotoolbox` flag as the product switch.

### Connections

- **In the app.** Claude, Codex, Grok, Cursor, ElevenLabs, MiniMax, and Other. Each row is one account. Test runs before the row is marked connected. A failed test leaves it disconnected and does not start a render.
- **In the app.** Claude can use the subscription helper already on this Mac, or a pasted Anthropic key. Codex can use the Codex CLI already on this Mac, or a pasted OpenAI key. ElevenLabs is a speech key. Test lists voices. MiniMax uses `https://api.minimax.io/v1` for lines and `/t2a_v2` for speech when that key is allowed to speak. Hear voice on those rows plays one short sample of the selected voice and does not write a flick's voice file. Other is a base URL, a key, and either `anthropic-messages` or `openai-completions`.
- **In the app.** Write line sends the channel name, the layout, and the clip label to the chat row the person picked, and writes the returned sentence onto that clip. The prompt asks for one spoken line and nothing else.
- **In the app.** Which clip uses that same chat row. ElevenLabs and MiniMax are not offered for it. The call is `askAssistant` in the main process. A missing or untested chat row is said on the control. The screen does not fill in a ranking of its own.
- **In the app.** Grok’s key login is `https://api.x.ai/v1` and model `grok-4.7`. Choosing Grok fills those, so only the key is typed. The Grok program already signed in on this computer can be used instead of a key. Cursor uses the `cursor-agent` program already on this computer and does not keep a second key. A Gemini API key can go on Other. This app does not call the Gemini app subscription or Antigravity.
- **Refused.** An auto-router. A usage ring. Pooling every key into one shared token. Reading Workhorse’s `credentialId` store.

### Export sizes

- **In the app.** One size. 1080×1920, 30 fps. That file is the Short, the Reel, and the TikTok. There is no size menu.
- **Next.** Another aspect ratio, 60 fps, or a 4K master. The PDF asks for 4K/60. That waits until 1080×1920 export is boring and reliable on both boys’ machines. Adding sizes before that spends the machine the preview needs.

### Performance budget

The numbers and the rules are in section 5. The budget is a feature: the UI stays cheap enough that a video preview and a background encode can share the machine.

## 4. UI principles

Locked 2026-11-07 to the frames Steve approved: `docs/concepts/home.png` (the light shell) and `docs/concepts/ranking.png` (the ranking desk). Quick Editor’s first screen is two cards only: Video Ranking and Split Screen. Dual video is the Split Screen desk, not a third home card. The presets are Face on top, Gameplay on top, Half, Face larger, and Gameplay larger. Both clips can be audible. Open timeline is gold. Auto Clipping, Video Commentary, Text Story, Video Transcriber, and Generate Image stay in the rail under Later. They are not the first click.

This layout is the baseline. It replaces the dense tool list. Minimal. One obvious next step. Low chrome. A kid can tell which button moves the work forward.

- **Home.** One greeting, three small pills, and two large cards on Quick Editor: Video Ranking and Split Screen. Lots of empty space. Library and Connections stay on the white rail. Later tools stay listed as later. They are not the first click.
- **Ranking desk and split desk.** The two starts. The ranking desk is a subject field and Find clips at the top of the inspector, a multiline headline, Which clip under that headline, accent words, rank on or off, a font, a line size, a line color, a warmth slider, Paste lines, 5, 6, or 7 slots, and Countdown, Listed, Skip around, or Shuffle. Skip around plays the ranks out of numeric order. Shuffle mixes play order and does not rewrite rank. Split Screen is the dual desk: Face on top, Gameplay on top, Half, Face larger, and Gameplay larger, and both clips can be audible. Each desk is a phone, a short list, and one quiet inspector. The split inspector labels Words on the face and Words on the gameplay in full. Open timeline is the gold button, and it is the handoff to the canvas. The window opens inside the desktop so Export stays on screen.
- **Canvas.** The shelf shows a readable clip name, with Made as the quiet date, and a raw filename is not a caption. An empty picture says No picture. The cut surface, and the only editor. Seam, trim, split, delete, reorder, undo, write line, make voice, add music, export. The inspector opens with Text and style: font, line size, line color, warmth, and Paste lines. Which clip sits under that block. On a flick with two or more visible regions the cut button says “Export cut · keeps the top picture”. With one visible region it says “Export cut”. Cut sound is the voice and the music. Export styled draws both halves, titles, the chosen font, the line, the warmth, voice, heard clip audio, and the music credit. There is no bundled song catalog and no second encode format. Files already added stay on this computer and can be used again. Styled stays `hardwareAcceleration: "if-possible"`, `videoBitrate: "8M"`, and `crf` null. A pasted link is Get. The app downloads it and keeps the address. Speed curves, face tracking, smart crop, SFX lanes, and a second timeline product stay off this screen.
- **Connections.** A short form and a list of rows. Test is the next step.
- **Channel.** A list of flicks plus New flick. Blank is chosen here.

Quick Editor’s first screen is already those two cards. Auto Clipping, Text Story, Video Commentary, Simple Editor, Video Transcriber, Generate Image, and Generate AI Voiceover stay later, listed in section 3. They are not the first click. The PDF’s CapCut deck is not added beside this canvas.

### Concept frames

Lovart returned both frames on 2026-11-07 after `lovart_confirm` with credit spend approved. Each thread had been waiting on a 15-credit confirm. Both confirms returned `done` and a PNG. The files on disk:

- Home: `docs/concepts/home.png` (2048×1280). Thread `75f9bb52-c3a1-4a21-8284-826897399a63`. White rail, the greeting, three pills, and four cards. Use the light shell. The saved frame still draws Auto Clipping, Video Commentary, and Text Story. The app’s Quick Editor does not. Those stay later, as section 2 says. Split Screen is the second start, and dual video is that desk, not a third home card. The frame drew that start under the name Video Commentary.
- Ranking: `docs/concepts/ranking.png` (2048×1280). Thread `3efa1f4b-03be-4356-942d-c51bad761be3`. This is the ranking desk: 9:16 phone, title on the frame, rank slots, Countdown / Listed / Shuffle, one inspector, Open timeline.

![Go7Flicks home concept](docs/concepts/home.png)

![Go7Flicks ranking concept](docs/concepts/ranking.png)

Dual video, generated 2026-11-07. Lovart thread `3b227893-8d9c-4230-a896-ce26abb7a03b`. `lovart_confirm` approved a `generate_media` step priced at 17 credits. The call returned `done` and this PNG. The ranking frame above stays the lock. This frame is the dual desk only: white chrome, one gold Open timeline button, a 9:16 phone split in half, face on top, gameplay below, and the seam presets beside it.

![Go7Flicks dual video concept](docs/concepts/dual-video.png)

## 5. Performance budget

Create and save of the project files stay on the UI only as small JSON. Video work and model work stay off that thread.

Checked once on 2026-11-07 with `npx tsx --test test/create-save.perf.test.ts` (`test/create-save.perf.test.ts`). The test makes a temp channel, a blank flick, and a ranking flick, saves them, checks the files, and deletes the temp folder. No network. No video. No app user-data.

| Step | Time |
| --- | --- |
| Create the channel, the blank flick, and the ranking flick, including the first save | 2.0 ms |
| Save both flicks again | 0.5 ms |
| The test body | 4.6 ms |
| The process, including tsx startup | 134.4 ms |

The ranking flick had 6 clips and no media. The blank flick had 0 clips. A few milliseconds is the budget for this path. A number in the hundreds of milliseconds on a later run means create or save started doing I/O it should not do.

What stays cheap:

- **Idle UI.** Home, Library, the channel list, and both desks are local React state. They do not start ffmpeg, Remotion’s renderer, whisper, or a model.
- **Preview.** `@remotion/player` scrubs in the window. It is not an encode. Ranking plays the selected clip. Split plays a side when that side is heard. They do not mount the player until Open timeline. Music is heard on the canvas.
- **Save.** The canvas writes `flick.json` after a 350 ms pause. That write is the same shape as the timing test.
- **API.** Write line is one short call, and only after the person presses the button and picks the row. Which clip is the same shape: one call after Ask which clip or What trend, through the chat row that is already connected, with a longer reply. Claude on this Mac uses cache none for that one-off line. No usage polling, no background router.
- **Background render.** One export at a time. The buttons wait on the main-process IPC. Cut is ffmpeg. Styled is Remotion plus the encode, and it is the heavy one. Do not start the other export while one is running. Do not start a second preview render beside the player.

How they share the machine:

- The player and a styled render both want the GPU. The player is already on screen. The render should be the only new encode. Leave headroom so the machine can still load the next video and keep the window moving.
- The cut path is the one that can use a Windows iGPU or an AMD card. Prefer it when the flick is a straight concat and does not need the drawn title.
- The GPU probe runs when the canvas opens, once. It does not re-probe on every keystroke.

What we will not do on the UI thread:

- ffmpeg encode or concat
- `renderMedia`
- whisper, scene detection, or a file scan that offers in-out candidates
- provider HTTP, including Write line and Make voice
- reading or writing secret files
- hashing or walking a NAS share

Those belong in the main process, or in a worker the main process starts. The renderer asks and waits.

## 6. Wiring Workhorse’s callers without merging

Workhorse stays a different app. Go7Flicks does not import it, does not read its user data, and does not resolve a Workhorse `credentialId`. The pattern to copy is: a subscription CLI that is already logged in on the computer, or a key stored with this app’s own `safeStorage`.

### What Go7Flicks already calls

`electron/providers.ts`

- `testProvider`, `writeLine`, `askAssistant`, `synthesize`

Which clip calls `askAssistant`. An ElevenLabs or MiniMax row is refused there. The reply keeps the model’s line breaks so the headline and the titles can be read back. Write line still asks for one spoken line.
- `runCli` for a Claude or Codex row whose login is “Subscription already on this computer”
- `testAnthropic` and `testOpenAI` for a pasted key
- `testEleven` and the ElevenLabs speech POST
- the MiniMax `/t2a_v2` speech POST

`electron/vault.ts`

- `saveSecret`, `readSecret`, `hasSecret`, `deleteSecret` under this app’s `userData/secrets`
- `encryptionReady` checks `safeStorage` before a key is written

Claude on this Mac already goes through `/Users/venomspike/.local/bin/anthropic-call`. Keep that. `runCli` calls it when the file exists:

`anthropic-call --account auto --model haiku --effort low --max-tokens 80 --cache none -- <prompt>`

`--account auto` follows the helper’s saved priority. That priority is secondary, then primary. Cache stays `none` for a one-off line. Go7Flicks does not open the helper’s key file. The helper does.

Codex on a subscription row currently calls `codex exec --skip-git-repo-check <prompt>` via `findBin("codex")`. On this Mac that binary is `/Users/venomspike/.local/bin/codex`. The call does not pass `--model`, so the CLI’s own default model is what answers.

### What Workhorse actually uses

Read these. Do not ship them inside Go7Flicks.

- `Go7-Workhorse-github/src/lib/providers.ts`: `PROVIDERS`, `providerById`, `isProviderId`. Codex is “Codex CLI via ACP” and uses the existing Codex login.
- `Go7-Workhorse-github/src/lib/types.ts`: `ProviderId` includes `codex`. A custom bot stores `credentialId` and an `api` of `anthropic-messages` or `openai-completions`. The desk resolves that id in its own encrypted store.
- `Go7-Workhorse-github/electron/codex-launch.ts`: `buildCodexLaunchSpec`, `resolveCodexModel`, `resolveCodexEffort`, `codexSpawnArgs`. The default model in that file is `gpt-5.6-sol`. A chosen slug such as `gpt-5.6-terra` is passed through. Effort is `model_reasoning_effort` inside `CODEX_CONFIG`, not a `--reasoning-effort` flag.
- `Go7-Workhorse-github/electron/codex-host.ts`: `spawnCodexProcess`, `CodexSessionHost`. This spawns `@agentclientprotocol/codex-acp` for a desk session.
- `Go7-Workhorse-github/electron/codex-login.ts`: `resolveCodexAcpLaunch`. The package name is `@agentclientprotocol/codex-acp`.

That ACP session is the right shape for the desk. It is the wrong shape for Write line. A one-sentence caption should stay a short CLI or API call.

### Codex Terra, and the caller to use for a line

No binary named Codex Terra, terra, or codex-terra exists under `~/bin` or `~/.local/bin`. The search there found `codex`, `codex-api-call`, `codex-session-finish.py`, and `codex-session-storage.py`. Under `~/.openclaw` and the Workhorse repo, Terra is the model id `gpt-5.6-terra`.

Two callers already know that id. Both were found. Neither key was printed.

- Saved API, used for the language pass in this bible: `/Users/venomspike/.local/bin/codex-api-call --model gpt-5.6-terra --effort low`. It POSTs to `https://api.openai.com/v1/responses` with the key it already has (`CODEX_API_KEY`, or its dedicated secrets file, then `OPENAI_API_KEY`). `gpt-5.6-terra` is in that account’s model list, along with `gpt-5.6-sol`, `gpt-5.6-luna`, and `gpt-6.1-terra`. The alias `codex` in that script means `gpt-6.1-sol`, so a Terra review has to pass the full model id.
- Subscription CLI, used by the Qualora pipeline: `openai_generate_via_codex` in `~/.openclaw/workspace/skills-lms-pipeline/scripts/openai_client.py`. It runs `codex exec --model gpt-5.6-terra --json --skip-git-repo-check`, and for a read-only question it adds `-s read-only` and `-c model_reasoning_effort=low`. Retired model names in that file map onto `gpt-5.6-terra`. It uses the Codex CLI login in `~/.codex/auth.json`. It does not use the Responses API key.

Recommended wiring for the Codex row in this app:

- Subscription login: change `runCli` so the row’s model is `codex exec --model <model> --skip-git-repo-check`, with `-c model_reasoning_effort=low` for Write line. When the person wants Terra, the model field is `gpt-5.6-terra`. Do not spawn `codex-acp` for that button.
- Pasted key: keep `testOpenAI` and this app’s vault. The person picks the row. The key never goes in the channel folder.
- Do not point Go7Flicks at `codex-api-call`’s secrets file, and do not point it at Workhorse’s `credentialId` files. `codex-api-call` remains the machine tool for a one-off review like the one in this bible. The app has its own store.
- Do not add an auto-router, and do not call Workhorse’s `routing.ts`.

MiniMax and ElevenLabs stay as they are in `synthesize`. Grok’s key row uses the OpenAI-compatible host at `https://api.x.ai/v1` with model `grok-4.7`. Cursor is the local agent, not a stored key. A Gemini API key can go on Other. This app does not call the Gemini app subscription or Antigravity.

## 7. Auto clipping, text, transcription, and rendering

### Auto clipping

Intended behavior. The person picks a long file that is already on the computer. The app offers a few in and out points. The person accepts or moves them. The scan uses audio energy or a local scene cut on that file, then the ranking or the canvas stores the points. Nothing is uploaded. A URL in the link field is ignored by the scanner.

Prebuilt. Hand cuts on the blank canvas, and in/out fields on the ranking desk. `splitClip`, `trimClip`, and `deleteClip` already close gaps.

Still to build. The candidate scan, and a desk that shows the candidates before Open timeline. The home card can keep opening the blank canvas until that exists, and its sentence should say so.

Get uses yt-dlp in the main process and writes the file into the channel. If that folder is on a network drive, preview and export use the working copy on this computer.

### Text overlays

Intended behavior. A title on the frame, a few words in the highlight color, a stroke, a rank number, and one spoken line on the active cut. The text uses Segoe UI, Arial, Georgia, or Impact. The line under the headline has its own size and color. Picture warmth is one slider. Paste lines fills the slots, or the selected cuts, one line each. Kinetic captions, emoji, and a black plate come after the line is reliable. A sound catalog stays off.

Prebuilt. `FlickComposition` draws the headline, the highlight, the rank numeral from a label like `#5`, and the line or the label as the caption, in the chosen font, size, and color, with the warmth wash on the picture. The ranking desk has the same title treatment on the phone. The canvas has the line field, Paste lines, and Write line. Save as template keeps the font, the line size, the line color, and the warmth, and still drops the media.

Still to build. Motion, per-word timing, emoji, the plate, and dragging the clip title. Word timing depends on transcription.

Write line sends the prompt the person wrote. The app does not strip it. If the model declines, that reply is shown.

### Transcription

Intended behavior. A local whisper build returns words with times. The caption layer uses those times. CUDA on NVIDIA Windows, Metal on Mac. The person can turn it on from the transcriber card. Until the binary runs, the card stays a banner and the line is typed.

Prebuilt. The card and the banner. A broken Homebrew whisper at `/opt/homebrew/bin/whisper`. No working local timestamp path is wired.

Still to build. A main-process call that only runs after the import works, writes word times onto the flick, and never blocks the UI thread.

A hosted call runs when the person picked that connection. The app does not add its own block.

### Rendering

Intended behavior. Two buttons, already named in section 3. Cut is the fast path when the clips can be concatenated and the drawn title is unnecessary. Styled is the path when the split, the title, and the voice have to be in the picture. The encoder line is visible before either button is pressed. One export runs at a time.

Prebuilt. `probeGpu` and `chooseEncoder` in `electron/probe.ts`. `exportCut` in `electron/cut.ts`. `renderFlick` in `electron/styled.ts`. A bundled `ffmpeg-static` for the cut path. Remotion keeps its own ffmpeg for the styled path. `scripts/verify-export.ts` is the existing export check. This bible’s timing test does not run it, and it is not a render marathon.

Still to build. The Windows NSIS package on a Windows PC, so NVENC, QSV, and AMF are proven on the boys’ machines. The Mac package cannot prove those encoders.

Local-only. Output is an MP4 the person chose. No upload step.

## 8. Open decisions and the order to build next

Nothing in the “next” list above is dropped. The order is the one that keeps the screen obvious and the machine usable.

The first screen is already simplified. Quick Editor is two cards only: Video Ranking and Split Screen. Dual video is the Split Screen desk, not a third home card. Presets are Face on top, Gameplay on top, Half, Face larger, and Gameplay larger. Both clips can be audible. Open timeline is gold. The ranking desk keeps a multiline headline, accent words, rank on or off, a font, a line size, a line color, warmth, Paste lines, 5, 6, or 7 slots, and Countdown, Listed, Skip around, or Shuffle. Skip around plays the ranks out of numeric order. Shuffle mixes play order and does not rewrite rank. On a flick with two or more visible regions the cut button says “Export cut · keeps the top picture”. With one visible region it says “Export cut”. Export styled is unchanged and is the render that draws both halves, titles, and voice. There is no second encode format. Styled stays `hardwareAcceleration: "if-possible"`, `videoBitrate: "8M"`, and `crf` null. A pasted link is downloaded when the person presses Get. Last test, on 2026-11-07, is that baseline. Later tools stay in the list below. They are not the first click.

1. **Codex model on the subscription row.** Done. Write line passes the row model into `codex exec` at low effort. An empty model field uses `gpt-6.1-terra`. The vault stays the only key store. A live caption still needs a Codex row in this app’s Connections. Do not read the `codex-api-call` secrets file.
2. **Local in-out scan.** Quick Editor already shows Video Ranking and Split Screen, and the later tools are not the first click. Next is the local in-out scan inside the ranking desk, for a file already on the machine.
3. **A whisper that runs.** Fix or replace the broken local whisper before the transcriber card does anything. Word times land on the flick from the main process.
4. **Ranking polish.** Fade and bounce, drag the clip title under the headline, a number on one slot, a black plate behind the headline.
5. **Story desks.** Commentary that turns a script into scenes. Text-story and chat-story templates. Video Story as its own card.
6. **Caption motion and the rest of the PDF’s timeline toys.** Kinetic captions, emoji pops, silence strip, speed curves, face tracking, smart crop, SFX lanes. After word times exist. Still no Remotion Timeline purchase. Get already downloads a pasted link.
7. **Gemini API.** A Gemini API key can go on Other. The Gemini app subscription and Antigravity stay refused. No auto-router and no usage rings.
8. **Windows package.** Drew or Wes runs `npm run dist:win` on his own PC. This Mac has not built it. Confirm the encoder line there. Steps are in section 9.
9. **The $10 month.** Only after both boys can make a channel on their own PCs, and only after the Remotion Automators minimum is the number in front of the price. AI Image Generator and AI Video Generator stay next, and they stay out of the build until the clips the boys already have are easy to cut.

Find clips is on the ranking desk. It searches a named subject and fills empty slots. Which clip stays on the ranking desk and on the canvas. A vague “make me something viral” request is not a search. The subject is the point.

Still refused, in that same future: embedding the Remotion Timeline, setting `crf` on the styled export, and opening Workhorse’s secret store. If a model declines a line, that reply is the model’s.

## 9. Drew and Wes on Windows

Both boys run Windows. The public page is `https://go7studio.com/products/go7-flicks`. Anyone with the link can open it, including a friend who is not in the family. No Go7 account and no GitHub login. Another PC installs from `Go7Flicks-Setup-<version>.exe`. `npm run dist:win` builds that file. The page and the public setup file are not live yet. This checkout has built `release\Go7Flicks-Setup-0.1.0.exe`. That file is unsigned, it is not in git, and it is not posted. The short steps they follow are also in `WINDOWS.md`.

What is already in the repo, in `package.json`:

- `npm run pack:win` builds the app and writes an unpacked Windows folder with `electron-builder --win --dir`.
- `npm run package:win` runs `electron-builder --win nsis --publish never`. It expects `npm run build` to have finished first.
- `npm run dist:win` is the command to use. It runs the build, then `package:win`.
- App id: `com.go7studio.flicks`. Product name: Go7Flicks. Executable name: Go7Flicks.
- NSIS is not one-click. It is per user, it can change the install folder, and it adds a desktop shortcut and a Start menu shortcut. Uninstall does not delete app data.
- The installer file the script writes is `release/Go7Flicks-Setup-0.1.0.exe`. A Windows run on this checkout produced that file. It is unsigned and not committed. `release/` stays gitignored.
- The Windows icon is already `build/icon.ico`. `package.json` sets `build.win.icon` to that file. `build/icon.svg`, `build/icon.png`, and `build/icon.icns` are in the repo for the Mac package.

Drew, on his PC: install Node, clone `https://github.com/SteveMLC/go7-flicks.git`, run `npm install`, then `npm run dist:win`. Run `release\Go7Flicks-Setup-0.1.0.exe` and open Go7Flicks. Library, New channel, pick a folder on that PC. From home, open Video Ranking or Dual video, add clips that are already on the PC, then Open timeline. The encoder line on the canvas should read `h264_nvenc`, `h264_qsv`, `h264_amf`, or `software (libx264)`. Export cut or Export styled. Styled export uses Remotion `hardwareAcceleration: "if-possible"`, 8 Mbps, and no crf. On this Mac that encoder is `h264_videotoolbox`. On Windows with NVIDIA it is `h264_nvenc`. Intel QSV and AMD AMF are not in Remotion's styled path. A pasted link is Get. The app downloads it into the channel.

Wes, on his PC: open `https://go7studio.com/products/go7-flicks`. He can send that link to a friend. He does not clone the repo or run `dist:win`. When the setup file is posted, he downloads `Go7Flicks-Setup-<version>.exe` from that page. Windows says unknown publisher, so he takes the file only from that page, then chooses More info, then Run anyway. The page and the file are not live yet. Until the file is posted, an installer from a Windows build, copied onto his machine, installs the same app. His Connections and his saved templates stay on his install. Drew’s stay on Drew’s.

One channel folder can be copied from one PC to the other. The other boy uses Open folder. The flicks come with the folder. Connections and templates do not.

## Where the code lives

| Piece | Path |
| --- | --- |
| Home, ranking, split, canvas, channel, connections, Which clip | `src/ui/` |
| Which clip prompt and reply reading | `src/shared/assist.ts` |
| Frame, clips, connections model | `src/shared/model.ts` |
| Templates, cuts, playback order | `src/shared/canvas.ts` |
| Styled picture | `src/remotion/FlickComposition.tsx` |
| Keys | `electron/vault.ts` |
| Claude, Codex, ElevenLabs, MiniMax, Other | `electron/providers.ts` |
| Channel files | `electron/library.ts` |
| Link download | `electron/download.ts` |
| GPU probe | `electron/probe.ts` |
| Cut export | `electron/cut.ts` |
| Styled export | `electron/styled.ts` |
| Create and save timing | `test/create-save.perf.test.ts` |
| Home concept | `docs/concepts/home.png` |
| Ranking concept | `docs/concepts/ranking.png` |
| Dual video concept | `docs/concepts/dual-video.png` |
| Drew and Wes steps | `WINDOWS.md` |

## Last test

2026-11-07. Drove the running Electron app on port 9223 through home, the ranking desk, the split desk, and the canvas. Cut export 192 ms (top picture). Styled export 3784 ms, encoder h264_videotoolbox, 1080×1920, 30 fps, about 1 second, both pictures and audio. A fake TikTok link was stored on a clip and was not fetched.

2026-11-10. Which clip is on the ranking desk under the headline, and on the canvas under Text and style. No chat row was connected. Claude’s login had expired, Codex was untested, and Cursor was not logged in. The control said so and did not invent a ranking.
