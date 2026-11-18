import assert from "node:assert/strict";
import test from "node:test";
import { connectionNote, presentStatus } from "../src/shared/connection-note";

test("a connection row drops the stdin warning and says the login failed", () => {
  const raw = [
    "Warning: no stdin data received in 3s, proceeding without it",
    "Failed to authenticate. API Error: 401 OAuth access token has expired.",
  ].join("\n");
  assert.equal(presentStatus(raw), "Failed to authenticate. API Error: 401 OAuth access token has expired.");
  assert.equal(
    connectionNote("claude", raw),
    "Claude is not signed in. The saved login has expired. Paste an API key, or sign in with the Claude program.",
  );
});

test("a clean connection note stays as it is", () => {
  assert.equal(connectionNote("codex", "Not tested yet."), "Not tested yet.");
  assert.equal(connectionNote("claude", ""), "");
});

test("a cursor trace path does not sit on the reply", () => {
  const raw = "STRONGEST: c1\ncursor-retrieval: tracing to 'C:\\\\Temp\\\\cursor_retrieval.log'";
  assert.equal(presentStatus(raw), "STRONGEST: c1");
});
