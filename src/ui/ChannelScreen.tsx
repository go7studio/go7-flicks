import { useEffect, useRef, useState } from "react";
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
  const [editingChannel, setEditingChannel] = useState(false);
  const [editingFlickId, setEditingFlickId] = useState<string | null>(null);
  const [flickDraft, setFlickDraft] = useState("");
  const [templateId, setTemplateId] = useState("builtin-split");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const channelInputRef = useRef<HTMLInputElement | null>(null);
  const flickInputRef = useRef<HTMLInputElement | null>(null);
  const skipChannelBlur = useRef(false);
  const skipFlickBlur = useRef(false);

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
    setEditingChannel(false);
    setEditingFlickId(null);
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

  useEffect(() => {
    if (editingChannel) channelInputRef.current?.focus();
  }, [editingChannel]);

  useEffect(() => {
    if (editingFlickId) flickInputRef.current?.focus();
  }, [editingFlickId]);

  function cancelChannelEdit() {
    if (!channel) return;
    skipChannelBlur.current = true;
    setDraftName(channel.name);
    setEditingChannel(false);
  }

  async function saveChannelName() {
    setPendingDelete(null);
    const next = draftName.trim();
    if (!next || !channel) {
      setDraftName(channel?.name ?? "");
      setEditingChannel(false);
      return;
    }
    if (next === channel.name) {
      setEditingChannel(false);
      return;
    }
    setMessage("");
    try {
      const result = await channelLibrary().renameChannel(dir, next);
      if (!result.ok || !result.channel) {
        setMessage(result.message ?? "Could not rename the channel.");
        setDraftName(channel.name);
        setEditingChannel(false);
        return;
      }
      setChannel(result.channel);
      setDraftName(result.channel.name);
      setEditingChannel(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename the channel.");
      setDraftName(channel.name);
      setEditingChannel(false);
    }
  }

  function startFlickEdit(flickId: string, currentName: string) {
    setPendingDelete(null);
    setEditingChannel(false);
    skipFlickBlur.current = false;
    setEditingFlickId(flickId);
    setFlickDraft(currentName);
  }

  function cancelFlickEdit() {
    skipFlickBlur.current = true;
    setEditingFlickId(null);
    setFlickDraft("");
  }

  async function saveFlickName(flickId: string) {
    setPendingDelete(null);
    const next = flickDraft.trim();
    const current = channel?.flicks.find((item) => item.id === flickId)?.name ?? "";
    if (!next || next === current) {
      setEditingFlickId(null);
      setFlickDraft("");
      return;
    }
    setMessage("");
    try {
      const loaded = await window.flicks!.readFlick(dir, flickId);
      if (!loaded.ok || !loaded.flick) {
        setMessage(loaded.message ?? "Could not rename the flick.");
        setEditingFlickId(null);
        setFlickDraft("");
        return;
      }
      const result = await window.flicks!.saveFlick(dir, { ...loaded.flick, name: next });
      if (!result.ok || !result.flick) {
        setMessage(result.message ?? "Could not rename the flick.");
        setEditingFlickId(null);
        setFlickDraft("");
        return;
      }
      setChannel((prev) =>
        prev
          ? {
              ...prev,
              flicks: prev.flicks.map((item) =>
                item.id === flickId ? { ...item, name: result.flick!.name, updatedAt: new Date().toISOString() } : item,
              ),
            }
          : prev,
      );
      setEditingFlickId(null);
      setFlickDraft("");
      await refreshChannel();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not rename the flick.");
      setEditingFlickId(null);
      setFlickDraft("");
    }
  }

  async function refreshChannel() {
    const opened = await window.flicks!.openChannel(dir);
    if (opened.ok && opened.channel) {
      setChannel(opened.channel);
      if (!editingChannel) setDraftName(opened.channel.name);
    }
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
          {editingChannel ? (
            <input
              ref={channelInputRef}
              className="field ch-title-edit"
              value={draftName}
              aria-label="Channel name"
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => {
                if (skipChannelBlur.current) {
                  skipChannelBlur.current = false;
                  return;
                }
                void saveChannelName();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelChannelEdit();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  skipChannelBlur.current = true;
                  void saveChannelName();
                }
              }}
            />
          ) : (
            <h1>
              <button
                type="button"
                className="ch-title"
                aria-label={`Rename ${channel.name}`}
                title="Click to rename"
                onClick={() => {
                  setPendingDelete(null);
                  setEditingFlickId(null);
                  skipChannelBlur.current = false;
                  setDraftName(channel.name);
                  setEditingChannel(true);
                }}
              >
                {channel.name}
              </button>
            </h1>
          )}
          <details className="ch-fold">
            <summary>Color</summary>
            <div className="ch-colors" role="group" aria-label="Channel color">
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
          </details>
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
      {channel.flicks.length ? (
        <details className="ch-fold ch-recent">
          <summary>Recent details</summary>
          <ul className="ch-recent-list">
            {channel.flicks.map((flick) => {
              const clipped = clippedRow(flick, channel.flicks);
              return (
                <li key={flick.id}>
                  <span>{flick.name}</span>
                  <span className="ch-when">{clipped || "Not clipped yet"}</span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <div className="ch-list">
        {channel.flicks.map((flick) => {
          const armed = pendingDelete === flick.id;
          const editingThis = editingFlickId === flick.id;
          return (
            <article key={flick.id} className="ch-card">
              <div className="ch-open">
                {editingThis ? (
                  <input
                    ref={flickInputRef}
                    className="field ch-flick-edit"
                    value={flickDraft}
                    aria-label="Flick name"
                    onChange={(event) => setFlickDraft(event.target.value)}
                    onBlur={() => {
                      if (skipFlickBlur.current) {
                        skipFlickBlur.current = false;
                        return;
                      }
                      void saveFlickName(flick.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelFlickEdit();
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        skipFlickBlur.current = true;
                        void saveFlickName(flick.id);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="ch-flick-title"
                    aria-label={`Rename ${flick.name}`}
                    title="Click to rename"
                    onClick={() => startFlickEdit(flick.id, flick.name)}
                  >
                    <strong>{flick.name}</strong>
                  </button>
                )}
                <button type="button" className="btn-ghost ch-go" onClick={() => onOpen(flick.id)}>
                  Open
                </button>
              </div>
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
