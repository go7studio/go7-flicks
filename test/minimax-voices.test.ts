import assert from "node:assert/strict";
import test from "node:test";
import { readMiniMaxVoices } from "../electron/providers";

test("a MiniMax voice list is a speech check and not a chat reply", () => {
  const result = readMiniMaxVoices(
    {
      system_voice: [
        { voice_id: "English_expressive_narrator", voice_name: "Expressive narrator" },
        { voice_id: "English_Graceful_Lady", voice_name: "Graceful lady" },
      ],
      base_resp: { status_code: 0, status_msg: "success" },
    },
    "English_expressive_narrator",
  );
  assert.equal(result.ok, true);
  assert.equal(result.message, "Found 2 voices.");
  assert.equal(result.voiceId, "English_expressive_narrator");
  assert.equal(result.voices?.[1].name, "Graceful lady");
});

test("a MiniMax voice check keeps the provider error code", () => {
  const result = readMiniMaxVoices(
    { base_resp: { status_code: 1008, status_msg: "insufficient balance" } },
    "",
  );
  assert.equal(result.ok, false);
  assert.equal(result.message, "insufficient balance (1008)");
});
