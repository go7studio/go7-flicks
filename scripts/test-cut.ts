/**
 * Live cut check for the open Go7Flicks window.
 * Run: npx tsx scripts/test-cut.ts
 * GTA gameplay cut only: npx tsx scripts/test-cut.ts --gta
 * The app should already be at http://localhost:5173/ with CDP on 127.0.0.1:9223.
 * This closes only its own debugger socket. It does not close the app.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { probeGpu, probeMedia } from "../electron/probe";
import { skipSubjectTitle } from "../src/shared/subject";
import { slotListTitle } from "../src/shared/desk";
import {
  CUT_BUTTON,
  DUAL_LABELS,
  HOME_LABELS,
  PARKOUR_FLICK,
  RANKING_LABELS,
  SHORT_LINKS,
  STYLED_BUTTON,
  type Check,
  captionIsNotFileName,
  checkLine,
  fewSecondsAround,
  gameplayClipOk,
  GTA_EXPORT_NAME,
  GTA_FALLBACK_LINKS,
  GTA_SUBJECT,
  missingLabels,
  rangeInsideFile,
  refusesKeeper,
  titleAboutSubject,
  whichClipVerdict,
} from "./cut-checks";

const exec = promisify(execFile);
const CHANNEL = String.raw`D:\GitHub\Go7 cut test`;
const PARENT = String.raw`D:\GitHub`;
const CUT_NAME = "cut-test-picture.mp4";
const STYLED_NAME = "cut-test-styled.mp4";

type Step = { name: string; ok: boolean; detail: string };

const groups: Record<"ui" | "cuts" | "links" | "ai" | "delivery", Step[]> = {
  ui: [],
  cuts: [],
  links: [],
  ai: [],
  delivery: [],
};

function note(group: keyof typeof groups, name: string, ok: boolean, detail: string) {
  const step = { name, ok, detail: redact(detail).slice(0, 360) };
  groups[group].push(step);
  console.log(`  ${ok ? "pass" : "fail"} ${name} — ${step.detail}`);
}

function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|passphrase)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

class Cdp {
  private next = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (!message.id) return;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message || "CDP error"));
      else waiting.resolve(message.result);
    });
  }

  static open(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new Cdp(ws);
      ws.addEventListener("open", () => resolve(client));
      ws.addEventListener("error", () => reject(new Error("Could not open the debugger socket.")));
    });
  }

  /** Closes this script's debugger socket. The app window stays open. */
  release() {
    this.ws.close();
  }

  async evaluate<T>(expression: string, timeoutMs = 30_000): Promise<T> {
    const sent = (await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    )) as {
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (sent.exceptionDetails) {
      const detail = sent.exceptionDetails.exception?.description || sent.exceptionDetails.text || "The page threw.";
      throw new Error(redact(detail).slice(0, 500));
    }
    return sent.result?.value as T;
  }

  private send(method: string, params: object, timeoutMs: number): Promise<unknown> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const PAGE = `
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function buttons() {
    return [...document.querySelectorAll("button")];
  }
  function clickLabel(label) {
    if (/clean unused/i.test(label)) throw new Error("Refusing Clean unused.");
    const exact = buttons().find((button) => button.innerText.replace(/\\s+/g, " ").trim() === label && !button.disabled);
    const hit = exact || buttons().find((button) => button.innerText.includes(label) && !button.disabled && !/clean unused/i.test(button.innerText));
    if (!hit) return { ok: false, detail: "not on screen: " + label };
    hit.click();
    return { ok: true, detail: hit.innerText.replace(/\\s+/g, " ").trim().slice(0, 80) };
  }
  function fiberRoot() {
    const root = document.getElementById("root");
    const key = root && Object.keys(root).find((name) => name.startsWith("__reactContainer"));
    if (!root || !key) return null;
    const container = root[key];
    return container && container.current ? container.current : container;
  }
  function routeHook() {
    const start = fiberRoot();
    const seen = new Set();
    const stack = start ? [start] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
      let hook = node.memoizedState;
      for (let guard = 0; hook && guard < 40; guard += 1) {
        const state = hook.memoizedState;
        if (state && typeof state === "object" && hook.queue && typeof hook.queue.dispatch === "function") {
          if (["home", "connections", "channel", "canvas", "ranking", "split"].includes(state.name)) return hook;
        }
        hook = hook.next;
      }
    }
    return null;
  }
  function fill(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function slotRows() {
    return [...document.querySelectorAll(".slot")].map((slot) => ({
      name: slot.querySelector(".slot-name")?.textContent?.trim() || "",
      time: slot.querySelector(".slot-time")?.textContent?.trim() || "",
    }));
  }
  async function waitIdle(ms, previous) {
    const start = Date.now();
    let saw = false;
    while (Date.now() - start < ms) {
      const banner = document.querySelector(".banner")?.textContent?.trim() || "";
      const gold = document.querySelector(".btn-gold");
      const busy = Boolean(gold && gold.disabled) || /Getting the clip|Finding clips|Cutting|Rendering|Asking which clip/.test(banner);
      if (busy) saw = true;
      if (saw && !busy) return banner;
      if (saw === false && banner && banner !== previous && Date.now() - start > 800 && !/Getting the clip|Finding clips/.test(banner)) return banner;
      await sleep(400);
    }
    return "timed out: " + (document.querySelector(".banner")?.textContent?.trim() || "");
  }
  window.__go7Cut = {
    text: () => document.body.innerText,
    click: clickLabel,
    async goHome() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (document.body.innerText.includes("what would you like to create today")) return { ok: true, detail: "Home" };
        const home = buttons().find((button) => button.innerText.replace(/\\s+/g, " ").trim() === "Home");
        if (!home) return { ok: false, detail: "Home is not on screen" };
        home.click();
        await sleep(350);
      }
      const ok = document.body.innerText.includes("what would you like to create today");
      return { ok, detail: ok ? "Home" : "Home did not open" };
    },
    setRoute(route) {
      const hook = routeHook();
      if (!hook) return { ok: false, detail: "Could not find the screen state." };
      if (route && route.dir) sessionStorage.removeItem("go7-flicks-desk:" + route.dir + ":ranking");
      hook.queue.dispatch(route);
      return { ok: true, detail: route.name };
    },
    readRoute() {
      const hook = routeHook();
      return hook ? hook.memoizedState : null;
    },
    async ensureChannel() {
      const opened = await window.flicks.openChannel(${JSON.stringify(CHANNEL)});
      if (opened && opened.ok && opened.dir) return { ok: true, dir: opened.dir };
      const created = await window.flicks.createChannel(${JSON.stringify(PARENT)}, "Go7 cut test");
      if (!created || !created.ok || !created.dir) return { ok: false, detail: (created && created.message) || "Could not open the test channel." };
      return { ok: true, dir: created.dir };
    },
    hint() {
      return document.querySelector(".timeline-hint")?.textContent?.trim() || "";
    },
    async prepareSlot(index, link, caption) {
      const slots = [...document.querySelectorAll(".slot")];
      if (!slots[index]) return { ok: false, detail: "Slot " + (index + 1) + " is missing." };
      slots[index].click();
      await sleep(150);
      let captionField = document.querySelector('[aria-label="Caption"]');
      if (!captionField) {
        const more = buttons().find((item) => item.innerText.replace(/\\s+/g, " ").trim() === "More");
        if (more) more.click();
        await sleep(150);
        captionField = document.querySelector('[aria-label="Caption"]');
      }
      const linkField = document.querySelector('input[placeholder="Paste a link"]');
      if (!captionField || !linkField) return { ok: false, detail: "Caption or link field is missing." };
      fill(captionField, caption);
      fill(linkField, link);
      await sleep(50);
      return { ok: true, detail: caption };
    },
    async clickGet() {
      const before = document.querySelector(".banner")?.textContent?.trim() || "";
      const button = buttons().find((item) => {
        const label = item.innerText.replace(/\\s+/g, " ").trim();
        return (label === "Add link" || label === "Get") && !item.disabled;
      });
      if (!button) return { ok: false, detail: "Get is not available." };
      button.click();
      const banner = await waitIdle(8 * 60 * 1000, before);
      const file = [...document.querySelectorAll(".rank-inspector .file-note")].map((node) => node.textContent.trim()).find((line) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(line)) || "";
      const durationLine = [...document.querySelectorAll(".rank-inspector p.muted")].map((node) => node.textContent || "").find((line) => line.includes("This file is")) || "";
      const caption = document.querySelector('[aria-label="Caption"]')?.value || "";
      return { ok: Boolean(file) && /This file is\\s+[1-9]/.test(durationLine), banner, file, durationLine, caption, before };
    },
    async setOut(clock) {
      const field = [...document.querySelectorAll(".clock")].find((item) => item.innerText.trim().startsWith("Out"));
      const input = field && field.querySelector("input");
      if (!input) return { ok: false, detail: "Out is not on screen." };
      input.focus();
      fill(input, clock);
      await sleep(80);
      input.blur();
      await sleep(80);
      return { ok: true, detail: input.value };
    },
    slots: slotRows,
    async openTimeline() {
      const button = buttons().find((item) => item.innerText.includes("Open timeline") && !item.disabled);
      if (!button) return { ok: false, detail: "Open timeline is not available." };
      button.click();
      const start = Date.now();
      while (Date.now() - start < 20000) {
        if (buttons().some((item) => item.innerText.includes(${JSON.stringify(STYLED_BUTTON)}))) {
          return { ok: true, detail: "timeline" };
        }
        await sleep(250);
      }
      return { ok: false, detail: document.querySelector(".banner")?.textContent?.trim() || "The timeline did not open." };
    },
    canvasButtons() {
      return {
        cut: buttons().some((item) => item.innerText.trim() === ${JSON.stringify(CUT_BUTTON)} && !item.disabled),
        styled: buttons().some((item) => item.innerText.trim() === ${JSON.stringify(STYLED_BUTTON)} && !item.disabled),
        cutLabel: buttons().find((item) => item.innerText.includes("Export"))?.innerText?.trim() || "",
      };
    },
    async saveVoice(dir, flickId) {
      if (flickId === ${JSON.stringify(PARKOUR_FLICK)}) throw new Error("Refusing the parkour flick.");
      if (/parkour fails test/i.test(dir)) throw new Error("Refusing the parkour channel.");
      const loaded = await window.flicks.readFlick(dir, flickId);
      if (!loaded.ok || !loaded.flick) throw new Error(loaded.message || "Could not read the flick.");
      loaded.flick.voiceRelative = "voice.mp3";
      loaded.flick.voiceStartSec = 0;
      for (const clip of loaded.flick.clips) {
        if (clip.trackId !== "track-top" || !clip.mediaId) continue;
        const media = (loaded.media || []).find((item) => item.id === clip.mediaId);
        const limit = media && media.durationSec > 0 ? media.durationSec : clip.outSec;
        clip.outSec = Math.min(clip.outSec, clip.inSec + 1.5, limit);
        if (clip.outSec < clip.inSec + 0.1) clip.outSec = Math.min(limit, clip.inSec + 0.1);
      }
      const saved = await window.flicks.saveFlick(dir, loaded.flick);
      if (!saved.ok) throw new Error(saved.message || "Could not save the voice.");
      return {
        width: loaded.flick.width,
        height: loaded.flick.height,
        clips: loaded.flick.clips.map((clip) => ({
          trackId: clip.trackId,
          mediaId: clip.mediaId,
          inSec: clip.inSec,
          outSec: clip.outSec,
          line: clip.line || "",
          label: clip.label || "",
        })),
        media: (loaded.media || []).map((item) => ({
          id: item.id,
          name: item.name,
          durationSec: item.durationSec,
          width: item.width,
          height: item.height,
        })),
      };
    },
    async playFor(caption) {
      const play = buttons().find((item) => item.classList.contains("lane-play"));
      if (!play) return { ok: false, detail: "Play is not on the timeline." };
      play.click();
      await sleep(700);
      const label = play.innerText.trim();
      const frame = document.querySelector(".frame-wrap");
      const words = frame ? deepText(frame) : "";
      if (label === "Pause") play.click();
      return { ok: label === "Pause" && words.includes(caption), label, words: words.slice(0, 240), caption };
    },
    async invokeExport(label, outputPath, kind) {
      const button = buttons().find((item) => item.innerText.trim() === label);
      if (!button) return { ok: false, banner: label + " is not on screen." };
      if (button.disabled) return { ok: false, banner: label + " is disabled." };
      const state = routeHook() && routeHook().memoizedState;
      if (!state || !state.dir || !state.flickId) return { ok: false, banner: "The timeline is not open." };
      const result = kind === "styled"
        ? await window.flicks.exportStyled(state.dir, state.flickId, outputPath)
        : await window.flicks.exportCut(state.dir, state.flickId, outputPath);
      const banner = (result && (result.outputPath || result.message)) || "Export returned nothing.";
      return { ok: Boolean(result && result.ok), banner };
    },
    async findSubject(subject) {
      const before = slotRows();
      const field = document.querySelector('input[placeholder="Name a subject"]');
      if (!field) return { ok: false, detail: "Subject field is missing.", before, after: before };
      fill(field, subject);
      await sleep(50);
      const button = buttons().find((item) => item.innerText.trim() === "Find clips" && !item.disabled);
      if (!button) return { ok: false, detail: "Find clips is not available.", before, after: before };
      button.click();
      const banner = await waitIdle(12 * 60 * 1000, "");
      return { ok: true, banner, before, after: slotRows() };
    },
    async chats() {
      const rows = await window.flicks.connections();
      return rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, connected: row.connected, model: row.model || "" }));
    },
    async askWhich(name) {
      const select = document.querySelector(".which-clip select");
      if (select) {
        const option = [...select.options].find((item) => item.textContent.trim() === name);
        if (!option) return { ok: false, detail: name + " is not in Ask with." };
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setter.call(select, option.value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(100);
      }
      const asks = document.querySelector(".which-clip .tiny")?.textContent?.trim() || "";
      const button = buttons().find((item) => item.innerText.trim() === "Ask which clip" && !item.disabled);
      if (!button) return { ok: false, detail: asks || "Ask which clip is not available.", asks };
      button.click();
      const start = Date.now();
      while (Date.now() - start < 3 * 60 * 1000) {
        const asking = /Asking which clip/.test(document.body.innerText);
        const words = [...document.querySelectorAll(".which-words")].map((node) => node.textContent.trim()).filter(Boolean);
        const hook = document.querySelector(".which-strong")?.textContent?.trim() || "";
        if (!asking && words.some((line) => !line.startsWith("Asking"))) {
          return { ok: true, asks, words, hook, slots: slotRows() };
        }
        await sleep(500);
      }
      return { ok: false, detail: "Which clip timed out.", asks, words: [], hook: "", slots: slotRows() };
    },
    async testVoiceRow() {
      const row = [...document.querySelectorAll(".conn-row")].find((item) => /ElevenLabs|MiniMax/.test(item.innerText));
      if (!row) return { ok: false, detail: "ElevenLabs and MiniMax are not on Connections." };
      const button = [...row.querySelectorAll("button")].find((item) => item.textContent.trim() === "Test");
      if (!button) return { ok: false, detail: "Test is not on the voice row." };
      const who = row.querySelector("strong")?.textContent?.trim() || "voice";
      button.click();
      const start = Date.now();
      while (Date.now() - start < 60000) {
        const banner = document.querySelector(".banner.start-note")?.textContent?.trim() || "";
        if (banner && !button.disabled) return { ok: true, detail: who + ": " + banner };
        await sleep(300);
      }
      const banner = document.querySelector(".banner.start-note")?.textContent?.trim() || "";
      return { ok: Boolean(banner), detail: banner || "Test did not leave a note." };
    },
    hearVoice() {
      const rows = [...document.querySelectorAll(".conn-row")].map((row) => ({
        eleven: /ElevenLabs/.test(row.innerText),
        minimax: /MiniMax/.test(row.innerText),
        hear: [...row.querySelectorAll("button")].some((button) => button.textContent.trim() === "Hear voice"),
      }));
      return {
        eleven: rows.some((row) => row.eleven && row.hear),
        minimax: rows.some((row) => row.minimax && row.hear),
      };
    },
  };
  function deepText(node) {
    let out = "";
    const visit = (current) => {
      if (!current) return;
      if (current.nodeType === 3) out += current.textContent || "";
      if (current.shadowRoot) visit(current.shadowRoot);
      if (current.tagName === "IFRAME" && current.contentDocument && current.contentDocument.body) visit(current.contentDocument.body);
      for (const child of current.childNodes || []) visit(child);
    };
    visit(node);
    return out;
  }
  return "ready";
})()
`;

async function connect(): Promise<Cdp> {
  const response = await fetch("http://127.0.0.1:9223/json/list");
  if (!response.ok) throw new Error(`Debugger list returned ${response.status}.`);
  const pages = (await response.json()) as { type?: string; url?: string; webSocketDebuggerUrl?: string }[];
  const page = pages.find((item) => item.type === "page" && item.url?.includes("5173")) ?? pages.find((item) => item.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("No page is open on 127.0.0.1:9223.");
  return Cdp.open(page.webSocketDebuggerUrl);
}

async function writeTone(ffmpeg: string, dest: string): Promise<void> {
  if (refusesKeeper(dest) || dest.toLowerCase().includes(PARKOUR_FLICK)) throw new Error("Refusing to write a keeper voice.");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.35", "-c:a", "libmp3lame", "-q:a", "9", dest], {
    windowsHide: true,
    timeout: 20_000,
  });
}

function safeExport(name: string): string {
  const file = path.resolve(CHANNEL, "exports", name);
  if (!file.toLowerCase().startsWith(path.resolve(CHANNEL).toLowerCase())) throw new Error("Export path left the test channel.");
  if (refusesKeeper(file)) throw new Error("Refusing to write a keeper export.");
  return file;
}

function pictureSpan(clips: { trackId: string; inSec: number; outSec: number }[]): number {
  return clips
    .filter((clip) => clip.trackId === "track-top")
    .reduce((sum, clip) => sum + Math.max(0, clip.outSec - clip.inSec), 0);
}

async function main() {
  const gtaOnly = process.argv.includes("--gta");
  console.log(gtaOnly ? "Go7Flicks GTA cut" : "Go7Flicks cut check");
  let cdp: Cdp | null = null;
  try {
    cdp = await connect();
    if (!gtaOnly) await cdp.evaluate(PAGE, 15_000);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The app is not on port 9223.";
    if (gtaOnly) {
      note("cuts", "GTA cut", false, detail);
      finishGta(1);
      return;
    }
    for (const id of ["ui", "cuts", "links", "ai", "delivery"] as const) {
      note(id, id, false, detail);
    }
    finish(1);
    return;
  }

  if (gtaOnly) {
    try {
      await runGta(cdp);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The GTA cut stopped.";
      note("cuts", "GTA cut", false, detail);
    } finally {
      cdp.release();
    }
    const failed = [...groups.links, ...groups.cuts, ...groups.ai].some((step) => !step.ok);
    finishGta(failed ? 1 : 0);
    return;
  }

  try {
    await runUi(cdp);
    await runCut(cdp);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The live check stopped.";
    console.log(`  fail runner — ${redact(detail).slice(0, 360)}`);
  } finally {
    cdp.release();
  }
  const failed = (Object.values(groups) as Step[][]).some((steps) => steps.some((step) => !step.ok));
  finish(failed ? 1 : 0);
}

async function runUi(cdp: Cdp) {
  const home = await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.goHome()");
  const homeText = home.ok ? await cdp.evaluate<string>("window.__go7Cut.text()") : "";
  const homeMissing = missingLabels(homeText, HOME_LABELS);
  note("ui", "Home", home.ok && homeMissing.length === 0, home.ok ? (homeMissing.length ? `missing ${homeMissing.join(", ")}` : "Video Ranking and Dual video are on Home") : home.detail);

  const rankingClick = home.ok ? await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.click('Video Ranking')") : { ok: false, detail: "Home did not open" };
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 400))");
  const rankingText = rankingClick.ok ? await cdp.evaluate<string>("window.__go7Cut.text()") : "";
  const rankingMissing = missingLabels(rankingText, RANKING_LABELS);
  note("ui", "Ranking desk", rankingClick.ok && rankingMissing.length === 0, rankingClick.ok ? (rankingMissing.length ? `missing ${rankingMissing.join(", ")}` : "Play ranking, This clip, Find clips, captions, and the play order are on screen") : rankingClick.detail);

  await cdp.evaluate("window.__go7Cut.goHome()");
  const dualClick = await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.click('Dual video')");
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 400))");
  const dualText = dualClick.ok ? await cdp.evaluate<string>("window.__go7Cut.text()") : "";
  const dualMissing = missingLabels(dualText, DUAL_LABELS);
  note("ui", "Dual desk", dualClick.ok && dualMissing.length === 0, dualClick.ok ? (dualMissing.length ? `missing ${dualMissing.join(", ")}` : "Face on top, Gameplay on top, Half, Face larger, and Gameplay larger are on screen") : dualClick.detail);

  await cdp.evaluate("window.__go7Cut.goHome()");
  const connections = await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.click('Connections')");
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 400))");
  const heard = connections.ok
    ? await cdp.evaluate<{ eleven: boolean; minimax: boolean }>("window.__go7Cut.hearVoice()")
    : { eleven: false, minimax: false };
  const hearDetail = [
    heard.eleven ? "ElevenLabs has Hear voice" : "ElevenLabs has no Hear voice",
    heard.minimax ? "MiniMax has Hear voice" : "MiniMax has no Hear voice",
  ].join(". ");
  note("ui", "Hear voice", connections.ok && heard.eleven && heard.minimax, connections.ok ? hearDetail : connections.detail);

  const tested = connections.ok
    ? await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.testVoiceRow()", 70_000)
    : { ok: false, detail: "Connections did not open" };
  note("ui", "Connections test", tested.ok, tested.detail);
}

async function runCut(cdp: Cdp) {
  const channel = await cdp.evaluate<{ ok: boolean; dir?: string; detail?: string }>("window.__go7Cut.ensureChannel()");
  if (!channel.ok || !channel.dir) {
    const detail = channel.detail || "Could not open the test channel.";
    note("links", "Two links", false, detail);
    note("cuts", "Timeline", false, detail);
    note("ai", "Find clips", false, detail);
    note("delivery", "Export", false, detail);
    return;
  }
  const dir = channel.dir;
  note("links", "Channel", true, dir);

  const opened = await cdp.evaluate<{ ok: boolean; detail: string }>(`window.__go7Cut.setRoute(${JSON.stringify({ name: "ranking", dir })})`);
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
  const hint = await cdp.evaluate<string>("window.__go7Cut.hint()");
  if (!opened.ok || !hint.includes("Go7 cut test")) {
    const detail = `${opened.detail}. Folder hint: ${hint || "none"}.`;
    note("links", "Two links", false, detail);
    note("cuts", "Timeline", false, detail);
    note("ai", "Find clips", false, detail);
    note("delivery", "Export", false, detail);
    return;
  }

  const landed: { file: string; caption: string; durationLine: string }[] = [];
  for (const [index, link] of SHORT_LINKS.entries()) {
    const prepared = await cdp.evaluate<{ ok: boolean; detail: string }>(
      `window.__go7Cut.prepareSlot(${index}, ${JSON.stringify(link.url)}, ${JSON.stringify(link.caption)})`,
    );
    if (!prepared.ok) {
      note("links", link.name, false, prepared.detail);
      continue;
    }
    const got = await cdp.evaluate<{ ok: boolean; banner: string; file: string; durationLine: string; caption: string }>(
      "window.__go7Cut.clickGet()",
      8 * 60 * 1000 + 15_000,
    );
    const detail = `${got.file || "no file"} ${got.durationLine || ""} ${got.banner || ""}`.trim();
    note("links", link.name, got.ok && captionIsNotFileName(got.caption, got.file), detail);
    if (got.ok) landed.push({ file: got.file, caption: got.caption, durationLine: got.durationLine });
    const trimmed = await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.setOut('00:01.50')");
    if (!trimmed.ok) note("cuts", `${link.name} out`, false, trimmed.detail);
  }

  if (landed.length < 2) {
    note("cuts", "Timeline", false, "Both links have to land before the short cut.");
    note("delivery", "Export", false, "No short cut to export.");
    await runScan(cdp, dir);
    return;
  }

  const timeline = await cdp.evaluate<{ ok: boolean; detail: string }>("window.__go7Cut.openTimeline()");
  if (!timeline.ok) {
    note("cuts", "Open timeline", false, timeline.detail);
    note("delivery", "Export", false, timeline.detail);
    await runScan(cdp, dir);
    return;
  }
  const route = await cdp.evaluate<{ name?: string; dir?: string; flickId?: string }>("window.__go7Cut.readRoute()");
  const buttons = await cdp.evaluate<{ cut: boolean; styled: boolean; cutLabel: string }>("window.__go7Cut.canvasButtons()");
  note("cuts", "Export buttons", buttons.cut && buttons.styled, `${CUT_BUTTON} ${buttons.cut ? "ready" : "missing"}. ${STYLED_BUTTON} ${buttons.styled ? "ready" : "missing"}.`);
  if (!route?.flickId || route.dir !== dir) {
    note("cuts", "Flick", false, "The timeline did not open the new flick.");
    note("delivery", "Export", false, "No flick id.");
    await runScan(cdp, dir);
    return;
  }

  const gpu = await probeGpu();
  if (!gpu.ffmpegPath) {
    note("cuts", "Voice", false, "ffmpeg is missing, so the short voice could not be written.");
  } else {
    const voicePath = path.join(dir, "flicks", route.flickId, "voice.mp3");
    try {
      await writeTone(gpu.ffmpegPath, voicePath);
      note("cuts", "Short voice", fs.statSync(voicePath).size > 400, voicePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not write the short voice.";
      note("cuts", "Short voice", false, detail);
    }
  }

  const saved = await cdp.evaluate<{
    width: number;
    height: number;
    clips: { trackId: string; mediaId: string | null; inSec: number; outSec: number; line: string }[];
    media: { id: string; name: string; durationSec: number; width: number; height: number }[];
  }>(`window.__go7Cut.saveVoice(${JSON.stringify(dir)}, ${JSON.stringify(route.flickId)})`);

  const top = saved.clips.filter((clip) => clip.trackId === "track-top" && clip.mediaId);
  const rangeOk = top.every((clip) => {
    const media = saved.media.find((item) => item.id === clip.mediaId);
    return media ? rangeInsideFile(clip, media.durationSec) : false;
  });
  const captionOk = top.every((clip) => {
    const media = saved.media.find((item) => item.id === clip.mediaId);
    return media ? captionIsNotFileName(clip.line, media.name) : false;
  });
  note("cuts", "In and out", rangeOk && saved.width === 1080 && saved.height === 1920, top.map((clip) => `${clip.inSec.toFixed(2)}-${clip.outSec.toFixed(2)}`).join(", ") || "no top clips");
  note("cuts", "Captions", captionOk, top.map((clip) => clip.line).join(" | ") || "no captions");

  const play = await cdp.evaluate<{ ok: boolean; label: string; words: string; caption: string }>(
    `window.__go7Cut.playFor(${JSON.stringify(SHORT_LINKS[0].caption)})`,
  );
  note("delivery", "Play", play.label === "Pause" || play.ok, play.label === "Pause" ? "Play started" : `Play button said ${play.label || "nothing"}`);
  note("delivery", "Caption", play.words.includes(SHORT_LINKS[0].caption), play.words ? `On the picture: ${play.words}` : "The caption was not on the picture.");

  const cutPath = safeExport(CUT_NAME);
  const styledPath = safeExport(STYLED_NAME);
  const cut = await cdp.evaluate<{ ok: boolean; banner: string }>(
    `window.__go7Cut.invokeExport(${JSON.stringify(CUT_BUTTON)}, ${JSON.stringify(cutPath)}, "cut")`,
    4 * 60 * 1000 + 15_000,
  );
  note("cuts", "Export cut", cut.ok, cut.banner);
  const styled = await cdp.evaluate<{ ok: boolean; banner: string }>(
    `window.__go7Cut.invokeExport(${JSON.stringify(STYLED_BUTTON)}, ${JSON.stringify(styledPath)}, "styled")`,
    12 * 60 * 1000 + 15_000,
  );
  note("cuts", "Export styled", styled.ok, styled.banner);

  if (cut.ok && gpu.ffmpegPath) {
    const info = await probeMedia(cutPath, gpu.ffmpegPath);
    const span = pictureSpan(saved.clips);
    const size = fs.statSync(cutPath).size;
    const lasts = info.durationSec > 1 && Math.abs(info.durationSec - span) < 0.6 && info.durationSec > 0.8;
    note(
      "cuts",
      "Picture length",
      info.width === 1080 && info.height === 1920 && lasts,
      `${info.width}x${info.height} ${info.durationSec.toFixed(2)}s, picture ${span.toFixed(2)}s, voice 0.35s, ${size} bytes, ${cutPath}`,
    );
    note("delivery", "Export file", size > 20_000, `${cutPath} ${size} bytes`);
  } else {
    note("cuts", "Picture length", false, cut.banner || "Export cut did not write a file.");
    note("delivery", "Export file", false, cut.banner || "No export file.");
  }

  await runScan(cdp, dir);
}

function slotOpen(name: string | undefined): boolean {
  return !name || name === "Empty slot" || name === "Add a clip" || name === "Choose a clip" || name === "Empty";
}

async function runScan(cdp: Cdp, dir: string) {
  const opened = await cdp.evaluate<{ ok: boolean; detail: string }>(`window.__go7Cut.setRoute(${JSON.stringify({ name: "ranking", dir })})`);
  await cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 500))");
  const hint = await cdp.evaluate<string>("window.__go7Cut.hint()");
  if (!opened.ok || !hint.includes("Go7 cut test")) {
    note("ai", "Find clips", false, `Could not open an empty ranking. ${hint || opened.detail}`);
    return;
  }
  const preview = await cdp.evaluate<{ name: string; time: string }[]>("window.__go7Cut.slots()");
  const filled = preview.slice(0, 3).filter((slot) => !slotOpen(slot.name)).length;
  const subject = filled >= 3 ? "gardening" : "funny dogs";
  const found = await cdp.evaluate<{
    ok: boolean;
    detail?: string;
    banner?: string;
    before: { name: string; time: string }[];
    after: { name: string; time: string }[];
  }>(`window.__go7Cut.findSubject(${JSON.stringify(subject)})`, 12 * 60 * 1000 + 15_000);
  if (!found.ok) {
    note("ai", "Find clips", false, found.detail || found.banner || "Find clips did not run.");
    return;
  }
  const placed = found.after.filter((slot, index) => !slotOpen(slot.name) && slotOpen(found.before[index]?.name));
  const kept = found.before.every((slot, index) => slotOpen(slot.name) || found.after[index]?.name === slot.name);
  const about = placed.filter((slot) => titleAboutSubject(slot.name, subject) && !skipSubjectTitle(slot.name, subject));
  const timed = placed.filter((slot) => /File\s+[0-9]/.test(slot.time));
  const ok = kept && placed.length > 0 && about.length === placed.length && timed.length === placed.length && !/could not|not a video|no video/i.test(found.banner || "");
  note(
    "ai",
    "Find clips",
    ok,
    `${subject}. ${found.banner || ""} Placed: ${placed.map((slot) => slot.name).join(" | ") || "none"}`,
  );

  const chats = await cdp.evaluate<{ id: string; kind: string; name: string; connected: boolean; model: string }[]>("window.__go7Cut.chats()");
  const cursor = chats.find((row) => row.kind === "cursor" && row.connected);
  const codex = chats.find((row) => row.kind === "codex" && row.connected && (row.model.trim() === "" || row.model.trim() === "gpt-6.1-terra"));
  const chosen = cursor || codex;
  if (!chosen) {
    const models = chats.filter((row) => row.kind === "cursor" || row.kind === "codex").map((row) => `${row.kind} ${row.connected ? row.model || "no model" : "not connected"}`);
    note("ai", "Which clip", false, models.join("; ") || "No Cursor or Codex Terra row is connected.");
    return;
  }
  const asked = await cdp.evaluate<{
    ok: boolean;
    detail?: string;
    asks?: string;
    words?: string[];
    hook?: string;
    slots?: { name: string }[];
  }>(`window.__go7Cut.askWhich(${JSON.stringify(chosen.name)})`, 3 * 60 * 1000 + 15_000);
  const reply = (asked.words || []).filter((line) => !line.startsWith("Asking")).join("\n");
  const names = (asked.slots || []).map((slot) => slot.name).filter((name) => !slotOpen(name));
  const ids = names.map((_, index) => `c${index + 1}`);
  if (!asked.ok || !reply) {
    note("ai", "Which clip", false, `${chosen.kind}. ${asked.detail || asked.asks || "No reply."}`);
    return;
  }
  const verdict = whichClipVerdict(reply, ids, names);
  const hookOk = !asked.hook || names.some((name) => asked.hook?.includes(name));
  note(
    "ai",
    "Which clip",
    verdict.ok && hookOk,
    `${chosen.kind}${chosen.model ? " " + chosen.model : ""}. ${verdict.detail}. ${asked.hook || reply.slice(0, 180)}`,
  );
}

const KEEPER_PATHS = [
  String.raw`D:\GitHub\Parkour fails test\exports\Walk check.mp4`,
  String.raw`D:\GitHub\Parkour fails test\exports\parkour-fails-short-cut-prove.mp4`,
  String.raw`D:\GitHub\Parkour fails test\exports\parkour-fails-short-styled-prove.mp4`,
  String.raw`D:\GitHub\Parkour fails test\exports\Voice overlay check.mp4`,
  path.join(String.raw`D:\GitHub\Parkour fails test\flicks`, PARKOUR_FLICK, "voice.mp3"),
];

type GtaClip = {
  mediaId: string;
  mediaName: string;
  title: string;
  durationSec: number;
  sourceUrl: string;
  inSec: number;
  outSec: number;
  line: string;
};

function keeperSnap(): Record<string, number | null> {
  const snap: Record<string, number | null> = {};
  for (const file of KEEPER_PATHS) snap[file] = fs.existsSync(file) ? fs.statSync(file).size : null;
  return snap;
}

function keepersHeld(before: Record<string, number | null>): { ok: boolean; detail: string } {
  const changed: string[] = [];
  for (const [file, size] of Object.entries(before)) {
    const now = fs.existsSync(file) ? fs.statSync(file).size : null;
    if (now !== size) changed.push(`${path.basename(file)} ${size ?? "missing"} -> ${now ?? "missing"}`);
  }
  const voice = KEEPER_PATHS[KEEPER_PATHS.length - 1];
  const voiceSize = fs.existsSync(voice) ? fs.statSync(voice).size : null;
  if (before[voice] === 21300 && voiceSize !== 21300) changed.push("parkour voice.mp3 is no longer 21300 bytes");
  return { ok: changed.length === 0, detail: changed.join("; ") || "Keeper files were left alone." };
}

function searchToolFailed(message: string): boolean {
  return /yt-dlp|youtube-dl|timed out|ENOTFOUND|ECONN|getaddrinfo|EAI_AGAIN|sign in to confirm|unable to download|ffmpeg is not available|certificate|network/i.test(
    message,
  );
}

function captionsFromReply(reply: string, count: number): string[] {
  return reply
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[.)\s:-]+/, "").trim())
    .filter((line) => line && !/^strongest:|^why:|^headline:|^title\s+c\d/i.test(line))
    .slice(0, count);
}

async function runGta(cdp: Cdp) {
  const before = keeperSnap();
  const draftKeyHeld = async (dir: string) => {
    const key = `go7-flicks-desk:${dir}:ranking`;
    return cdp.evaluate<number>(`(() => { const raw = sessionStorage.getItem(${JSON.stringify(key)}); return raw ? raw.length : 0; })()`);
  };

  const channel = await cdp.evaluate<{ ok: boolean; dir?: string; message?: string }>(
    `(async () => {
      const opened = await window.flicks.openChannel(${JSON.stringify(CHANNEL)});
      if (opened && opened.ok && opened.dir) return { ok: true, dir: opened.dir };
      const created = await window.flicks.createChannel(${JSON.stringify(PARENT)}, "Go7 cut test");
      if (!created || !created.ok || !created.dir) return { ok: false, message: (created && created.message) || "Could not open the test channel." };
      return { ok: true, dir: created.dir };
    })()`,
    60_000,
  );
  if (!channel.ok || !channel.dir) {
    note("links", "Channel", false, channel.message || "Could not open Go7 cut test.");
    note("cuts", "GTA export", false, "No channel.");
    note("cuts", "Keepers", keepersHeld(before).ok, keepersHeld(before).detail);
    return;
  }
  if (/parkour fails test/i.test(channel.dir)) {
    note("links", "Channel", false, "Refusing the parkour channel.");
    note("cuts", "GTA export", false, "Refusing the parkour channel.");
    return;
  }
  const dir = channel.dir;
  note("links", "Channel", true, dir);
  const draftBefore = await draftKeyHeld(dir);

  const found = await cdp.evaluate<{
    ok: boolean;
    message?: string;
    clips?: Array<{
      mediaId: string;
      mediaName: string;
      title: string;
      durationSec: number;
      sourceUrl: string;
      inSec?: number;
      outSec?: number;
    }>;
  }>(`window.flicks.findClips(${JSON.stringify(dir)}, ${JSON.stringify(GTA_SUBJECT)}, 2)`, 12 * 60 * 1000);

  let clips: GtaClip[] = [];
  const foundMessage = redact(found.message || "");
  if (!found.ok) {
    note("links", "Find clips", false, foundMessage || "Find clips returned nothing.");
    if (searchToolFailed(foundMessage)) {
      note("cuts", "GTA export", false, foundMessage);
      const held = keepersHeld(before);
      note("cuts", "Keepers", held.ok, held.detail);
      return;
    }
  } else {
    const rows = found.clips ?? [];
    const good = rows.filter((clip) => gameplayClipOk(clip.title || clip.mediaName, clip.durationSec));
    if (good.length) {
      clips = good.slice(0, 2).map((clip) => {
        const range = fewSecondsAround(clip.inSec ?? 0, clip.outSec ?? 4, clip.durationSec);
        return {
          mediaId: clip.mediaId,
          mediaName: clip.mediaName,
          title: clip.title || clip.mediaName,
          durationSec: clip.durationSec,
          sourceUrl: clip.sourceUrl,
          inSec: range.inSec,
          outSec: range.outSec,
          line: slotListTitle(clip.title || "", clip.mediaName),
        };
      });
      note("links", "Find clips", true, `${foundMessage} ${clips.map((clip) => `${clip.title} ${clip.durationSec.toFixed(1)}s`).join(" | ")}`.trim());
    } else {
      const listed = rows.map((clip) => `${clip.title || clip.mediaName} ${clip.durationSec}s`).join(" | ") || "none";
      note("links", "Find clips", false, `No short gameplay clip. ${foundMessage} Returned: ${listed}`.trim());
    }
  }

  if (!clips.length && !searchToolFailed(foundMessage)) {
    const landed: string[] = [];
    const errors: string[] = [];
    for (const url of GTA_FALLBACK_LINKS) {
      const got = await cdp.evaluate<{
        ok: boolean;
        message?: string;
        asset?: { id: string; name: string; durationSec: number };
        sourceUrl?: string;
      }>(`window.flicks.downloadMedia(${JSON.stringify(dir)}, ${JSON.stringify(url)})`, 8 * 60 * 1000);
      if (!got.ok || !got.asset) {
        errors.push(redact(got.message || `Could not get ${url}`));
        continue;
      }
      const title = got.asset.name;
      if (got.asset.durationSec < 2 || got.asset.durationSec > 90) {
        errors.push(`${title} is ${got.asset.durationSec}s.`);
        continue;
      }
      const off =
        /\b(trailers?|teasers?|news|compilations?|montage|official|cinematic|reveal)\b/i.test(title) ||
        skipSubjectTitle(title, GTA_SUBJECT);
      const namesGameplay = gameplayClipOk(title, got.asset.durationSec) || (/\bgta\b/i.test(title) && !off);
      if (!namesGameplay) {
        errors.push(`${title} ${got.asset.durationSec}s was not a short gameplay clip.`);
        continue;
      }
      const range = fewSecondsAround(0, Math.min(4, got.asset.durationSec), got.asset.durationSec);
      clips.push({
        mediaId: got.asset.id,
        mediaName: got.asset.name,
        title,
        durationSec: got.asset.durationSec,
        sourceUrl: got.sourceUrl || url,
        inSec: range.inSec,
        outSec: range.outSec,
        line: slotListTitle("", got.asset.name),
      });
      landed.push(`${title} ${got.asset.durationSec.toFixed(1)}s`);
      if (clips.length >= 2) break;
    }
    note("links", "Short links", clips.length > 0, clips.length ? landed.join(" | ") : errors.join(" | ") || "No short link arrived.");
  }

  if (!clips.length) {
    if (!groups.cuts.some((step) => step.name === "GTA export")) note("cuts", "GTA export", false, "No short gameplay clip arrived.");
    const held = keepersHeld(before);
    note("cuts", "Keepers", held.ok, held.detail);
    const draftAfter = await draftKeyHeld(dir);
    note("links", "Funny dogs draft", draftBefore === draftAfter, draftBefore === draftAfter ? "The ranking draft was left in place." : "The ranking draft changed.");
    return;
  }

  const chats = await cdp.evaluate<{ id: string; kind: string; name: string; connected: boolean; model: string }[]>(
    `window.flicks.connections().then((rows) => rows.map((row) => ({ id: row.id, kind: row.kind, name: row.name, connected: row.connected, model: row.model || "" })))`,
  );
  const blocked = (model: string) => /gpt-6\.2|\bsol\b/i.test(model);
  const cursor = chats.find((row) => row.kind === "cursor" && row.connected && !blocked(row.model));
  const codex = chats.find((row) => row.kind === "codex" && row.connected && row.model.trim() === "gpt-6.1-terra");
  const chosen = cursor || codex;
  if (!chosen) {
    const models = chats
      .filter((row) => row.kind === "cursor" || row.kind === "codex")
      .map((row) => `${row.kind} ${row.connected ? row.model || "no model" : "not connected"}`);
    note("ai", "Titles", true, `No allowed title call. ${models.join("; ") || "No Cursor or Codex row."} Kept the short titles.`);
  } else {
    const prompt = [
      "Write one short caption for each clip already listed. Six words or fewer.",
      "Do not browse. Do not suggest a download. Do not use ids.",
      ...clips.map((clip, index) => `${index + 1}. ${clip.title}`),
      "Reply with one caption per line, in the same order.",
    ].join("\n");
    const asked = await cdp.evaluate<{ ok: boolean; text?: string; message?: string }>(
      `window.flicks.askAssistant(${JSON.stringify(chosen.id)}, ${JSON.stringify(prompt)}).then((result) => ({ ok: Boolean(result && result.ok), text: (result && (result.text || result.message)) || "", message: (result && result.message) || "" }))`,
      3 * 60 * 1000,
    );
    const reply = redact(asked.text || asked.message || "");
    const lines = asked.ok ? captionsFromReply(reply, clips.length) : [];
    if (!asked.ok || lines.length === 0) {
      note("ai", "Titles", false, `${chosen.kind}${chosen.model ? " " + chosen.model : ""}. ${reply || "No caption came back."}`);
    } else {
      clips = clips.map((clip, index) => ({ ...clip, line: slotListTitle(lines[index] || clip.line, clip.mediaName) || clip.line }));
      note("ai", "Titles", true, `${chosen.kind}${chosen.model ? " " + chosen.model : ""}. ${clips.map((clip) => clip.line).join(" | ")}`);
    }
  }

  const outputPath = safeExport(GTA_EXPORT_NAME);
  const job = {
    dir,
    outputPath,
    clips: clips.map((clip) => ({
      mediaId: clip.mediaId,
      inSec: clip.inSec,
      outSec: clip.outSec,
      line: clip.line,
      sourceUrl: clip.sourceUrl,
    })),
  };
  const saved = await cdp.evaluate<{ ok: boolean; message?: string; flickId?: string }>(
    `(async () => {
      const job = ${JSON.stringify(job)};
      if (/parkour fails test/i.test(job.dir) || /parkour fails test/i.test(job.outputPath)) return { ok: false, message: "Refusing a parkour path." };
      const created = await window.flicks.createFlick(job.dir, "GTA gameplay fails", "builtin-ranking");
      if (!created || !created.ok || !created.flick) return { ok: false, message: (created && created.message) || "Could not create the flick." };
      const flick = created.flick;
      const rank = flick.regions.find((region) => region.trackId === "track-top") || flick.regions[0];
      if (rank) {
        flick.regions = flick.regions.map((region) => region.id === rank.id
          ? Object.assign({}, region, { x: 0, y: 0, width: 1, height: 1, hidden: false })
          : Object.assign({}, region, { hidden: true }));
      }
      let cursor = 0;
      const top = job.clips.map((clip, index) => {
        const span = Math.max(0.4, Number(clip.outSec) - Number(clip.inSec));
        const next = {
          id: (crypto.randomUUID && crypto.randomUUID()) || ("gta-" + index),
          mediaId: clip.mediaId,
          trackId: "track-top",
          startSec: Math.round(cursor * 1000) / 1000,
          inSec: clip.inSec,
          outSec: clip.outSec,
          label: "#" + (job.clips.length - index),
          line: clip.line || undefined,
          sourceUrl: clip.sourceUrl || undefined,
        };
        cursor += span;
        return next;
      });
      const loop = flick.clips.filter((clip) => clip.trackId !== "track-top").map((clip) => Object.assign({}, clip, { mediaId: null }));
      flick.name = "GTA gameplay fails";
      flick.headline = "GTA gameplay fails";
      flick.width = 1080;
      flick.height = 1920;
      flick.showCaptions = true;
      flick.showRank = true;
      flick.voiceRelative = undefined;
      flick.voiceStartSec = undefined;
      flick.clips = top.concat(loop);
      const stored = await window.flicks.saveFlick(job.dir, flick);
      if (!stored || !stored.ok || !stored.flick) return { ok: false, message: (stored && stored.message) || "Could not save the flick." };
      const exported = await window.flicks.exportCut(job.dir, stored.flick.id, job.outputPath);
      return { ok: Boolean(exported && exported.ok), message: (exported && (exported.outputPath || exported.message)) || "Export returned nothing.", flickId: stored.flick.id };
    })()`,
    8 * 60 * 1000,
  );
  note("cuts", "GTA export", saved.ok, redact(saved.message || "Export returned nothing."));
  if (saved.ok) {
    const gpu = await probeGpu();
    if (!gpu.ffmpegPath || !fs.existsSync(outputPath)) {
      note("cuts", "GTA file", false, saved.message || outputPath);
    } else {
      const info = await probeMedia(outputPath, gpu.ffmpegPath);
      const size = fs.statSync(outputPath).size;
      const span = job.clips.reduce((sum, clip) => sum + Math.max(0, clip.outSec - clip.inSec), 0);
      const frameOk = info.width === 1080 && info.height === 1920 && info.durationSec > 0.8 && info.durationSec < 20;
      note(
        "cuts",
        "GTA file",
        frameOk && size > 20_000,
        `${info.width}x${info.height} ${info.durationSec.toFixed(2)}s, picture ${span.toFixed(2)}s, ${size} bytes, ${outputPath}`,
      );
    }
  }
  const held = keepersHeld(before);
  note("cuts", "Keepers", held.ok, held.detail);
  const draftAfter = await draftKeyHeld(dir);
  note("links", "Funny dogs draft", draftBefore === draftAfter, draftBefore === draftAfter ? "The ranking draft was left in place." : "The ranking draft changed.");
}

function finishGta(code: number) {
  console.log("");
  for (const step of [...groups.links, ...groups.ai, ...groups.cuts]) {
    console.log(`${step.ok ? "PASS" : "FAIL"} gta ${step.name} — ${step.detail}`);
  }
  const clipOk = groups.links.some((step) => (step.name === "Find clips" || step.name === "Short links") && step.ok);
  const exportOk = groups.cuts.some((step) => step.name === "GTA file" && step.ok);
  const keepersOk = groups.cuts.some((step) => step.name === "Keepers" && step.ok);
  const passed = clipOk && exportOk && keepersOk;
  console.log(passed ? "GTA cut passed." : "GTA cut failed.");
  process.exit(passed ? 0 : code || 1);
}

function finish(code: number) {
  console.log("");
  const order = [
    ["ui", "UI"],
    ["links", "Links"],
    ["cuts", "Cuts"],
    ["ai", "AI scan"],
    ["delivery", "Delivery"],
  ] as const;
  let failed = 0;
  for (const [id, name] of order) {
    const steps = groups[id];
    const ok = steps.length > 0 && steps.every((step) => step.ok);
    if (!ok) failed += 1;
    const detail = steps.map((step) => `${step.ok ? "pass" : "fail"} ${step.name}: ${step.detail}`).join(" | ") || "not run";
    const check: Check = { id, name, ok, detail };
    console.log(checkLine(check));
  }
  console.log(failed ? `${failed} check(s) failed.` : "All five checks passed.");
  process.exit(code);
}

await main();
