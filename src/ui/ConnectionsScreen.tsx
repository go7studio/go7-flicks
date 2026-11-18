import { useEffect, useState } from "react";
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
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormDraft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    setRows(await window.flicks!.connections());
  }

  useEffect(() => {
    void reload();
  }, []);

  function openNew(kind: ConnectionKind, key = kind) {
    setEditing(key);
    setForm(emptyForm(kind));
    setMessage("");
  }

  function openEdit(slot: Slot) {
    if (!slot.row) {
      openNew(slot.kind);
      return;
    }
    setEditing(slot.key);
    setForm(formFromRow(slot.row));
    setMessage("");
  }

  async function save(slot: Slot) {
    if (!form) return;
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
      setForm(null);
      setEditing(null);
      setMessage(result.message || "Saved. Press Test.");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function signIn(slot: Slot) {
    const draftForm = form && editing === slot.key ? form : null;
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
      setForm(null);
      setEditing(null);
      setMessage(result.ok ? "Connected." : result.message || signInLine(slot.kind));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function test(slot: Slot) {
    if (!slot.row) return;
    setBusy(slot.key);
    setMessage("");
    try {
      const result = await window.flicks!.testConnection(slot.row.id);
      setMessage(result.ok ? "Connected." : result.message || "Test failed. Check the key and try again.");
      await reload();
    } finally {
      setBusy(null);
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
      if (editing === slot.key) {
        setEditing(null);
        setForm(null);
      }
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
        {message ? <p className="banner start-note">{message}</p> : null}
        <div className="conn-list">
          {slots.map((slot) => {
            const connected = slot.row?.connected === true;
            const status = connected ? "Connected" : connectionNote(slot.kind, slot.row?.statusNote ?? "") || "Not tested";
            const editingThis = editing === slot.key;
            const loginChoices: ConnectionAuth[] =
              form?.kind === "cursor"
                ? ["cli"]
                : form?.kind === "claude" || form?.kind === "codex" || form?.kind === "grok"
                  ? ["key", "cli"]
                  : ["key"];
            return (
              <article key={slot.key} className="conn-row">
                <div className="conn-id">
                  <strong>{slot.row?.name || LABELS[slot.kind]}</strong>
                  <span className="conn-detail">
                    {LABELS[slot.kind]}
                    {slot.row ? ` · ${slot.row.model}` : ""}
                  </span>
                </div>
                <p className={connected ? "conn-state on" : "conn-state"}>
                  <i className={connected ? "conn-dot on" : "conn-dot"} aria-hidden="true" />
                  {status}
                </p>
                <div className="conn-action">
                  <button className="btn" type="button" disabled={busy === slot.key} onClick={() => openEdit(slot)}>
                    Edit
                  </button>
                  {slot.row ? (
                    <button className="btn-primary" type="button" disabled={busy === slot.key} onClick={() => void test(slot)}>
                      Test
                    </button>
                  ) : (
                    <button className="btn-primary" type="button" disabled={busy === slot.key} onClick={() => openEdit(slot)}>
                      Add
                    </button>
                  )}
                  {slot.row ? (
                    <button className="btn-ghost" type="button" disabled={busy === slot.key} onClick={() => void remove(slot)}>
                      Delete
                    </button>
                  ) : null}
                </div>
                {editingThis && form ? (
                  <form
                    className="conn-key stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(slot);
                    }}
                  >
                    <label className="stack">
                      <span>Kind</span>
                      <select
                        className="field"
                        value={form.kind}
                        disabled={Boolean(slot.row)}
                        onChange={(event) => {
                          const kind = event.target.value as ConnectionKind;
                          setForm(emptyForm(kind));
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
                      <span>Name</span>
                      <input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </label>
                    <label className="stack">
                      <span>Login</span>
                      <select
                        className="field"
                        value={form.auth}
                        onChange={(event) => setForm({ ...form, auth: event.target.value as ConnectionAuth })}
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
                          onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
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
                    <label className="stack">
                      <span>Model</span>
                      <input className="field" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
                    </label>
                    <label className="stack">
                      <span>Base URL</span>
                      <input className="field" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
                    </label>
                    {form.kind === "other" ? (
                      <p className="muted tiny">A Gemini API key can go on this row.</p>
                    ) : null}
                    <label className="stack">
                      <span>Format</span>
                      <select className="field" value={form.api} onChange={(event) => setForm({ ...form, api: event.target.value as ChatApi })}>
                        <option value="openai-completions">OpenAI-style chat</option>
                        <option value="anthropic-messages">Anthropic messages</option>
                      </select>
                    </label>
                    <div className="actions">
                      <button className="btn-primary" type="submit" disabled={busy === slot.key}>
                        Save
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setForm(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}
                {slot.row && slot.row.voices.length ? (
                  <label className="conn-voice">
                    <span className="conn-detail">Voice</span>
                    <select
                      value={slot.row.voiceId}
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
