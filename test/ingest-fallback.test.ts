import assert from "node:assert/strict";
import test from "node:test";
import { cutFromImpacts } from "../electron/action";
import { delayVoiceInFilter, styledVoiceStart, voiceDelayFilter, voiceMuxArgs } from "../electron/cut";
import { chooseFinishedDownload, downloadStep, isFinishedDownload, searchArgs, ytdlpDownloadArgs } from "../electron/download";
import { mime } from "../electron/media-server";
import { storedVoiceStart } from "../src/shared/model";

const sort = "vcodec:h264,res:1080,acodec:m4a";

test("a download prefers h264 1080 aac mp4 and falls back when that format is missing", () => {
  const preferred = ytdlpDownloadArgs({
    ffmpegPath: "C:\\tools\\ffmpeg.exe",
    outputTemplate: "out.%(ext)s",
    link: "https://example.com/v",
    preferred: true,
  });
  assert.equal(preferred[preferred.indexOf("--merge-output-format") + 1], "mp4");
  assert.equal(preferred[preferred.indexOf("-S") + 1], sort);
  assert.ok(preferred.includes("--no-overwrites"));
  assert.equal(preferred.at(-1), "https://example.com/v");

  const fallback = ytdlpDownloadArgs({
    ffmpegPath: "C:\\tools\\ffmpeg.exe",
    outputTemplate: "out.%(ext)s",
    link: "https://example.com/v",
    preferred: false,
  });
  assert.equal(fallback.includes("--merge-output-format"), false);
  assert.equal(fallback.includes("-S"), false);
  assert.equal(fallback.at(-1), "https://example.com/v");
  assert.ok(fallback.includes("--no-playlist"));

  assert.equal(downloadStep(null, false), "preferred");
  assert.equal(downloadStep(null, true), "fallback");
  assert.equal(downloadStep("D:\\channel\\media\\already.mp4", true), "stored");
});

test("search passes utf-8 to yt-dlp", () => {
  const args = searchArgs("ytsearch40:dogs");
  assert.equal(args[args.indexOf("--encoding") + 1], "utf-8");
  assert.ok(args.includes("--skip-download"));
  assert.equal(args.at(-1), "ytsearch40:dogs");
});

test("no impact keeps the file from the start for at most four seconds", () => {
  const empty = cutFromImpacts([], 9);
  assert.equal(empty.inSec, 0);
  assert.equal(empty.outSec, 4);
  assert.equal(empty.focus, 0.5);
  const short = cutFromImpacts([], 2.5);
  assert.equal(short.inSec, 0);
  assert.equal(short.outSec, 2.5);
  assert.equal(short.focus, 0.5);
  const hit = cutFromImpacts([8.4], 19.68);
  assert.equal(hit.inSec, 8.4);
  assert.equal(hit.focus, 0.5);
  assert.ok(hit.outSec > 8.4);
  assert.ok(hit.outSec - hit.inSec <= 4.01);
});

test("mkv m4a and aac keep a player mime", () => {
  assert.equal(mime("clip.mkv"), "video/x-matroska");
  assert.equal(mime("C:\\media\\clip.MKV"), "video/x-matroska");
  assert.equal(mime("voice.m4a"), "audio/mp4");
  assert.equal(mime("voice.aac"), "audio/aac");
  assert.equal(mime("clip.mp4"), "video/mp4");
  assert.equal(mime("clip.m4v"), "video/mp4");
  assert.equal(mime("clip.webm"), "video/webm");
  assert.equal(mime("clip.mov"), "video/quicktime");
  assert.equal(mime("song.mp3"), "audio/mpeg");
  assert.equal(mime("song.wav"), "audio/wav");
  assert.equal(mime("still.png"), "image/png");
  assert.equal(mime("clip.avi"), "application/octet-stream");
});

test("styled export props include the voice offset", () => {
  const props = {
    voiceSrc: "http://127.0.0.1/file?path=voice.mp3",
    musicSrc: undefined,
    voiceStartSec: styledVoiceStart({ voiceStartSec: 1.25 }),
  };
  assert.equal(props.voiceStartSec, 1.25);
  assert.equal(styledVoiceStart({}), 0);
  assert.equal(styledVoiceStart({ voiceStartSec: undefined }), 0);
});

test("cut export delays the voice by the offset and leaves the picture", () => {
  const still = voiceMuxArgs("silent.mp4", "voice.mp3", "out.mp4", undefined);
  assert.equal(still.some((arg) => String(arg).includes("adelay")), false);
  assert.ok(still.includes("[1:a]apad[a]"));
  assert.equal(still[still.indexOf("-map") + 1], "0:v");
  assert.ok(still.includes("-shortest"));
  assert.equal(voiceDelayFilter(0), "");
  const delayed = voiceMuxArgs("silent.mp4", "voice.mp3", "out.mp4", 1.25);
  assert.ok(delayed.includes("[1:a]adelay=1250|1250,apad[a]"));
  assert.equal(delayed[delayed.indexOf("-map") + 1], "0:v");
  assert.equal(delayed.includes("-c:v") && delayed[delayed.indexOf("-c:v") + 1], "copy");
  const graph = "[2:a]apad,volume=1.0[voice];[1:a]volume=0.10[music];[voice][music]amix=inputs=2:normalize=0:duration=longest:dropout_transition=0[a]";
  assert.equal(delayVoiceInFilter(graph, 0), graph);
  assert.match(delayVoiceInFilter(graph, 1.25), /\[2:a\]adelay=1250\|1250,apad,volume=1\.0\[voice\]/);
});

test("a partial leftover does not skip the download fallback", () => {
  assert.equal(isFinishedDownload("clip.f137.mp4"), false);
  assert.equal(isFinishedDownload("clip.f140.m4a"), false);
  assert.equal(isFinishedDownload("clip.mp4.part"), false);
  assert.equal(isFinishedDownload("Parkour.mp4"), true);
  assert.equal(chooseFinishedDownload(["clip.f137.mp4", "clip.f140.m4a", "clip.mp4.part"]), null);
  assert.equal(chooseFinishedDownload(["clip.f137.mp4", "Parkour.mp4"]), "Parkour.mp4");
  assert.equal(downloadStep("D:\\tmp\\clip.f137.mp4", true), "fallback");
  assert.equal(downloadStep("D:\\tmp\\clip.mp4.part", true), "fallback");
  assert.equal(downloadStep("D:\\tmp\\clip.mp4", true), "stored");
});

test("voice start is one offset and zero when omitted", () => {
  assert.equal(storedVoiceStart(undefined), 0);
  assert.equal(storedVoiceStart(Number.NaN), 0);
  assert.equal(storedVoiceStart(-1), 0);
  assert.equal(storedVoiceStart(1.2346), 1.235);
});
