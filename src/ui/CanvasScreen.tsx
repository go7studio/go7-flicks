import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlickProps } from "../remotion/FlickComposition";
import { FlickComposition } from "../remotion/FlickComposition";
import {
  clipAt,
  deleteClip,
  dragSeam,
  fitClipsToMedia,
  fullFrame,
  moveClip,
  placeClip,
  splitClip,
  splitEvenly,
  trimClip,
  visibleRegions,
} from "../shared/canvas";
import { clipDuration, timelineEnd, uid, type Clip, type ConnectionPublic, type Flick, type ShelfEntry, type Template } from "../shared/model";
import type { ResolvedMedia } from "../shared/api";

function mediaLimit(media: ResolvedMedia[], mediaId: string | null): number | undefined {
  if (!mediaId) return undefined;
  const duration = media.find((item) => item.id === mediaId)?.durationSec ?? 0;
  return duration > 0 ? duration : undefined;
}

export function CanvasScreen({
  dir,
  flickId,
  onBack,
  onConnections,
}: {
  dir: string;
  flickId: string;
  onBack: () => void;
  onConnections: () => void;
}) {
  const [flick, setFlick] = useState<Flick | null>(null);
  const [media, setMedia] = useState<ResolvedMedia[]>([]);
  const [accent, setAccent] = useState("#e2b340");
  const [channelName, setChannelName] = useState("");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionPublic[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [chatId, setChatId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [encoder, setEncoder] = useState("Checking encoder…");
  const [playhead, setPlayhead] = useState(0);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [replaceId, setReplaceId] = useState("");
  const playerRef = useRef<PlayerRef>(null);
  const flickRef = useRef<Flick | null>(null);
  const dirty = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const past = useRef<Flick[]>([]);
  const future = useRef<Flick[]>([]);
  const [pastCount, setPastCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);

  function remember(nextPast: Flick[], nextFuture: Flick[]) {
    past.current = nextPast;
    future.current = nextFuture;
    setPastCount(nextPast.length);
    setFutureCount(nextFuture.length);
  }

  useEffect(() => {
    void window.flicks!.readFlick(dir, flickId).then((result) => {
      if (!result.ok || !result.flick || !result.channel) {
        setMessage(result.message ?? "Could not open the flick.");
        return;
      }
      const mediaRows = result.media ?? [];
      const limits = new Map(mediaRows.filter((item) => item.durationSec > 0).map((item) => [item.id, item.durationSec]));
      const fitted = fitClipsToMedia(result.flick.clips, limits);
      const opened = fitted === result.flick.clips ? result.flick : { ...result.flick, clips: fitted };
      setFlick(opened);
      flickRef.current = opened;
      if (opened !== result.flick) dirty.current = true;
      setMedia(mediaRows);
      setAccent(result.channel.accent);
      setChannelName(result.channel.name);
      setVoiceUrl(result.voicePreview ?? null);
      setSelectedRegion(result.flick.regions.find((region) => !region.hidden)?.id ?? null);
      remember([], []);
    });
    void window.flicks!.connections().then((rows) => {
      setConnections(rows);
      const chat = rows.find((row) => row.connected && row.kind !== "elevenlabs");
      const voice = rows.find((row) => row.connected && (row.kind === "elevenlabs" || row.kind === "minimax"));
      if (chat) setChatId(chat.id);
      if (voice) setVoiceId(voice.id);
    });
    void window.flicks!.templates().then(setTemplates);
    void window.flicks!.shelf().then(setShelf);
    void window.flicks!.gpu().then((gpu) => setEncoder(gpu.chosen));
  }, [dir, flickId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => {
      setPlayhead(event.detail.frame / (flickRef.current?.fps ?? 30));
    };
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [flick?.id]);

  useEffect(() => {
    if (!dirty.current || !flick) return;
    const handle = window.setTimeout(() => {
      void window.flicks!.saveFlick(dir, flick);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [flick, dir]);

  useEffect(() => {
    return () => {
      if (dirty.current && flickRef.current) void window.flicks?.saveFlick(dir, flickRef.current);
    };
  }, [dir]);

  function edit(next: Flick, history: "push" | "replace" = "push") {
    const current = flickRef.current;
    if (history === "push" && current) remember([...past.current, structuredClone(current)].slice(-30), []);
    dirty.current = true;
    flickRef.current = next;
    setFlick(next);
  }

  function undo() {
    const current = flickRef.current;
    const previous = past.current.at(-1);
    if (!current || !previous) return;
    remember(past.current.slice(0, -1), [...future.current, structuredClone(current)]);
    dirty.current = true;
    flickRef.current = previous;
    setFlick(previous);
  }

  function redo() {
    const current = flickRef.current;
    const next = future.current.at(-1);
    if (!current || !next) return;
    remember([...past.current, structuredClone(current)].slice(-30), future.current.slice(0, -1));
    dirty.current = true;
    flickRef.current = next;
    setFlick(next);
  }

  const frames = Math.max(30, Math.ceil(timelineEnd(flick?.clips ?? []) * (flick?.fps ?? 30)));
  const preview = useMemo<FlickProps | null>(() => {
    if (!flick) return null;
    return {
      fps: flick.fps,
      width: flick.width,
      height: flick.height,
      accent,
      headline: flick.headline,
      headlineColor: flick.headlineColor,
      accentWords: flick.accentWords,
      titleStroke: flick.titleStroke,
      showRank: flick.showRank,
      regions: flick.regions,
      tracks: flick.tracks,
      voiceSrc: voiceUrl ?? undefined,
      musicSrc: media.find((item) => item.id === flick.musicId)?.previewUrl || undefined,
      musicCredit: flick.musicId ? flick.musicCredit : undefined,
      preview: true,
      clips: flick.clips.map((clip) => ({
        id: clip.id,
        trackId: clip.trackId,
        startSec: clip.startSec,
        inSec: clip.inSec,
        outSec: clip.outSec,
        label: clip.label,
        line: clip.line,
        src: media.find((item) => item.id === clip.mediaId)?.previewUrl ?? undefined,
      })),
    };
  }, [flick, media, accent, voiceUrl]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!flick) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        splitAtPlayhead();
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!selectedClip) return;
        event.preventDefault();
        edit({ ...flick, clips: deleteClip(flick.clips, selectedClip) });
        setSelectedClip(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function splitAtPlayhead() {
    if (!flick) return;
    const region = flick.regions.find((item) => item.id === selectedRegion) ?? visibleRegions(flick.regions)[0];
    const clip = region ? clipAt(flick.clips, region.trackId, playhead) : null;
    const target = clip?.id ?? selectedClip;
    if (!target) return;
    edit({ ...flick, clips: splitClip(flick.clips, target, playhead) });
  }

  async function addMusic() {
    if (!flick) return;
    const result = await window.flicks!.importAudio(dir);
    if (!result.ok || !result.asset || !result.media) {
      setMessage(result.message ?? "Could not add that music.");
      return;
    }
    setMedia(result.media);
    edit({ ...flick, musicId: result.asset.id });
    setShelf(await window.flicks!.shelf());
    setMessage(result.asset.name);
  }

  async function useSaved(id: string) {
    if (!flick) return;
    const result = await window.flicks!.useShelf(dir, id);
    if (!result.ok || !result.asset || !result.media) {
      setMessage(result.message ?? "Could not use that saved file.");
      return;
    }
    setMedia(result.media);
    if (result.kind === "audio") {
      edit({ ...flick, musicId: result.asset.id, musicCredit: result.credit || flick.musicCredit });
    }
    setMessage(result.asset.name);
  }

  async function addMedia(mode: "copy" | "link") {
    const result = await window.flicks!.importMedia(dir, mode);
    if (!result.ok || !result.media) {
      setMessage(result.message ?? "Could not add that file.");
      return;
    }
    setMedia(result.media);
    setShelf(await window.flicks!.shelf());
    setMessage(mode === "copy" ? "Copied into the channel." : "Linked the file.");
  }

  function addToTrack(asset: ResolvedMedia, trackId: string) {
    if (!flick) return;
    const duration = asset.durationSec > 0 ? asset.durationSec : 3;
    const clip: Clip = {
      id: uid(),
      mediaId: asset.id,
      trackId,
      startSec: 0,
      inSec: 0,
      outSec: Math.round(duration * 1000) / 1000,
      label: asset.name.replace(/\.[^.]+$/, ""),
    };
    edit({ ...flick, clips: placeClip(flick.clips, trackId, clip) });
    setSelectedClip(clip.id);
  }

  async function runLine() {
    if (!flick || !selected) return;
    if (!chatId) {
      setMessage("Add and test a chat connection first.");
      return;
    }
    const layout = visibleRegions(flick.regions)
      .map((region) => {
        const track = flick.tracks.find((item) => item.id === region.trackId);
        return `${track?.name ?? "Region"} ${Math.round(region.height * 100)}%`;
      })
      .join(", ");
    const prompt = [
      "Write one spoken line for a vertical short.",
      `Channel: ${channelName}`,
      `Layout: ${layout}`,
      `Clip label: ${selected.label}`,
      selected.line ? `Current line: ${selected.line}` : "",
      "Return only the line.",
    ]
      .filter(Boolean)
      .join("\n");
    setBusy("Writing…");
    const result = await window.flicks!.writeLine(chatId, prompt);
    setBusy("");
    if (!result.ok || !result.text) {
      setMessage(result.message ?? "The connection returned nothing.");
      return;
    }
    edit({
      ...flick,
      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, line: result.text } : clip)),
    });
  }

  async function runVoice() {
    if (!flick || !selected) return;
    if (!voiceId) {
      setMessage("Add and test an ElevenLabs or MiniMax connection first.");
      return;
    }
    setBusy("Making voice…");
    const result = await window.flicks!.makeVoice(voiceId, dir, flick.id, selected.line || selected.label);
    setBusy("");
    if (!result.ok) {
      setMessage(result.message ?? "Voice failed.");
      return;
    }
    const previewUrl = "previewUrl" in result ? (result.previewUrl as string | undefined) : undefined;
    if (previewUrl) setVoiceUrl(previewUrl);
    edit({ ...flick, voiceRelative: "voice.mp3" });
  }

  async function saveTemplate() {
    if (!flick) return;
    const result = await window.flicks!.saveTemplate(flick, templateName || flick.name, replaceId || undefined);
    setMessage(result.message ?? (result.ok ? "Template saved." : "Could not save the template."));
    if (result.ok) {
      setSavingTemplate(false);
      setTemplates(await window.flicks!.templates());
    }
  }

  async function exportFlick(kind: "cut" | "styled") {
    if (!flick) return;
    if (dirty.current) await window.flicks!.saveFlick(dir, flick);
    const output = await window.flicks!.pickSave(`${dir}/exports/${flick.name}.mp4`);
    if (!output) return;
    setBusy(kind === "cut" ? "Cutting…" : "Rendering…");
    const result =
      kind === "cut"
        ? await window.flicks!.exportCut(dir, flick.id, output)
        : await window.flicks!.exportStyled(dir, flick.id, output);
    setBusy("");
    setMessage(result.ok ? `Saved ${output}` : result.message ?? "Export failed.");
  }

  function onSeam(regionId: string, event: React.PointerEvent) {
    if (!flick) return;
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const upper = flick.regions.find((region) => region.id === regionId);
    if (!upper) return;
    const startY = event.clientY;
    const startHeight = upper.height;
    let pushed = false;
    const move = (ev: PointerEvent) => {
      const current = flickRef.current;
      if (!current) return;
      const nextHeight = startHeight + (ev.clientY - startY) / bounds.height;
      edit({ ...current, regions: dragSeam(current.regions, regionId, nextHeight) }, pushed ? "replace" : "push");
      pushed = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!flick || !preview) {
    return (
      <main className="page">
        <p className="banner">{message || "Opening flick…"}</p>
      </main>
    );
  }

  const selected = flick.clips.find((clip) => clip.id === selectedClip) ?? null;
  const regions = visibleRegions(flick.regions);
  const seconds = Math.max(timelineEnd(flick.clips), 1);

  return (
    <div className="app">
      <header className="toolbar">
        <button className="btn-ghost" onClick={onBack}>
          Channel
        </button>
        <input
          className="field"
          value={flick.name}
          onChange={(event) => edit({ ...flick, name: event.target.value })}
        />
        <span className="muted tiny">Encoder: {encoder}</span>
        <span className="spacer" />
        <button className="btn" onClick={onConnections}>
          Connections
        </button>
        <button className="btn" disabled={encoder === "ffmpeg missing" || Boolean(busy)} onClick={() => void exportFlick("cut")}>
          {regions.length >= 2 ? "Export cut · keeps the top picture" : "Export cut"}
        </button>
        <button className="btn-primary" disabled={Boolean(busy)} onClick={() => void exportFlick("styled")}>
          {busy || "Export styled"}
        </button>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="workspace">
        <aside className="rail stack">
          <div className="row">
            <button className="btn-small btn" onClick={() => void addMedia("copy")}>
              Add clip
            </button>
            <button className="btn-small btn" onClick={() => void addMedia("link")}>
              Link clip
            </button>
          </div>
          {media.filter((asset) => asset.width > 0).map((asset) => (
            <div key={asset.id} className="panel stack">
              <strong>{asset.name}</strong>
              <span className="muted tiny">
                {asset.missing ? "Missing" : `${asset.durationSec.toFixed(1)}s`}
                {asset.absolutePath && !asset.relativePath ? " · linked" : ""}
              </span>
              <div className="row">
                {flick.tracks.map((track) => (
                  <button key={track.id} className="btn-small btn" onClick={() => addToTrack(asset, track.id)}>
                    {track.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!media.some((asset) => asset.width > 0) ? <p className="muted">Add a video from this computer. A pasted link is only a note.</p> : null}
          {shelf.some((item) => item.kind === "video") ? (
            <div className="stack">
              <p className="rail-label">Used clips</p>
              {shelf
                .filter((item) => item.kind === "video")
                .map((item) => (
                  <button key={item.id} className="btn" onClick={() => void useSaved(item.id)}>
                    {item.name}
                  </button>
                ))}
            </div>
          ) : null}
        </aside>
        <div className="stage-wrap">
          <div className="frame-wrap" ref={frameRef}>
            <Player
              ref={playerRef}
              component={FlickComposition}
              inputProps={preview}
              durationInFrames={frames}
              fps={flick.fps}
              compositionWidth={flick.width}
              compositionHeight={flick.height}
              style={{ width: "100%", height: "100%" }}
              acknowledgeRemotionLicense
            />
            <div className="frame-hit">
              {regions.map((region, index) => (
                <div key={region.id}>
                  <button
                    className={region.id === selectedRegion ? "region-hit on" : "region-hit"}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                      background: "transparent",
                    }}
                    onClick={() => setSelectedRegion(region.id)}
                  />
                  {index < regions.length - 1 ? (
                    <div
                      className="seam"
                      style={{ top: `${(region.y + region.height) * 100}%` }}
                      onPointerDown={(event) => onSeam(region.id, event)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="inspector stack">
          <p className="tiny muted">Canvas</p>
          <div className="row">
            <button
              className="btn-small btn"
              disabled={!selectedRegion}
              onClick={() => selectedRegion && edit({ ...flick, regions: fullFrame(flick.regions, selectedRegion) })}
            >
              Full frame
            </button>
            <button className="btn-small btn" onClick={() => edit({ ...flick, regions: splitEvenly(flick.regions) })}>
              Split evenly
            </button>
          </div>
          <div className="row">
            <button className="btn-small btn" disabled={pastCount === 0} onClick={undo}>
              Undo
            </button>
            <button className="btn-small btn" disabled={futureCount === 0} onClick={redo}>
              Redo
            </button>
            <button className="btn-small btn" onClick={splitAtPlayhead}>
              Split
            </button>
            <button
              className="btn-small btn"
              disabled={!selected}
              onClick={() => selected && edit({ ...flick, clips: moveClip(flick.clips, selected.id, -1) })}
            >
              Earlier
            </button>
            <button
              className="btn-small btn"
              disabled={!selected}
              onClick={() => selected && edit({ ...flick, clips: moveClip(flick.clips, selected.id, 1) })}
            >
              Later
            </button>
          </div>
          {selected ? (
            <>
              <label className="stack">
                <span>Label</span>
                <input
                  className="field"
                  value={selected.label}
                  onChange={(event) =>
                    edit({
                      ...flick,
                      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, label: event.target.value } : clip)),
                    })
                  }
                />
              </label>
              <label className="stack">
                <span>Line</span>
                <textarea
                  className="field"
                  rows={3}
                  value={selected.line ?? ""}
                  onChange={(event) =>
                    edit({
                      ...flick,
                      clips: flick.clips.map((clip) => (clip.id === selected.id ? { ...clip, line: event.target.value } : clip)),
                    })
                  }
                />
              </label>
              <label className="stack">
                <span>Source link</span>
                <input
                  className="field"
                  value={selected.sourceUrl ?? ""}
                  placeholder="Saved as a note. Not downloaded."
                  onChange={(event) =>
                    edit({
                      ...flick,
                      clips: flick.clips.map((clip) =>
                        clip.id === selected.id ? { ...clip, sourceUrl: event.target.value } : clip,
                      ),
                    })
                  }
                />
              </label>
              <div className="row">
                <label className="stack">
                  <span>In</span>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.1"
                    value={selected.inSec}
                    onChange={(event) =>
                      edit({
                        ...flick,
                        clips: trimClip(flick.clips, selected.id, "in", Number(event.target.value), mediaLimit(media, selected.mediaId)),
                      })
                    }
                  />
                </label>
                <label className="stack">
                  <span>Out</span>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.1"
                    value={selected.outSec}
                    onChange={(event) =>
                      edit({
                        ...flick,
                        clips: trimClip(flick.clips, selected.id, "out", Number(event.target.value), mediaLimit(media, selected.mediaId)),
                      })
                    }
                  />
                </label>
              </div>
              {mediaLimit(media, selected.mediaId) ? (
                <p className="muted">This file is {mediaLimit(media, selected.mediaId)?.toFixed(1)}s. In and out stay inside it.</p>
              ) : null}
              <label className="stack">
                <span>Write line with</span>
                <select className="field" value={chatId} onChange={(event) => setChatId(event.target.value)}>
                  <option value="">Choose</option>
                  {connections
                    .filter((row) => row.kind !== "elevenlabs")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.connected ? "" : " (not tested)"}
                      </option>
                    ))}
                </select>
              </label>
              <label className="stack">
                <span>Voice with</span>
                <select className="field" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                  <option value="">Choose</option>
                  {connections
                    .filter((row) => row.kind === "elevenlabs" || row.kind === "minimax")
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                        {row.connected ? "" : " (not tested)"}
                      </option>
                    ))}
                </select>
              </label>
              <div className="row">
                <button className="btn" disabled={Boolean(busy)} onClick={() => void runLine()}>
                  Write line
                </button>
                <button className="btn" disabled={Boolean(busy)} onClick={() => void runVoice()}>
                  Make voice
                </button>
              </div>
              <button
                className="btn-danger"
                onClick={() => {
                  edit({ ...flick, clips: deleteClip(flick.clips, selected.id) });
                  setSelectedClip(null);
                }}
              >
                Delete cut
              </button>
            </>
          ) : (
            <p className="muted">Select a cut on the timeline. Split with B. Delete closes the gap.</p>
          )}
          <div className="row">
            <button className="btn" disabled={Boolean(busy)} onClick={() => void addMusic()}>
              Add music
            </button>
            {flick.musicId ? (
              <button className="btn" onClick={() => edit({ ...flick, musicId: undefined, musicCredit: undefined })}>
                Remove music
              </button>
            ) : null}
          </div>
          {flick.musicId ? (
            <>
              <p className="tiny">{media.find((item) => item.id === flick.musicId)?.name ?? "Music"}</p>
              <label className="stack">
                <span>Credit</span>
                <input
                  className="field"
                  value={flick.musicCredit ?? ""}
                  placeholder="Artist, track"
                  onChange={(event) => edit({ ...flick, musicCredit: event.target.value.trim() ? event.target.value : undefined })}
                />
              </label>
            </>
          ) : null}
          {shelf.some((item) => item.kind === "audio") ? (
            <div className="stack">
              <p className="rail-label">Used music</p>
              {shelf
                .filter((item) => item.kind === "audio")
                .map((item) => (
                  <button key={item.id} className="btn" onClick={() => void useSaved(item.id)}>
                    {item.name}
                    {item.credit ? ` · ${item.credit}` : ""}
                  </button>
                ))}
            </div>
          ) : null}
          <p className="muted">Export cut keeps the top picture. Its sound is the voice and the music. Styled plays the clips as well.</p>
          <button className="btn" onClick={() => setSavingTemplate(true)}>
            Save as template
          </button>
          {flick.voiceRelative ? <p className="tiny muted">Voice is on this flick.</p> : null}
        </aside>
        <section className="timeline">
          <div className="row">
            <button className="btn-small btn" onClick={() => playerRef.current?.toggle()}>
              Play
            </button>
            <span className="tiny muted">
              {clock(playhead)} / {clock(seconds)}
            </span>
          </div>
          {flick.tracks.map((track) => {
            const clips = flick.clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.startSec - b.startSec);
            return (
              <div className="track-row" key={track.id}>
                <span className="tiny">{track.name}</span>
                <div
                  className="lane"
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const next = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * seconds;
                    const frame = Math.max(0, Math.min(frames - 1, Math.round(next * flick.fps)));
                    playerRef.current?.seekTo(frame);
                    setPlayhead(frame / flick.fps);
                  }}
                >
                  <div className="playhead" style={{ left: `${(playhead / seconds) * 100}%` }} />
                  {clips.map((clip) => (
                    <button
                      key={clip.id}
                      className={clip.id === selectedClip ? "clip-block on" : "clip-block"}
                      style={{
                        left: `${(clip.startSec / seconds) * 100}%`,
                        width: `${(clipDuration(clip) / seconds) * 100}%`,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedClip(clip.id);
                        setSelectedRegion(flick.regions.find((region) => region.trackId === clip.trackId)?.id ?? null);
                      }}
                    >
                      <span
                        className="handle left"
                        onPointerDown={(event) => beginTrim(event, clip, "in")}
                      />
                      {clip.label}
                      <span
                        className="handle right"
                        onPointerDown={(event) => beginTrim(event, clip, "out")}
                      />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </div>
      {savingTemplate ? (
        <div className="modal-back">
          <div className="modal panel stack">
            <h2>Save as template</h2>
            <p className="muted">Saves this seam, this text, this order, and these cuts. The videos stay in the channel. Built-in templates stay as they shipped.</p>
            <label className="stack">
              <span>Name</span>
              <input className="field" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </label>
            <label className="stack">
              <span>Replace one you saved</span>
              <select className="field" value={replaceId} onChange={(event) => setReplaceId(event.target.value)}>
                <option value="">Save as new</option>
                {templates
                  .filter((template) => !template.builtin)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="actions">
              <button className="btn-primary" onClick={() => void saveTemplate()}>
                Save template
              </button>
              <button className="btn" onClick={() => setSavingTemplate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  function beginTrim(event: React.PointerEvent, clip: Clip, edge: "in" | "out") {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startIn = clip.inSec;
    const startOut = clip.outSec;
    const lane = (event.currentTarget.parentElement?.parentElement as HTMLElement | null)?.getBoundingClientRect();
    const width = lane?.width || 1;
    let pushed = false;
    const move = (ev: PointerEvent) => {
      const current = flickRef.current;
      if (!current) return;
      const delta = ((ev.clientX - startX) / width) * Math.max(timelineEnd(current.clips), 1);
      const value = edge === "in" ? startIn + delta : startOut + delta;
      edit({ ...current, clips: trimClip(current.clips, clip.id, edge, value) }, pushed ? "replace" : "push");
      pushed = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
