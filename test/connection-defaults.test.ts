import assert from "node:assert/strict";
import test from "node:test";
import { defaultsFor } from "../src/shared/model";

test("a new Codex row starts on gpt-6.1-terra", () => {
  assert.equal(defaultsFor("codex").model, "gpt-6.1-terra");
});

test("a new MiniMax row starts on the speech host and the speech model", () => {
  const minimax = defaultsFor("minimax");
  assert.equal(minimax.baseUrl, "https://api.minimax.io/v1");
  assert.equal(minimax.model, "speech-02-turbo");
});
