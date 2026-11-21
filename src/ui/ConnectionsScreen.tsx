import { useEffect, useRef, useState } from "react";
import { connectionNote } from "../shared/connection-note";
import { defaultsFor, subscriptionRefusal, type ChatApi, type ConnectionAuth, type ConnectionDraft, type ConnectionKind, type ConnectionPublic } from "../shared/model";
import { StartShell } from "./StartShell";
import "./polish-nav.css";

const ORDER: ConnectionKind[] = ["grok", "cursor", "claude", "codex", "elevenlabs", "minimax", "other"];

const LABELS: Record<ConnectionKind, string> = {
  grok: "Grok",
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  elevenlabs: "ElevenLabs",
  minimax: "MiniMax",
  other: "Other",
};

type Slot = {
  key: string;
  kind: ConnectionKind;
  row: ConnectionPublic | null;
};

type FormDraft = {
  kind: ConnectionKind;
  name: string;
  auth: ConnectionAuth;
  baseUrl: string;
  model: string;
  api: ChatApi;
  apiKey: string;
};

function emptyForm(kind: ConnectionKind): FormDraft {
  const defaults = defaultsFor(kind);
  return {
    kind,
    name: defaults.name,
    auth: kind === "cursor" ? "cli" : defaults.auth,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    api: defaults.api,
    apiKey: "",
  };
}

function formFromRow(row: ConnectionPublic): FormDraft {
  return {
    kind: row.kind,
    name: row.name,
    auth: row.auth,
    baseUrl: row.baseUrl,
    model: row.model,
    api: row.api,
    apiKey: "",
  };
}

export function ConnectionsScreen({
  onHome,
  onLibrary,
  onBack,
}: {
  onHome: () => void;
  onLibrary: () => void;
  onBack?: () => void;
}) {
  const [rows, setRows] = useState<ConnectionPublic[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [setupOpen, setSetupOpen] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hearError, setHearError] = useState<Record<string, string>>({});
  const player = useRef<HTMLAudioElement | null>(null);
  const previewUrl = useRef<string | null>(null);
  const hearTicket = useRef(0);

  async function reload() {
    setRows(await window.flicks!.connections());
  }

  useEffect(() => {
    void reload();
  }, []);

  function draftOf(slot: Slot): FormDraft {
    return drafts[slot.key] ?? (slot.row ? formFromRow(slot.row) : emptyForm(slot.kind));
  }

  function writeDraft(slot: Slot, next: FormDraft) {
    setDrafts((current) => ({ ...current, [slot.key]: next }));
  }

  function toggleProvider(slot: Slot) {
    setOpen((current) => ({ ...current, [slot.key]: current[slot.key] !== true }));
  }

  function toggleSetup(slot: Slot) {
    setSetupOpen((current) => ({ ...current, [slot.key]: current[slot.key] !== true }));
  }

  async function save(slot: Slot) {
    if (open[slot.key] !== true) return;
    const form = draftOf(slot);
    const name = form.name.trim();
    if (!name) {
      setMessage("Name this connection first.");
      return;
    }
    if (form.kind === "other" && (!form.baseUrl.trim() || !form.model.trim())) {
      setMessage("Other connections need a base URL and a model.");
      return;
    }
    const blocked = subscriptionRefusal(form.baseUrl, form.model);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    if (form.auth === "key" && !form.apiKey.trim() && !slot.row?.hasCredential) {
      setMessage("Paste a key, or choose Sign in on this computer.");
      return;
    }
    setBusy(slot.key);
    setMessage("");
    try {
      const draft: ConnectionDraft = {
        id: slot.row?.id,
        kind: form.kind,
        name,
        auth: form.kind === "cursor" ? "cli" : form.auth,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        api: form.api,
        voiceId: slot.row?.voiceId || defaultsFor(form.kind).voiceId,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      const result = await window.flicks!.saveConnection(draft);
      if (!result.ok) {
        setMessage(result.message || "Could not save that connection.");
        return;
      }
      const saved = result.connection;
      const refreshed = saved ? formFromRow(saved) : { ...form, apiKey: "" };
      const nextKey = saved?.id || slot.key;
      setDrafts((current) => {
        const next = { ...current, [nextKey]: refreshed };
        if (nextKey !== slot.key) delete next[slot.key];
        return next;
      });
      if (saved && saved.id !== slot.key) {
        setOpen((current) => {
          const next = { ...current, [saved.id]: true };
          delete next[slot.key];
          return next;
        });
        setSetupOpen((current) => {
          const next = { ...current };
          if (current[slot.key]) next[saved.id] = true;
          delete next[slot.key];
          return next;
        });
      }
      setMessage(result.message || "Saved. Press Test.");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function signIn(slot: Slot) {
    const draftForm = open[slot.key] === true ? draftOf(slot) : null;
    if (!draftForm) {
      setMessage(signInLine(slot.kind));
      return;
    }
    const name = draftForm.name.trim();
    if (!name) {
      setMessage("Name this connection first.");
      return;
    }
    if (draftForm.kind === "other" && (!draftForm.baseUrl.trim() || !draftForm.model.trim())) {
      setMessage("Other connections need a base URL and a model.");
      return;
    }
    const blocked = subscriptionRefusal(draftForm.baseUrl, draftForm.model);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    setBusy(slot.key);
    setMessage("");
    try {
      const saved = await window.flicks!.saveConnection({
        id: slot.row?.id,
        kind: draftForm.kind,
        name,
        auth: "cli",
        baseUrl: draftForm.baseUrl.trim(),
        model: draftForm.model.trim(),
        api: draftForm.api,
        voiceId: slot.row?.voiceId || defaultsFor(draftForm.kind).voiceId,
      });
      if (!saved.ok || !saved.connection) {
        setMessage(saved.message || signInLine(slot.kind));
        return;
      }
      const result = await window.flicks!.testConnection(saved.connection.id);
      const refreshed = formFromRow(saved.connection);
      const nextKey = saved.connection.id;
      setDrafts((current) => {
        const next = { ...current, [nextKey]: refreshed };
        if (nextKey !== slot.key) delete next[slot.key];
        return next;
      });
      if (nextKey !== slot.key) {
        setOpen((current) => {
          const next = { ...current, [nextKey]: true };
          delete next[slot.key];
          return next;
        });
      }
      setMessage(result.ok ? "Connected." : result.message || signInLine(slot.kind));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function test(slot: Slot) {
    if (!slot.row) return;
    setBusy(slot.key);
    try {
      const result = await window.flicks!.testConnection(slot.row.id);
      setMessage(result.message || (result.ok ? "Connected." : "Test failed. Check the key and try again."));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  function stopPreview() {
    const audio = player.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
  }

  async function hear(slot: Slot) {
    if (!slot.row) return;
    const ticket = hearTicket.current + 1;
    hearTicket.current = ticket;
    stopPreview();
    setBusy(slot.key);
    setHearError((current) => ({ ...current, [slot.key]: "" }));
    try {
      const result = await window.flicks!.hearVoice(slot.row.id);
      if (ticket !== hearTicket.current) return;
      if (!result.ok || !result.audioBase64) {
        setHearError((current) => ({ ...current, [slot.key]: result.message || "Could not play that voice." }));
        return;
      }
      const binary = atob(result.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      previewUrl.current = url;
      const audio = player.current ?? new Audio();
      player.current = audio;
      audio.src = url;
      await audio.play();
      if (ticket !== hearTicket.current) audio.pause();
    } catch (error) {
      if (ticket !== hearTicket.current) return;
      const detail = error instanceof Error ? error.message : "Could not play that voice.";
      setHearError((current) => ({ ...current, [slot.key]: detail }));
    } finally {
      if (ticket === hearTicket.current) setBusy(null);
    }
  }

  async function remove(slot: Slot) {
    if (!slot.row) return;
    setBusy(slot.key);
    try {
      const result = await window.flicks!.deleteConnection(slot.row.id);
      if (!result.ok) {
        setMessage(result.message || "Could not delete that connection.");
        return;
      }
      setOpen((current) => ({ ...current, [slot.key]: false }));
      setSetupOpen((current) => ({ ...current, [slot.key]: false }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[slot.key];
        return next;
      });
      setMessage("Deleted.");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  const slots = buildSlots(rows);

  return (
    <StartShell nav="connections" onHome={onHome} onLibrary={onLibrary} onConnections={() => undefined}>
      <div className="conn-page">
        {onBack ? (
          <button className="btn-ghost conn-back" type="button" onClick={onBack}>
            Back
          </button>
        ) : null}
        <h1>Connections</h1>
        <p className="muted tiny">Keys stay on this computer. They never show in the window after you save.</p>
        {message ? (
          <p className="banner start-note" aria-live="polite">
            {message}
          </p>
        ) : null}
        <audio ref={player} />
        <div className="conn-list">
          {slots.map((slot) => {
            const connected = slot.row?.connected === true;
            const note = connectionNote(slot.kind, slot.row?.statusNote ?? "");
            const status = connected ? "Connected" : note || "Not tested";
            const isOpen = open[slot.key] === true;
            const setup = setupOpen[slot.key] === true;
            const form = draftOf(slot);
            const label = LABELS[slot.kind];
            const panelId = `conn-panel-${slot.key}`;
            const loginChoices: ConnectionAuth[] =
              form.kind === "cursor"
                ? ["cli"]
                : form.kind === "claude" || form.kind === "codex" || form.kind === "grok"
                  ? ["key", "cli"]
                  : ["key"];
            return (
              <article key={slot.key} className="conn-row" data-provider={slot.kind} data-open={isOpen ? "true" : "false"}>
                <div className="conn-id">
                  <strong>{slot.row?.name || label}</strong>
                  <span className="conn-detail">
                    {label}
                    {slot.row ? ` · ${slot.row.model}` : ""}
                  </span>
                </div>
                <div className="conn-status">
                  <p className={connected ? "conn-state on" : "conn-state"}>
                    <i className={connected ? "conn-dot on" : "conn-dot"} aria-hidden="true" />
                    {status}
                  </p>
                  {connected && note ? (
                    <p className="conn-note" aria-live="polite">
                      {note}
                    </p>
                  ) : null}
                </div>
                <div className="conn-action">
                  <button
                    className="btn"
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={`${isOpen ? "Hide" : "Show"} ${label}`}
                    onClick={() => toggleProvider(slot)}
                  >
                    {isOpen ? "Hide" : "Show"}
                  </button>
                </div>
                <form
                  id={panelId}
                  className="conn-key stack"
                  hidden={!isOpen}
                  style={{ alignItems: "stretch", flexDirection: "column", display: isOpen ? "flex" : "none" }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(slot);
                  }}
                >
                  <label className="stack">
                    <span>Name</span>
                    <input
                      className="field"
                      aria-label={`${label} name`}
                      value={form.name}
                      onChange={(event) => writeDraft(slot, { ...form, name: event.target.value })}
                    />
                  </label>
                  <label className="stack">
                    <span>Login</span>
                    <select
                      className="field"
                      aria-label={`${label} login`}
                      value={form.auth}
                      onChange={(event) => writeDraft(slot, { ...form, auth: event.target.value as ConnectionAuth })}
                      disabled={slot.kind === "cursor"}
                    >
                      {loginChoices.includes("cli") ? <option value="cli">Sign in on this computer</option> : null}
                      {loginChoices.includes("key") ? <option value="key">API key</option> : null}
                    </select>
                  </label>
                  {form.auth === "key" ? (
                    <label className="stack">
                      <span>Key</span>
                      <input
                        className="field"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={slot.row?.hasCredential ? "Key saved — paste to replace" : "Paste a key"}
                        aria-label={`${form.name} key`}
                        value={form.apiKey}
                        onChange={(event) => writeDraft(slot, { ...form, apiKey: event.target.value })}
                      />
                    </label>
                  ) : (
                    <p className="muted tiny">
                      {slot.kind === "cursor" ? "Uses cursor-agent on this computer." : "Uses the CLI on this computer."}
                      {slot.row ? null : (
                        <>
                          {" "}
                          <button className="btn" type="button" disabled={busy === slot.key} onClick={() => void signIn(slot)}>
                            Check sign-in
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  <div className="actions">
                    <button className="btn-primary" type="submit" disabled={busy === slot.key}>
                      Save
                    </button>
                    {slot.row ? (
                      <button className="btn-primary" type="button" disabled={busy === slot.key} onClick={() => void test(slot)}>
                        Test
                      </button>
                    ) : null}
                  </div>
                  {slot.row && (slot.row.voices.length || slot.kind === "elevenlabs" || slot.kind === "minimax") ? (
                    <div className="conn-voice">
                      {slot.row.voices.length ? (
                        <label>
                          <span className="conn-detail">Voice</span>
                          <select
                            value={slot.row.voiceId}
                            aria-label={`${label} voice`}
                            onChange={(event) => {
                              const voiceId = event.target.value;
                              void window.flicks!.setVoice(slot.row!.id, voiceId).then(() => reload());
                            }}
                          >
                            {slot.row.voices.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {slot.kind === "elevenlabs" || slot.kind === "minimax" ? (
                        <button className="btn" type="button" disabled={busy === slot.key} onClick={() => void hear(slot)}>
                          Hear voice
                        </button>
                      ) : null}
                      {hearError[slot.key] ? <p className="conn-note">{hearError[slot.key]}</p> : null}
                    </div>
                  ) : null}
                  <div className="stack">
                    <button className="btn" type="button" aria-expanded={setup} style={{ alignSelf: "flex-start", width: "fit-content" }} onClick={() => toggleSetup(slot)}>
                      {setup ? "Hide setup" : "Setup"}
                    </button>
                    {setup ? (
                      <div className="stack">
                        <label className="stack">
                          <span>Kind</span>
                          <select
                            className="field"
                            aria-label={`${label} kind`}
                            value={form.kind}
                            disabled={Boolean(slot.row)}
                            onChange={(event) => {
                              const kind = event.target.value as ConnectionKind;
                              writeDraft(slot, emptyForm(kind));
                            }}
                          >
                            {ORDER.map((kind) => (
                              <option key={kind} value={kind}>
                                {LABELS[kind]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="stack">
                          <span>Model</span>
                          <input
                            className="field"
                            aria-label={`${label} model`}
                            value={form.model}
                            onChange={(event) => writeDraft(slot, { ...form, model: event.target.value })}
                          />
                        </label>
                        <label className="stack">
                          <span>Base URL</span>
                          <input
                            className="field"
                            aria-label={`${label} base URL`}
                            value={form.baseUrl}
                            onChange={(event) => writeDraft(slot, { ...form, baseUrl: event.target.value })}
                          />
                        </label>
                        {form.kind === "other" ? <p className="muted tiny">A Gemini API key can go on this row.</p> : null}
                        {form.kind === "minimax" ? <p className="muted tiny">Test lists MiniMax voices. It does not send a chat.</p> : null}
                        {form.kind === "elevenlabs" || form.kind === "minimax" ? null : (
                          <label className="stack">
                            <span>Format</span>
                            <select
                              className="field"
                              aria-label={`${label} format`}
                              value={form.api}
                              onChange={(event) => writeDraft(slot, { ...form, api: event.target.value as ChatApi })}
                            >
                              <option value="openai-completions">OpenAI-style chat</option>
                              <option value="anthropic-messages">Anthropic messages</option>
                            </select>
                          </label>
                        )}
                        {slot.row ? (
                          <button className="btn-ghost" type="button" disabled={busy === slot.key} onClick={() => void remove(slot)}>
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      </div>
    </StartShell>
  );
}

function buildSlots(rows: ConnectionPublic[]): Slot[] {
  const used = new Set<string>();
  const slots: Slot[] = [];
  for (const kind of ORDER) {
    const matches = rows.filter((row) => row.kind === kind);
    if (!matches.length) slots.push({ key: kind, kind, row: null });
    for (const row of matches) {
      used.add(row.id);
      slots.push({ key: row.id, kind, row });
    }
  }
  for (const row of rows) {
    if (!used.has(row.id)) slots.push({ key: row.id, kind: row.kind, row });
  }
  return slots;
}

function signInLine(kind: ConnectionKind): string {
  if (kind === "cursor") return "Install cursor-agent and sign in on this computer.";
  if (kind === "claude") return "Run claude login on this computer, or paste an API key.";
  if (kind === "codex") return "Run codex login on this computer, or paste an API key.";
  return "Sign in on this computer, or paste an API key.";
}
