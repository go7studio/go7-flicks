import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Video, useCurrentFrame, useVideoConfig } from "remotion";
import { accentOnPaper, inkOnPaper, lineSizeOf, spokenLine, titleFontFamily, visibleRegions, warmthWash } from "../shared/canvas";
import { VOICE_VOLUME, clipAudible, musicVolume } from "../shared/mix";
import { type Clip, type Flick, type Region, type Track, clipDuration, storedVoiceStart } from "../shared/model";

export type RenderClip = {
  id: string;
  trackId: string;
  startSec: number;
  inSec: number;
  outSec: number;
  label: string;
  line?: string;
  /** The media file name. A caption that is only that name stays off the picture. */
  fileName?: string;
  src?: string;
  focus?: number;
};

export type FlickProps = {
  fps: number;
  width: number;
  height: number;
  accent: string;
  regions: Region[];
  tracks: Track[];
  clips: RenderClip[];
  voiceSrc?: string;
  musicSrc?: string;
  musicCredit?: string;
  preview: boolean;
  headline?: string;
  headlineColor?: string;
  accentWords?: string;
  titleStroke?: number;
  showRank?: boolean;
  showCaptions?: boolean;
  titleFont?: string;
  lineColor?: string;
  lineSize?: number;
  pictureWarmth?: number;
  /** Seconds from the start of the flick before the voice begins. */
  voiceStartSec?: number;
};

export const emptyFlickProps: FlickProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  accent: "#e2b340",
  regions: [],
  tracks: [],
  clips: [],
  preview: false,
  voiceStartSec: 0,
};

export const FlickComposition = (props: FlickProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const regions = visibleRegions(props.regions);
  const active = regions
    .map((region) => props.clips.find((clip) => clip.trackId === region.trackId && inside(clip, time)))
    .find(Boolean);
  const rank = props.showRank === false ? "" : rankNumber(active?.label);
  const captions = new Map(
    collectRegionLines(props.regions, props.clips, time, props.showCaptions).map((item) => [item.regionId, item.line]),
  );
  const voiceFrom = Math.max(0, Math.round(voiceStartOf(props) * fps));
  const Picture = props.preview ? Video : OffthreadVideo;
  const wash = warmthWash(props.pictureWarmth);
  const lineColor = inkOnPaper(props.lineColor);
  const lineSize = lineSizeOf(props.lineSize);

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505", fontFamily: titleFontFamily(props.titleFont) }}>
      {props.regions.map((region) => {
        if (region.hidden || region.height <= 0.01) return null;
        const track = props.tracks.find((item) => item.id === region.trackId);
        const mute = !clipAudible(track, Boolean(props.voiceSrc));
        return (
          <div
            key={region.id}
            style={{
              position: "absolute",
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
              overflow: "hidden",
              background: "#14140f",
            }}
          >
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                color: "#f8f1e3",
                fontSize: 48,
                fontWeight: 750,
                letterSpacing: -0.4,
              }}
            >
              No picture
            </AbsoluteFill>
            {props.clips
              .filter((clip) => clip.trackId === region.trackId)
              .map((clip) => {
                const duration = Math.max(1, Math.round(clipDuration(clip) * fps));
                const from = Math.max(0, Math.round(clip.startSec * fps));
                return (
                  <Sequence key={clip.id} from={from} durationInFrames={duration}>
                    {clip.src ? (
                      <Picture
                        src={clip.src}
                        startFrom={Math.max(0, Math.round(clip.inSec * fps))}
                        muted={mute}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          objectPosition: `${((clip.focus ?? 0.5) * 100).toFixed(1)}% center`,
                        }}
                      />
                    ) : null}
                  </Sequence>
                );
              })}
            {wash ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: wash,
                  mixBlendMode: "soft-light",
                  pointerEvents: "none",
                }}
              />
            ) : null}
            {captions.get(region.id) ? (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: "6%",
                  transform: "translateX(-50%)",
                  maxWidth: "88%",
                  width: "max-content",
                  textAlign: "center",
                  color: lineColor,
                  fontSize: lineSize,
                  fontWeight: 750,
                  letterSpacing: 0,
                  lineHeight: 1.2,
                  background: "#fffdf8",
                  borderRadius: 999,
                  padding: "14px 28px",
                }}
              >
                {captions.get(region.id)}
              </div>
            ) : null}
          </div>
        );
      })}
      {rank ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 36,
            transform: "translateX(-50%)",
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 220,
            height: 250,
            background: "#e2b340",
            color: "#1c1915",
            fontSize: 132,
            fontWeight: 800,
            lineHeight: 1,
            borderRadius: "48px 48px 64px 64px",
          }}
        >
          {rank}
        </div>
      ) : null}
      {props.headline ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: rank ? 310 : 48,
            transform: "translateX(-50%)",
            zIndex: 4,
            maxWidth: "88%",
            width: "max-content",
            textAlign: "center",
            color: "#1c1915",
            fontSize: 56,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -0.4,
            background: "#fffdf8",
            borderRadius: 28,
            padding: "16px 28px",
          }}
        >
          {paintWords(props.headline, props.headlineColor || props.accent, props.accentWords || "")}
        </div>
      ) : null}
      {props.musicSrc ? <Audio src={props.musicSrc} loop volume={musicVolume(Boolean(props.voiceSrc))} /> : null}
      {props.voiceSrc ? (
        <Sequence from={voiceFrom}>
          <Audio src={props.voiceSrc} volume={VOICE_VOLUME} />
        </Sequence>
      ) : null}
      {props.musicSrc && props.musicCredit ? (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            bottom: 64,
            textAlign: "center",
            color: "#fff",
            fontSize: 28,
            fontWeight: 650,
            lineHeight: 1.2,
            textShadow: "0 2px 8px rgba(0,0,0,0.9)",
          }}
        >
          {props.musicCredit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

function rankNumber(label: string | undefined): string {
  const match = label?.match(/^#(\d+)$/);
  return match?.[1] ?? "";
}

function paintWords(text: string, color: string, words: string) {
  const keys = words
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return text.split("\n").map((line, lineIndex) => (
    <div key={lineIndex}>
      {line.split(/(\s+)/).map((part, index) => {
        const hit = keys.some((key) => part.toLowerCase().includes(key));
        const mark = accentOnPaper(color);
        return (
          <span
            key={index}
            style={{
              color: hit ? mark.color : "#1c1915",
              background: hit ? mark.background : undefined,
              borderRadius: hit && mark.background ? 10 : undefined,
              padding: hit && mark.background ? "0 8px" : undefined,
            }}
          >
            {part}
          </span>
        );
      })}
    </div>
  ));
}

function inside(clip: { startSec: number; inSec: number; outSec: number }, time: number): boolean {
  return time >= clip.startSec && time < clip.startSec + Math.max(clip.outSec - clip.inSec, 0);
}

export type CaptionRegion = {
  id: string;
  trackId: string;
  y: number;
  height: number;
  hidden: boolean;
};

export type CaptionClip = {
  trackId: string;
  startSec: number;
  inSec: number;
  outSec: number;
  line?: string;
  fileName?: string;
};

/** Spoken words for every visible region that has a clip at this time. */
export function collectRegionLines(
  regions: CaptionRegion[],
  clips: CaptionClip[],
  time: number,
  showCaptions: boolean | undefined,
): { regionId: string; line: string }[] {
  if (showCaptions === false) return [];
  return regions
    .filter((region) => !region.hidden && region.height > 0.01)
    .sort((a, b) => a.y - b.y)
    .flatMap((region) => {
      const clip = clips.find((item) => item.trackId === region.trackId && inside(item, time));
      const line = spokenLine(clip?.line, clip?.fileName);
      return line ? [{ regionId: region.id, line }] : [];
    });
}

/**
 * A new import keeps a caption the person already typed.
 * The file name stays on the media. It is never written into the caption, and a typed caption is never sliced.
 */
export function captionFromFile(existing: string | undefined, fileName: string): string {
  if (existing && existing.trim()) return existing;
  if (fileName.trim()) return "";
  return "";
}

/** Read voiceStartSec when the object carries it. Old flicks omit the field. */
export function voiceStartOf(source: object | null | undefined): number {
  if (!source || !("voiceStartSec" in source)) return 0;
  const value = (source as { voiceStartSec?: unknown }).voiceStartSec;
  return storedVoiceStart(typeof value === "number" ? value : undefined);
}

export type DeskOpenFields = {
  name: string;
  editedTrackIds: string[];
  clips: Clip[];
  regions?: Region[];
  tracks?: Track[];
  headline?: string;
  headlineColor?: string;
  accentWords?: string;
  titleStroke?: number;
  showRank?: boolean;
  showCaptions?: boolean;
  titleFont?: string;
  lineColor?: string;
  lineSize?: number;
  pictureWarmth?: number;
};

export type DeskOpenPlan = {
  id: string;
  voiceKept: boolean;
  flick: Flick;
};

/** An empty headline stays empty. Undefined means the desk default. */
export function headlineFromFlick(headline: string | undefined, fallback: string): string {
  return headline === undefined ? fallback : headline;
}

/** A caption is the spoken line. The clip label, including a filename stem, is not one. */
export function titleFromClip(clip: { line?: string; label?: string } | null | undefined): string {
  return clip?.line ?? "";
}

/** Dual video uses face and gameplay. A split-screen flick uses the top and bottom tracks. */
export function splitTrackPair(source: { templateId?: string; tracks?: { id: string }[] } | null | undefined): { face: string; game: string } {
  const ids = new Set((source?.tracks ?? []).map((track) => track.id));
  if (source?.templateId === "builtin-split") return { face: "track-top", game: "track-bottom" };
  if (source?.templateId === "builtin-dual" || ids.has("track-face") || ids.has("track-game")) {
    return { face: "track-face", game: "track-game" };
  }
  if (ids.has("track-top") && ids.has("track-bottom")) return { face: "track-top", game: "track-bottom" };
  return { face: "track-face", game: "track-game" };
}

/**
 * Update the open flick when one already exists.
 * A new desk gets no voice file, so voiceRelative and voiceStartSec stay off.
 * Clips on tracks the desk is not editing stay, including Loop media.
 */
export function openDeskFlick(existing: Flick | null, desk: DeskOpenFields): DeskOpenPlan {
  const edited = new Set(desk.editedTrackIds);
  if (!existing) {
    return {
      id: "",
      voiceKept: false,
      flick: {
        id: "",
        name: desk.name,
        fps: 30,
        width: 1080,
        height: 1920,
        regions: desk.regions ?? [],
        tracks: desk.tracks ?? [],
        clips: desk.clips,
        headline: desk.headline,
        headlineColor: desk.headlineColor,
        accentWords: desk.accentWords,
        titleStroke: desk.titleStroke,
        showRank: desk.showRank,
        showCaptions: desk.showCaptions,
        titleFont: desk.titleFont,
        lineColor: desk.lineColor,
        lineSize: desk.lineSize,
        pictureWarmth: desk.pictureWarmth,
        voiceRelative: undefined,
        voiceStartSec: undefined,
        musicId: undefined,
        musicCredit: undefined,
      },
    };
  }
  const voiceRelative = existing.voiceRelative;
  return {
    id: existing.id,
    voiceKept: Boolean(voiceRelative),
    flick: {
      ...existing,
      id: existing.id,
      name: desk.name,
      regions: desk.regions ?? existing.regions,
      tracks: desk.tracks ?? existing.tracks,
      clips: [...desk.clips, ...existing.clips.filter((clip) => !edited.has(clip.trackId))],
      headline: desk.headline !== undefined ? desk.headline : existing.headline,
      headlineColor: desk.headlineColor !== undefined ? desk.headlineColor : existing.headlineColor,
      accentWords: desk.accentWords !== undefined ? desk.accentWords : existing.accentWords,
      titleStroke: desk.titleStroke !== undefined ? desk.titleStroke : existing.titleStroke,
      showRank: desk.showRank !== undefined ? desk.showRank : existing.showRank,
      showCaptions: desk.showCaptions !== undefined ? desk.showCaptions : existing.showCaptions,
      titleFont: desk.titleFont !== undefined ? desk.titleFont : existing.titleFont,
      lineColor: desk.lineColor !== undefined ? desk.lineColor : existing.lineColor,
      lineSize: desk.lineSize !== undefined ? desk.lineSize : existing.lineSize,
      pictureWarmth: desk.pictureWarmth !== undefined ? desk.pictureWarmth : existing.pictureWarmth,
      voiceRelative,
      musicId: existing.musicId,
      musicCredit: existing.musicCredit,
      voiceStartSec: voiceRelative ? existing.voiceStartSec : undefined,
    },
  };
}
