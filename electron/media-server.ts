import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ChannelFile } from "../src/shared/model";

export type MediaGate = {
  channelDir: string | null;
  channel: ChannelFile | null;
  stagingDir?: string | null;
};

export function startMediaServer(gate: MediaGate): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/file") {
      res.writeHead(404);
      res.end();
      return;
    }
    const filePath = url.searchParams.get("path");
    if (!filePath || !allowed(gate, filePath)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const resolved = path.resolve(filePath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!stat.isFile()) {
      res.writeHead(403);
      res.end();
      return;
    }
    const type = mime(resolved);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
        "Content-Type": type,
      });
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Length": stat.size, "Content-Type": type });
    fs.createReadStream(resolved).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function allowed(gate: MediaGate, filePath: string): boolean {
  if (!gate.channelDir || !gate.channel) return false;
  const resolved = path.resolve(filePath);
  if (inside(gate.channelDir, resolved)) return true;
  if (gate.stagingDir && inside(gate.stagingDir, resolved)) return true;
  return gate.channel.media.some((item) => item.absolutePath && path.resolve(item.absolutePath) === resolved);
}

function inside(root: string, resolved: string): boolean {
  const relative = path.relative(path.resolve(root), resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}
