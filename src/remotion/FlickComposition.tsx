import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Video, useCurrentFrame, useVideoConfig } from "remotion";
import { visibleRegions } from "../shared/canvas";
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
  const caption = props.headline ? active?.line || "" : active?.line || active?.label || "";
  const rank = props.showRank === false ? "" : rankNumber(active?.label);
  const Picture = props.preview ? Video : OffthreadVideo;

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505", fontFamily: "Avenir Next, Segoe UI, sans-serif" }}>
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
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <AbsoluteFill
                        style={{
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#6f6a5c",
                          fontSize: 42,
                          fontWeight: 700,
                        }}
                      >
                        {clip.label}
                      </AbsoluteFill>
                    )}
                  </Sequence>
                );
              })}
          </div>
        );
      })}
      {props.headline ? (
        <div
          style={{
            position: "absolute",
            left: 36,
            right: 36,
            top: 72,
            textAlign: "center",
            color: "#fff",
            fontSize: 78,
            fontWeight: 900,
            lineHeight: 0.95,
            letterSpacing: -1,
            textShadow: "0 6px 0 #000",
          }}
        >
          {paintWords(props.headline, props.headlineColor || props.accent, props.accentWords || "")}
        </div>
      ) : null}
      {rank ? (
        <div
          style={{
            position: "absolute",
            left: 36,
            right: 36,
            top: 430,
            textAlign: "center",
            color: "#fff",
            fontSize: 160,
            fontWeight: 900,
            WebkitTextStroke: "10px #000",
            paintOrder: "stroke fill",
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
            top: props.headline ? 620 : "46%",
            textAlign: "center",
            color: "#fff",
            fontSize: props.headline ? 72 : 64,
            fontWeight: 800,
            letterSpacing: 0.5,
            textShadow: "0 4px 16px rgba(0,0,0,0.8)",
            WebkitTextStroke: props.headline ? `${props.titleStroke ?? 6}px #000` : undefined,
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
