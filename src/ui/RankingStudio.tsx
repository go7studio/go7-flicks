import { useEffect, useState } from "react";
import { builtinTemplates, flickFromTemplate, playbackOrder, rankingClipRange, shuffleIds, type PlaybackMode } from "../shared/canvas";
import { round3, uid, type Flick, type Template } from "../shared/model";

type Slot = {
  id: string;
  rank: number;
  title: string;
  note: string;
  inSec: number;
  outSec: number;
  duration: number;
  mediaId: string | null;
  mediaName: string;
  previewUrl: string | null;
};

function makeSlots(count: number): Slot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uid(),
    rank: count - index,
    title: "",
    note: "",
    inSec: 0,
    outSec: 3,
    duration: 0,
    mediaId: null,
    mediaName: "",
    previewUrl: null,
  }));
}

function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCs = Math.round(safe * 100);
  const cs = totalCs % 100;
  const totalSecs = Math.floor(totalCs / 100);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function clampOut(next: number, inSec: number, duration: number): number {
  const cap = duration > 0 ? duration : next;
  return round3(Math.max(inSec + 0.1, Math.min(Math.max(0, next), cap)));
}

function clampIn(next: number, outSec: number, duration: number): number {
  const end = duration > 0 ? Math.min(outSec, duration) : outSec;
  return round3(Math.min(Math.max(0, next), Math.max(0, end - 0.1)));
}

function parseClock(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (match) {
    const mins = Number(match[1]);
    const secs = Number(match[2]);
    const frac = match[3] ? Number(match[3].padEnd(2, "0")) / 100 : 0;
    return mins * 60 + secs + frac;
  }
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? plain : null;
}

export function RankingStudio({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (dir: string, flickId: string) => void;
}) {
  const [dir, setDir] = useState<string | null>(null);
  const [headline, setHeadline] = useState("Ranking the funniest\ncartoon moments");
  const [accentWords, setAccentWords] = useState("funniest");
  const [color, setColor] = useState("#e2b340");
  const [stroke, setStroke] = useState(6);
  const [showRank, setShowRank] = useState(true);
  const [playback, setPlayback] = useState<PlaybackMode>("countdown");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(5));
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState<Template[]>([]);
  const slot = slots[selected];

  function patch(next: Partial<Slot>) {
    setSlots((rows) => rows.map((item, index) => (index === selected ? { ...item, ...next } : item)));
  }

  function setCount(count: number) {
    setSlots((rows) => {
      const next = makeSlots(count).map((item, index) => ({ ...item, ...(rows[index] ?? {}), rank: count - index, id: rows[index]?.id ?? item.id }));
      return next;
    });
    setPlayback("countdown");
    setOrderIds([]);
    setSelected(0);
  }

  function shuffle() {
    setOrderIds(shuffleIds(slots.map((item) => item.id)));
    setPlayback("shuffle");
  }

  useEffect(() => {
    void window.flicks?.templates().then((items) => {
      setRecipes(items.filter((item) => !item.builtin && item.headline));
    });
  }, []);

  async function saveRecipe() {
    const ranking = builtinTemplates().find((item) => item.id === "builtin-ranking");
    if (!ranking) return;
    const title = headline.split("\n")[0]?.trim() || "Ranking";
    const base = flickFromTemplate(ranking, title);
    const ordered = playbackOrder(slots, playback, orderIds);
    let cursor = 0;
    const clips = ordered.map((item) => {
      const length = Math.max(0.4, item.outSec - item.inSec);
      const clip = {
        id: uid(),
        mediaId: null,
        trackId: "track-top",
        startSec: cursor,
        inSec: 0,
        outSec: round3(length),
        label: showRank ? `#${item.rank}` : item.title || "Clip",
        line: item.title || undefined,
      };
      cursor += length;
      return clip;
    });
    const loop = base.clips.find((clip) => clip.label === "Loop");
    base.clips = loop ? [...clips, { ...loop, id: uid(), startSec: 0, outSec: round3(cursor || 3) }] : clips;
    base.headline = headline;
    base.headlineColor = color;
    base.accentWords = accentWords;
    base.titleStroke = stroke;
    base.showRank = showRank;
    const result = await window.flicks!.saveTemplate(base, title);
    setMessage(result.ok ? `Saved “${title}”. This order and these words can run again.` : result.message ?? "Could not save that template.");
    if (result.ok) {
      const items = await window.flicks!.templates();
      setRecipes(items.filter((item) => !item.builtin && item.headline));
    }
  }

  function loadRecipe(template: Template) {
    if (template.headline) setHeadline(template.headline);
    if (template.headlineColor) setColor(template.headlineColor);
    if (template.accentWords !== undefined) setAccentWords(template.accentWords);
    if (template.titleStroke !== undefined) setStroke(template.titleStroke);
    if (template.showRank !== undefined) setShowRank(template.showRank);
    const ranked = template.clips.filter((clip) => clip.label !== "Loop" && clip.trackId !== "track-bottom");
    if (!ranked.length) return;
    setSlots(
      ranked.map((clip, index) => {
        const rankMatch = /^#(\d+)$/.exec(clip.label);
        return {
          id: uid(),
          rank: rankMatch ? Number(rankMatch[1]) : ranked.length - index,
          title: clip.line || (rankMatch ? "" : clip.label),
          note: "",
          inSec: 0,
          outSec: Math.max(0.4, clip.outSec - clip.inSec),
          duration: 0,
          mediaId: null,
          mediaName: "",
          previewUrl: null,
        };
      }),
    );
    setPlayback("listed");
    setOrderIds([]);
    setSelected(0);
    setMessage(`Loaded “${template.name}”. Add the clips, then open the timeline.`);
  }

  function move(step: number) {
    setSlots((rows) => {
      const target = selected + step;
      if (target < 0 || target >= rows.length) return rows;
      const copy = [...rows];
      const [item] = copy.splice(selected, 1);
      copy.splice(target, 0, item);
      return copy;
    });
    setSelected((index) => Math.min(slots.length - 1, Math.max(0, index + step)));
  }

  async function ensureDir(): Promise<string | null> {
    if (dir) return dir;
    const recent = await window.flicks!.recent();
    const existing = recent[0]?.path;
    if (existing) {
      setDir(existing);
      return existing;
    }
    const parent = await window.flicks!.pickDirectory();
    if (!parent) return null;
    const created = await window.flicks!.createChannel(parent, "Ranking");
    if (!created.ok || !created.dir) {
      setMessage(created.message ?? "Could not create the channel.");
      return null;
    }
    setDir(created.dir);
    return created.dir;
  }

  async function addClip() {
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const result = await window.flicks!.importMedia(folder, "copy");
      if (!result.ok || !result.asset) {
        setMessage(result.message ?? "No clip chosen.");
        return;
      }
      const resolved = result.media?.find((item) => item.id === result.asset?.id);
      const duration = result.asset.durationSec || 3;
      patch({
        mediaId: result.asset.id,
        mediaName: result.asset.name,
        previewUrl: resolved?.previewUrl ?? null,
        duration,
        inSec: 0,
        outSec: Math.min(4, Math.max(0.4, duration)),
        title: slot?.title || result.asset.name.replace(/\.[^.]+$/, "").slice(0, 24),
      });
    } finally {
      setBusy(false);
    }
  }

  async function openTimeline() {
    if (!slots.some((item) => item.mediaId)) {
      setMessage("Add at least one clip from this computer.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const folder = await ensureDir();
      if (!folder) return;
      const name = headline.split("\n")[0]?.trim() || "Ranking";
      const created = await window.flicks!.createFlick(folder, name, "builtin-ranking");
      if (!created.ok || !created.flick) {
        setMessage(created.message ?? "Could not open the timeline.");
        return;
      }
      const ordered = playbackOrder(slots, playback, orderIds);
      let cursor = 0;
      const clips = ordered
        .filter((item) => item.mediaId || item.title)
        .map((item) => {
          const range = rankingClipRange(item.inSec, item.outSec, item.duration);
          const clip = {
            id: uid(),
            mediaId: item.mediaId,
            trackId: "track-top",
            startSec: cursor,
            inSec: range.inSec,
            outSec: range.outSec,
            label: showRank ? `#${item.rank}` : item.title || "Clip",
            line: item.title || undefined,
            sourceUrl: item.note.trim() || undefined,
          };
          cursor += range.outSec - range.inSec;
          return clip;
        });
      const flick: Flick = {
        ...created.flick,
        name,
        headline,
        headlineColor: color,
        accentWords,
        titleStroke: stroke,
        showRank,
        clips,
      };
      const saved = await window.flicks!.saveFlick(folder, flick);
      if (!saved.ok || !saved.flick) {
        setMessage(saved.message ?? "Could not save the ranking.");
        return;
      }
      onOpen(folder, saved.flick.id);
    } finally {
      setBusy(false);
    }
  }

  const sequence = playbackOrder(slots, playback, orderIds);
  const playAt = new Map(sequence.map((item, index) => [item.id, index + 1]));
  const swatch = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#e2b340";

  return (
    <div className="studio ranking">
      <header className="toolbar rank-toolbar">
        <button className="home-back" onClick={onBack}>
          <HomeIcon />
          Home
        </button>
        <strong>Video ranking</strong>
        <button className="btn-gold" disabled={busy} onClick={() => void openTimeline()}>
          <TimelineIcon />
          Open timeline
        </button>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="studio-body">
        <aside className="rail stack rank-rail">
          <div className="count-row">
            {[5, 6, 7].map((count) => (
              <button key={count} className={slots.length === count ? "count-btn on" : "count-btn"} onClick={() => setCount(count)}>
                {count}
              </button>
            ))}
          </div>
          <div className="slot-list">
            {slots.map((item, index) => (
              <button key={item.id} className={index === selected ? "slot on" : "slot"} onClick={() => setSelected(index)}>
                <span className="grip" aria-hidden="true" />
                <b>#{item.rank}</b>
                <span className="play-mark" aria-hidden="true">
                  <PlayIcon />
                </span>
                <em>{playAt.get(item.id)}</em>
              </button>
            ))}
          </div>
          <div className="order-stack">
            <button className={playback === "countdown" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("countdown")}>
              <ClockIcon />
              Countdown
            </button>
            <button className={playback === "listed" ? "order-btn on" : "order-btn"} onClick={() => setPlayback("listed")}>
              <ListIcon />
              Listed
            </button>
            <button className={playback === "shuffle" ? "order-btn on" : "order-btn"} onClick={shuffle}>
              <ShuffleIcon />
              Shuffle
            </button>
          </div>
          <button className="btn" onClick={() => void saveRecipe()}>
            Save template
          </button>
          {recipes.length ? (
            <div className="order-stack">
              {recipes.map((recipe) => (
                <button key={recipe.id} className="choice" onClick={() => loadRecipe(recipe)}>
                  {recipe.name}
                </button>
              ))}
            </div>
          ) : null}
        </aside>
        <div className="stage-wrap">
          <div className="phone">
            <div className="phone-scene">
              <span className="scene-path" />
              <span className="scene-tree" />
            </div>
            {slot?.previewUrl ? <video src={slot.previewUrl} autoPlay playsInline /> : null}
            <div className="phone-title">{paint(headline, color, accentWords)}</div>
            {showRank ? <div className="phone-rank">#{slot?.rank}</div> : null}
            <div className="phone-clip" style={{ WebkitTextStroke: `${stroke}px #111` }}>
              {slot?.title || "Clip title"}
            </div>
          </div>
        </div>
        <aside className="inspector stack rank-inspector">
          <label className="stack">
            <span>Video title</span>
            <textarea className="field" rows={2} value={headline} onChange={(event) => setHeadline(event.target.value)} />
          </label>
          <label className="stack">
            <span>Words to color</span>
            <input className="field" value={accentWords} onChange={(event) => setAccentWords(event.target.value)} />
          </label>
          <label className="stack">
            <span>Color</span>
            <span className="color-line">
              <input type="color" value={swatch} aria-label="Color" onChange={(event) => setColor(event.target.value)} />
              <input
                className="field hex"
                spellCheck={false}
                value={color.toUpperCase()}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  setColor(next.startsWith("#") ? next : `#${next}`);
                }}
              />
            </span>
          </label>
          <label className="stack">
            <span>Title stroke</span>
            <span className="stroke-line">
              <input type="range" min={0} max={12} value={stroke} aria-label="Title stroke" onChange={(event) => setStroke(Number(event.target.value))} />
              <input
                className="field stroke-num"
                type="number"
                min={0}
                max={12}
                value={stroke}
                aria-label="Title stroke amount"
                onChange={(event) => setStroke(Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
              />
            </span>
          </label>
          <div className="toggle-line">
            <span>Show the rank number</span>
            <button type="button" className={showRank ? "switch on" : "switch"} role="switch" aria-checked={showRank} onClick={() => setShowRank((value) => !value)} />
          </div>
          {slot ? (
            <>
              <div className="add-line">
                <span>Add clip</span>
                <button className="plus" disabled={busy} aria-label="Add clip" onClick={() => void addClip()}>
                  +
                </button>
              </div>
              {slot.mediaName ? <p className="file-note">{slot.mediaName}</p> : null}
              <label className="stack">
                <span>Clip title</span>
                <input className="field" value={slot.title} onChange={(event) => patch({ title: event.target.value })} />
              </label>
              <label className="stack">
                <span>Link note</span>
                <input
                  className="field"
                  value={slot.note}
                  placeholder="Optional note..."
                  onChange={(event) => patch({ note: event.target.value })}
                />
              </label>
              <div className="stack">
                <span className="field-label">In and Out</span>
                <div className="inout">
                  <ClockField
                    label="In"
                    value={slot.inSec}
                    onCommit={(next) => patch({ inSec: clampIn(next, slot.outSec, slot.duration) })}
                  />
                  <span className="inout-dash">–</span>
                  <ClockField
                    label="Out"
                    value={slot.outSec}
                    onCommit={(next) => patch({ outSec: clampOut(next, slot.inSec, slot.duration) })}
                  />
                </div>
                {slot.duration > 0 ? <p className="muted">This file is {slot.duration.toFixed(1)}s. In and out stay inside it.</p> : null}
              </div>
              <div className="nudge-row">
                <span>Earlier</span>
                <button className="nudge" aria-label="Earlier" onClick={() => move(-1)}>
                  ←
                </button>
                <span className="grow" />
                <span>Later</span>
                <button className="nudge" aria-label="Later" onClick={() => move(1)}>
                  →
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ClockField({ label, value, onCommit }: { label: string; value: number; onCommit: (next: number) => void }) {
  const [text, setText] = useState(() => formatClock(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatClock(value));
  }, [value, focused]);
  return (
    <label className="clock">
      <span>{label}</span>
      <input
        className="field"
        value={focused ? text : formatClock(value)}
        onFocus={() => {
          setFocused(true);
          setText(formatClock(value));
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = parseClock(text);
          setFocused(false);
          if (next === null) {
            setText(formatClock(value));
            return;
          }
          onCommit(Math.max(0, next));
        }}
      />
    </label>
  );
}

function paint(text: string, color: string, words: string) {
  const keys = words
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  return text.split("\n").map((line, lineIndex) => (
    <div key={lineIndex}>
      {line.split(/(\s+)/).map((part, index) => (
        <span key={index} style={{ color: keys.some((key) => part.toLowerCase().includes(key)) ? color : "#fff" }}>
          {part}
        </span>
      ))}
    </div>
  ));
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.2" y="2.2" width="9" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5.2" y="6.2" width="9" height="7" rx="1.4" fill="#e8b423" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M6 4.5v7l6-3.5z" fill="currentColor" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 7h3l10 10h3M14 7h6M17 4l3 3-3 3M4 17h3l3.2-3.2M14 17h6M17 14l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
