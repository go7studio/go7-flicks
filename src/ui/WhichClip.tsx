import { useEffect, useState } from "react";
import {
  connectedChat,
  readWhichClip,
  trendPrompt,
  voiceOnly,
  whichClipPrompt,
  type AssistClip,
} from "../shared/assist";
import type { ConnectionPublic } from "../shared/model";

export function WhichClip({
  clips,
  disabled,
  onHeadline,
  onTitle,
}: {
  clips: AssistClip[];
  disabled?: boolean;
  onHeadline: (headline: string) => void;
  onTitle: (id: string, title: string) => void;
}) {
  const [rows, setRows] = useState<ConnectionPublic[] | null>(null);
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"pick" | "trend" | null>(null);
  const [words, setWords] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void window.flicks?.connections().then((next) => {
      if (!alive) return;
      setRows(next);
      const chat = connectedChat(next);
      setChatId((current) => (current && chat.some((row) => row.id === current) ? current : chat[0]?.id ?? ""));
    }).catch(() => {
      if (alive) setRows([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const shown = clips.slice(0, 12);
  const chat = rows ? connectedChat(rows) : [];
  const chosen = chat.find((row) => row.id === chatId) ?? chat[0];
  const ready = shown.length > 0 && Boolean(chosen) && !disabled && !busy;
  const pick = mode === "pick" && words ? readWhichClip(words, shown.map((_, index) => `c${index + 1}`)) : null;
  const strongest = pick?.strongestId ? shown[Number(pick.strongestId.slice(1)) - 1] : null;

  async function ask(next: "pick" | "trend") {
    if (!chosen || !shown.length || !window.flicks) return;
    setBusy(true);
    setMode(next);
    setWords("");
    setNotice(next === "pick" ? "Asking which clip…" : "Asking what trend…");
    try {
      const prompt = next === "pick" ? whichClipPrompt(shown) : trendPrompt(shown);
      const result = await window.flicks.askAssistant(chosen.id, prompt);
      const reply = (result.text || result.message || "").trim();
      if (!result.ok) {
        setWords("");
        setNotice(reply || "That account did not answer.");
        return;
      }
      setWords(reply);
      setNotice("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="which-clip" aria-label="Which clip">
      <p className="rail-label">Which clip</p>
      {rows === null ? <p className="muted tiny">Checking accounts…</p> : null}
      {rows && chat.length === 0 ? (
        <p className="muted">
          {voiceOnly(rows)
            ? "ElevenLabs and MiniMax stay voice. Connect Claude, Codex, Grok, or Cursor, then test that row."
            : "No chat account is connected. Test Claude, Codex, Grok, or Cursor on Connections. This does not invent a ranking."}
        </p>
      ) : null}
      {chosen ? (
        <>
          {chat.length > 1 ? (
            <label className="stack">
              <span>Ask with</span>
              <select className="field" value={chosen.id} onChange={(event) => setChatId(event.target.value)}>
                {chat.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="tiny muted">Asks {chosen.name}</p>
          )}
          {!shown.length ? <p className="muted">Add a clip on this flick first. This looks at clips already here.</p> : null}
          {clips.length > shown.length ? <p className="tiny muted">Using the first 12 clips on this flick.</p> : null}
          <div className="row">
            <button className="btn" type="button" disabled={!ready} onClick={() => void ask("pick")}>
              Ask which clip
            </button>
            <button className="btn btn-ghost which-quiet" type="button" disabled={!ready} onClick={() => void ask("trend")}>
              What trend
            </button>
          </div>
        </>
      ) : null}
      {notice ? <p className="which-words">{notice}</p> : null}
      {words ? (
        <>
          <p className="tiny muted">{mode === "trend" ? "Trend" : "The model’s words"}</p>
          <p className="which-words">{words}</p>
        </>
      ) : null}
      {pick && strongest ? <p className="which-strong">Strongest hook: {strongest.name}</p> : null}
      {pick?.headline ? (
        <div className="which-apply">
          <p>
            <span className="tiny muted">Headline</span>
            {pick.headline}
          </p>
          <button className="btn" type="button" onClick={() => onHeadline(pick.headline!)}>
            Apply headline
          </button>
        </div>
      ) : null}
      {pick && words && !pick.headline ? <p className="muted tiny">That reply did not include a headline to apply.</p> : null}
      {pick?.titles.map((item) => {
        const index = Number(item.id.slice(1)) - 1;
        const clip = shown[index];
        if (!clip) return null;
        return (
          <div className="which-apply" key={item.id}>
            <p>
              <span className="tiny muted">{clip.name}</span>
              {item.title}
            </p>
            <button className="btn" type="button" onClick={() => onTitle(clip.id, item.title)}>
              Apply title
            </button>
          </div>
        );
      })}
    </section>
  );
}
