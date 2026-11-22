import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlicksApi } from "../src/shared/api";
import { boot } from "../src/mobile/boot";
import { phoneStoreKind } from "../src/mobile/disk";

type Host = {
  flicks?: FlicksApi;
  document: {
    documentElement: { dataset: { go7Host?: string } };
  };
};

test("phone host leaves Electron in place and stores a flick in memory", async () => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env) env.GO7_PHONE_DISK = "memory";

  const dataset: { go7Host?: string } = {};
  const page: Host = { document: { documentElement: { dataset } } };
  (globalThis as { window?: Host }).window = page;

  const electron = {
    gpu: async () => ({ chosen: "desktop" }),
  } as unknown as FlicksApi;
  page.flicks = electron;
  await boot();
  assert.equal(page.flicks, electron);
  assert.equal(dataset.go7Host, undefined);

  page.flicks = undefined;
  await boot();
  const api = page.flicks as FlicksApi | undefined;
  assert.ok(api);
  assert.notEqual(api, electron);
  assert.equal(dataset.go7Host, "mobile");
  assert.equal(typeof api.createChannel, "function");
  assert.equal(typeof api.exportCut, "function");

  const created = await api.createChannel("phone-parent", "Round Trip");
  assert.equal(created.ok, true);
  assert.equal(typeof created.dir, "string");
  assert.ok(created.dir);
  const made = await api.createFlick(created.dir, "One", "builtin-blank");
  assert.equal(made.ok, true);
  assert.ok(made.flick);
  const saved = await api.saveFlick(created.dir, { ...made.flick, name: "Renamed", headline: "Hello" });
  assert.equal(saved.ok, true);
  assert.equal(saved.flick?.name, "Renamed");
  const read = await api.readFlick(created.dir, made.flick.id);
  assert.equal(read.ok, true);
  assert.equal(read.flick?.name, "Renamed");
  assert.equal(read.flick?.headline, "Hello");
  assert.equal(read.flick?.id, made.flick.id);
  assert.equal(await phoneStoreKind(), "memory");

  const cut = await api.exportCut(created.dir, made.flick.id, "out.mp4");
  assert.equal(cut.ok, false);
  assert.equal(cut.message, "Use the computer app for that.");
  const download = await api.downloadMedia(created.dir, "https://example.com/clip");
  assert.equal(download.ok, false);
  assert.equal(download.message, "Use the computer app for that.");
});
