import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Video, useCurrentFrame, useVideoConfig } from "remotion";
import { lineColorOf, lineSizeOf, spokenLine, titleFontFamily, visibleRegions, warmthWash } from "../shared/canvas";
import { VOICE_VOLUME, clipAudible, musicVolume } from "../shared/mix";
import { type Region, type Track, clipDuration } from "../shared/model";

export type RenderClip = {
  id: string;
  trackId: string;
  startSec: number;
  inSec: number;
  outSec: number;
  label: string;
  line?: string;
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
  titleFont?: string;
  lineColor?: string;
  lineSize?: number;
  pictureWarmth?: number;
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
};

export const FlickComposition = (props: FlickProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const regions = visibleRegions(props.regions);
  const active = regions
    .map((region) => props.clips.find((clip) => clip.trackId === region.trackId && inside(clip, time)))
    .find(Boolean);
  const caption = spokenLine(active?.line);
  const rank = props.showRank === false ? "" : rankNumber(active?.label);
  const Picture = props.preview ? Video : OffthreadVideo;
  const wash = warmthWash(props.pictureWarmth);
  const lineColor = lineColorOf(props.lineColor);
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
          </div>
        );
      })}
      {props.headline ? (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            top: 64,
            textAlign: "center",
            color: "#fffdf8",
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -0.5,
            background: "rgba(28, 25, 21, 0.72)",
            borderRadius: 18,
            padding: "14px 16px",
          }}
        >
          {paintWords(props.headline, props.headlineColor || props.accent, props.accentWords || "")}
        </div>
      ) : null}
      {rank ? (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            top: 420,
            textAlign: "center",
            color: "#e2b340",
            fontSize: 140,
            fontWeight: 800,
            WebkitTextStroke: "12px #1c1915",
            paintOrder: "stroke fill",
            background: "rgba(28, 25, 21, 0.35)",
            borderRadius: 24,
          }}
        >
          {rank}
        </div>
      ) : null}
      {caption ? (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            top: props.headline ? 640 : "46%",
            textAlign: "center",
            color: lineColor,
            fontSize: lineSize,
            fontWeight: 800,
            letterSpacing: 0.2,
            lineHeight: 1.15,
            background: "rgba(28, 25, 21, 0.78)",
            borderRadius: 16,
            padding: "12px 16px",
            WebkitTextStroke: props.headline ? `${Math.min(props.titleStroke ?? 6, 8)}px #1c1915` : undefined,
            paintOrder: "stroke fill",
          }}
        >
          {caption}
        </div>
      ) : null}
      {props.musicSrc ? <Audio src={props.musicSrc} loop volume={musicVolume(Boolean(props.voiceSrc))} /> : null}
      {props.voiceSrc ? <Audio src={props.voiceSrc} volume={VOICE_VOLUME} /> : null}
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
        return (
          <span key={index} style={{ color: hit ? color : "#fff" }}>
            {part}
          </span>
        );
      })}
    </div>
  ));
}

function inside(clip: RenderClip, time: number): boolean {
  return time >= clip.startSec && time < clip.startSec + Math.max(clip.outSec - clip.inSec, 0);
}
