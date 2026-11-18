import { useEffect, useState, type FormEvent } from "react";
import type { FlicksApi } from "../shared/api";
import type { ChannelFile, Template } from "../shared/model";
import { whenPhrase } from "../shared/when";
import "./polish-nav.css";

type ChannelResult = {
  ok: boolean;
  message?: string;
  channel?: ChannelFile;
};

type ChannelLibraryApi = FlicksApi & {
  renameChannel: (dir: string, name: string) => Promise<ChannelResult>;
  duplicateFlick: (dir: string, flickId: string) => Promise<ChannelResult>;
  deleteFlick: (dir: string, flickId: string) => Promise<ChannelResult>;
};

function channelLibrary(): ChannelLibraryApi {
  return window.flicks as ChannelLibraryApi;
}

const ACCENTS = ["#e2b340", "#e15a3a", "#7ec8b3", "#8eb6ff", "#f3f0e6"];
const BUILTIN_ORDER = ["builtin-split", "builtin-dual", "builtin-ranking", "builtin-blank"];

function clippedRow(flick: ChannelFile["flicks"][number], flicks: ChannelFile["flicks"]): string {
  const phrase = whenPhrase("Clipped", flick.updatedAt);
  if (!phrase || !flick.updatedAt) return "";
  const twins = flicks.filter(
    (item) => item.name === flick.name && whenPhrase("Clipped", item.updatedAt) === phrase,
  );
  if (twins.length < 2) return phrase;
  const clock = new Date(flick.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${phrase} · ${clock}`;
}

export function ChannelScreen({
  dir,
  onHome,
  onConnections,
  onOpen,
}: {
  dir: string;
  onHome: () => void;
  onConnections: () => void;
  onOpen: (flickId: string) => void;
}) {
  const [channel, setChannel] = useState<ChannelFile | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [message, setMessage] = useState("");
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("New flick");
  const [draftName, setDraftName] = useState("");
  const [templateId, setTemplateId] = useState("builtin-split");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  function sortTemplates(items: Template[]): Template[] {
    const rank = new Map(BUILTIN_ORDER.map((id, index) => [id, index]));
    return [...items].sort((left, right) => {
      const leftRank = rank.get(left.id) ?? 100;
      const rightRank = rank.get(right.id) ?? 100;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name);
    });
  }

  useEffect(() => {
    setPendingDelete(null);
    void window.flicks!.openChannel(dir).then((result) => {
      if (!result.ok || !result.channel) setMessage(result.message ?? "Could not open the channel.");
      else {
        setChannel(result.channel);
        setDraftName(result.channel.name);
      }
    });
    void window.flicks!.templates().then((items) => {
      const sorted = sortTemplates(items);
      setTemplates(sorted);
      setTemplateId(sorted.find((item) => item.id === "builtin-split")?.id ?? sorted[0]?.id ?? "builtin-split");
    });
  }, [dir]);

  useEffect(() => {
    if (!pendingDelete) return;
    function onClick(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
      if (element?.closest("[data-delete-flick]")?.getAttribute("data-delete-flick") === pendingDelete) return;
      setPendingDelete(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingDelete(null);
    }
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [pendingDelete]);

  useEffect(() => {
    if (!making) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMaking(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [making]);

  async function rename(event: FormEvent) {
    event.preventDefault();
    setPendingDelete(null);
    const next = draftName.trim();
    if (!next) return;
    setMessage("");
    try {
      const result = await channelLibrary().renameChannel(dir, next);
      if (!result.ok || !result.channel) {
        setMessage(result.message ?? "Could not rename the channel.");
        return;
      }
      setChannel(result.channel);
      setDraftName(result.channel.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename the channel.");
    }
  }

  async function refreshChannel() {
    const opened = await window.flicks!.openChannel(dir);
    if (opened.ok && opened.channel) setChannel(opened.channel);
  }

  async function duplicate(flickId: string) {
    setPendingDelete(null);
    setMessage("");
    try {
      const result = await channelLibrary().duplicateFlick(dir, flickId);
      if (!result.ok) {
        setMessage(result.message ?? "Could not duplicate the flick.");
        return;
      }
      if (result.channel) setChannel(result.channel);
      else await refreshChannel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not duplicate the flick.");
    }
  }

  async function removeFlick(flickId: string) {
    setMessage("");
    try {
      const result = await channelLibrary().deleteFlick(dir, flickId);
      setPendingDelete(null);
      if (!result.ok) {
        setMessage(result.message ?? "Could not delete the flick.");
        return;
      }
      if (result.channel) setChannel(result.channel);
      else await refreshChannel();
    } catch (error) {
      setPendingDelete(null);
      setMessage(error instanceof Error ? error.message : "Could not delete the flick.");
    }
  }

  async function accent(next: string) {
    const result = await window.flicks!.updateChannel(dir, { accent: next });
    if (result.ok && result.channel) setChannel(result.channel);
  }

  async function create() {
    const result = await window.flicks!.createFlick(dir, name, templateId);
    if (!result.ok || !result.flick) {
      setMessage(result.message ?? "Could not create the flick.");
      return;
    }
    onOpen(result.flick.id);
  }

  if (!channel) {
    return (
      <main className="page ch-page">
        <p className="banner">{message || "Opening channel…"}</p>
        <button className="btn" type="button" onClick={onHome}>
          Back to Home
        </button>
      </main>
    );
  }

  return (
    <main className="page ch-page">
      <header className="ch-head">
        <div className="ch-identity">
          <button className="btn-ghost ch-back" type="button" onClick={onHome}>
            Home
          </button>
          <h1>{channel.name}</h1>
          <form className="ch-rename" onSubmit={(event) => void rename(event)}>
            <input
              className="field"
              value={draftName}
              aria-label="Channel name"
              onChange={(event) => setDraftName(event.target.value)}
            />
            <button className="btn" type="submit">
              Rename
            </button>
          </form>
          <div className="ch-colors" role="group" aria-label="Channel color">
            <span className="muted tiny">Color</span>
            {ACCENTS.map((color) => (
              <button
                key={color}
                className={color === channel.accent ? "swatch on" : "swatch"}
                style={{ background: color }}
                onClick={() => void accent(color)}
                aria-label={color}
                aria-pressed={color === channel.accent}
              />
            ))}
          </div>
        </div>
        <div className="ch-actions">
          <button className="btn" type="button" onClick={onConnections}>
            Connections
          </button>
          <button className="btn-primary" type="button" onClick={() => setMaking(true)}>
            New flick
          </button>
        </div>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="ch-list">
        {channel.flicks.map((flick) => {
          const clipped = clippedRow(flick, channel.flicks);
          const armed = pendingDelete === flick.id;
          return (
            <article key={flick.id} className="ch-card">
              <button type="button" className="btn-ghost ch-open" onClick={() => onOpen(flick.id)}>
                <strong>{flick.name}</strong>
                <span className="ch-when">{clipped || "Not clipped yet"}</span>
                <span className="ch-go">Open</span>
              </button>
              <span className="ch-card-actions">
                <button className="btn" type="button" onClick={() => void duplicate(flick.id)}>
                  Duplicate
                </button>
                <button
                  className="btn-danger"
                  type="button"
                  data-delete-flick={flick.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (armed) void removeFlick(flick.id);
                    else setPendingDelete(flick.id);
                  }}
                >
                  {armed ? "Confirm delete" : "Delete"}
                </button>
              </span>
            </article>
          );
        })}
        {!channel.flicks.length ? <p className="muted ch-empty">This channel has no flicks yet.</p> : null}
      </div>
      {making ? (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="start-flick-title">
          <div className="modal panel stack">
            <h2 id="start-flick-title">Start a flick</h2>
            <p className="muted">A template is the baseline. Blank starts with an empty frame.</p>
            <label className="stack">
              <span>Name</span>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="cards">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="card"
                  aria-pressed={template.id === templateId}
                  style={{ borderColor: template.id === templateId ? "#e2b340" : undefined }}
                  onClick={() => setTemplateId(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span className="muted tiny">{template.builtin ? "Ships with Go7Flicks" : "Saved on this computer"}</span>
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="btn-primary" type="button" onClick={() => void create()}>
                Create
              </button>
              <button className="btn" type="button" onClick={() => setMaking(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
