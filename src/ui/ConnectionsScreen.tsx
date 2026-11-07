import { useEffect, useState } from "react";
import { defaultsFor, type ConnectionDraft, type ConnectionKind, type ConnectionPublic } from "../shared/model";

const KINDS: ConnectionKind[] = ["claude", "codex", "elevenlabs", "minimax", "other"];

export function ConnectionsScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<ConnectionPublic[]>([]);
  const [draft, setDraft] = useState<ConnectionDraft>({ kind: "claude", ...defaultsFor("claude"), apiKey: "" });
  const [message, setMessage] = useState("");

  async function reload() {
    setRows(await window.flicks!.connections());
  }

  useEffect(() => {
    void reload();
  }, []);

  function chooseKind(kind: ConnectionKind) {
    setDraft({ ...defaultsFor(kind), kind, apiKey: "" });
  }

  async function save() {
    const result = await window.flicks!.saveConnection(draft);
    setMessage(result.message ?? (result.ok ? "Saved." : "Could not save."));
    if (result.ok) {
      setDraft({ ...defaultsFor(draft.kind), kind: draft.kind, apiKey: "" });
      await reload();
    }
  }

  async function test(id: string) {
    const result = await window.flicks!.testConnection(id);
    setMessage(result.message ?? "");
    await reload();
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <button className="btn-ghost" onClick={onBack}>
            Back
          </button>
          <h1>Connections</h1>
          <p className="muted">Each account stays its own. Keys are encrypted on this computer.</p>
        </div>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="grid-2">
        <form
          className="panel stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>{draft.id ? "Edit connection" : "Add connection"}</h2>
          <label className="stack">
            <span>Kind</span>
            <select
              value={draft.kind}
              onChange={(event) => chooseKind(event.target.value as ConnectionKind)}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Name</span>
            <input className="field" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          {draft.kind === "claude" || draft.kind === "codex" ? (
            <label className="stack">
              <span>Login</span>
              <select
                value={draft.auth}
                onChange={(event) => setDraft({ ...draft, auth: event.target.value as ConnectionDraft["auth"] })}
              >
                <option value="key">API key</option>
                <option value="cli">Subscription already on this computer</option>
              </select>
            </label>
          ) : null}
          {draft.auth === "key" ? (
            <label className="stack">
              <span>API key</span>
              <input
                className="field"
                type="password"
                value={draft.apiKey ?? ""}
                placeholder={draft.id ? "Leave blank to keep the saved key" : ""}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>
          ) : null}
          {draft.kind !== "elevenlabs" ? (
            <label className="stack">
              <span>Model</span>
              <input className="field" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
            </label>
          ) : null}
          {draft.kind === "other" || draft.kind === "minimax" || draft.kind === "codex" || draft.kind === "elevenlabs" ? (
            <label className="stack">
              <span>Base URL</span>
              <input className="field" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
            </label>
          ) : null}
          {draft.kind === "other" ? (
            <label className="stack">
              <span>Format</span>
              <select
                value={draft.api}
                onChange={(event) => setDraft({ ...draft, api: event.target.value as ConnectionDraft["api"] })}
              >
                <option value="openai-completions">OpenAI completions</option>
                <option value="anthropic-messages">Anthropic messages</option>
              </select>
            </label>
          ) : null}
          <button className="btn-primary" type="submit">
            Save
          </button>
        </form>
        <div className="stack">
          {rows.map((row) => (
            <article key={row.id} className="panel stack">
              <strong>
                {row.name} · {row.kind}
              </strong>
              <span className="muted tiny">
                {row.connected ? "Connected" : "Not tested"} · {row.auth === "cli" ? "Subscription" : row.hasCredential ? "Key saved" : "No key"}
              </span>
              <span className="muted">{row.statusNote}</span>
              {row.voices.length ? (
                <label className="stack">
                  <span>Voice</span>
                  <select
                    value={row.voiceId}
                    onChange={(event) => {
                      void window.flicks!.setVoice(row.id, event.target.value).then(() => reload());
                    }}
                  >
                    {row.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="actions">
                <button className="btn-primary" onClick={() => void test(row.id)}>
                  Test
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    setDraft({
                      id: row.id,
                      kind: row.kind,
                      name: row.name,
                      auth: row.auth,
                      baseUrl: row.baseUrl,
                      model: row.model,
                      api: row.api,
                      voiceId: row.voiceId,
                      apiKey: "",
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    void window.flicks!.deleteConnection(row.id).then(() => reload());
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
          {!rows.length ? <p className="muted">No connections yet.</p> : null}
        </div>
      </div>
    </main>
  );
}
