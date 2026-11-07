import { useEffect, useState } from "react";
import type { ChannelFile, Template } from "../shared/model";

const ACCENTS = ["#e2b340", "#e15a3a", "#7ec8b3", "#8eb6ff", "#f3f0e6"];

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
  const [templateId, setTemplateId] = useState("builtin-split");

  useEffect(() => {
    void window.flicks!.openChannel(dir).then((result) => {
      if (!result.ok || !result.channel) setMessage(result.message ?? "Could not open the channel.");
      else setChannel(result.channel);
    });
    void window.flicks!.templates().then((items) => {
      setTemplates(items);
      if (items[0]) setTemplateId(items[0].id);
    });
  }, [dir]);

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
      <main className="page">
        <p className="banner">{message || "Opening channel…"}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <button className="btn-ghost" onClick={onHome}>
            Channels
          </button>
          <h1>{channel.name}</h1>
          <div className="row">
            {ACCENTS.map((color) => (
              <button
                key={color}
                className={color === channel.accent ? "swatch on" : "swatch"}
                style={{ background: color }}
                onClick={() => void accent(color)}
                aria-label={color}
              />
            ))}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onConnections}>
            Connections
          </button>
          <button className="btn-primary" onClick={() => setMaking(true)}>
            New flick
          </button>
        </div>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="cards">
        {channel.flicks.map((flick) => (
          <button key={flick.id} className="card" onClick={() => onOpen(flick.id)}>
            <strong>{flick.name}</strong>
            <span className="muted tiny">{new Date(flick.updatedAt).toLocaleString()}</span>
          </button>
        ))}
        {!channel.flicks.length ? <p className="muted">This channel has no flicks yet.</p> : null}
      </div>
      {making ? (
        <div className="modal-back">
          <div className="modal panel stack">
            <h2>Start a flick</h2>
            <p className="muted">A template is the baseline. Blank starts with an empty frame.</p>
            <label className="stack">
              <span>Name</span>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="cards">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className="card"
                  style={{ borderColor: template.id === templateId ? "#e2b340" : undefined }}
                  onClick={() => setTemplateId(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span className="muted tiny">{template.builtin ? "Ships with Go7Flicks" : "Saved on this computer"}</span>
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="btn-primary" onClick={() => void create()}>
                Create
              </button>
              <button className="btn" onClick={() => setMaking(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
