import { useEffect, useState } from "react";
import type { ChannelFile, Template } from "../shared/model";
import { whenPhrase } from "../shared/when";

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
  const [templateId, setTemplateId] = useState("builtin-split");

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
    void window.flicks!.openChannel(dir).then((result) => {
      if (!result.ok || !result.channel) setMessage(result.message ?? "Could not open the channel.");
      else setChannel(result.channel);
    });
    void window.flicks!.templates().then((items) => {
      const sorted = sortTemplates(items);
      setTemplates(sorted);
      setTemplateId(sorted.find((item) => item.id === "builtin-split")?.id ?? sorted[0]?.id ?? "builtin-split");
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
        <button className="btn" type="button" onClick={onHome}>
          Back to Home
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <button className="btn-ghost" type="button" onClick={onHome}>
            Home
          </button>
          <h1>{channel.name}</h1>
          <div className="row">
            <span className="muted tiny">Color</span>
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
          <button className="btn" type="button" onClick={onConnections}>
            Connections
          </button>
          <button className="btn-primary" type="button" onClick={() => setMaking(true)}>
            New flick
          </button>
        </div>
      </header>
      {message ? <p className="banner">{message}</p> : null}
      <div className="flick-list">
        {channel.flicks.map((flick) => {
          const clipped = clippedRow(flick, channel.flicks);
          return (
            <button key={flick.id} className="flick-row" type="button" onClick={() => onOpen(flick.id)}>
              <strong>{flick.name}</strong>
              <span className="flick-when">{clipped || "Not clipped yet"}</span>
            </button>
          );
        })}
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
                  type="button"
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
