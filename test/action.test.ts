import assert from "node:assert/strict";
import test from "node:test";
import { failureLine, frameSeek } from "../electron/action";
import { actionWindow, impactMoments, snapMoment } from "../src/shared/action";
import { subscriptionRefusal } from "../src/shared/model";

test("a frame grab stays off the last frame and the log stays one line", () => {
  assert.ok(frameSeek(16, 16.04) < 16);
  assert.equal(frameSeek(2.5, 18), 2.5);
  const dump = ["ffmpeg version 8.1.1", "built with gcc", "configuration: --enable-gpl", "Conversion failed!", "Invalid argument"].join("\n");
  const line = failureLine(new Error(dump));
  assert.equal(line, "Invalid argument");
  const refused = failureLine(
    new Error(
      'The call failed. {\n  "error": "dial tcp 127.0.0.1:56787: connectex: No connection could be made because the target machine actively refused it."\n}',
    ),
  );
  assert.equal(refused, "The call could not connect.");
  assert.equal(/gemini|antigravity/i.test(refused), false);
});

test("the gemini api stays open and the subscription stays closed", () => {
  assert.equal(subscriptionRefusal("https://api.x.ai/v1", "grok-4.7"), null);
  assert.equal(subscriptionRefusal("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.5-flash"), null);
  assert.equal(subscriptionRefusal("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.8-flash"), null);
  assert.match(subscriptionRefusal("https://cloudcode-pa.googleapis.com", "gemini-3.8-flash") ?? "", /subscription or Antigravity/);
  assert.match(subscriptionRefusal("https://gemini.google.com", "gemini-2.5-flash") ?? "", /subscription/);
  assert.match(subscriptionRefusal("http://127.0.0.1:1", "antigravity") ?? "", /Antigravity/);
});

test("the action window starts on the moment, not the wind-up", () => {
  const range = actionWindow(8.4, 19.68);
  assert.equal(range.inSec, 8.4);
  assert.ok(range.outSec > 8.4);
  assert.ok(range.outSec - range.inSec <= 4.01);
  assert.ok(range.outSec <= 19.68);
});

test("impacts are the loud later moments", () => {
  const levels = [
    { sec: 0.2, db: -12 },
    { sec: 1.5, db: -40 },
    { sec: 6.5, db: -18 },
    { sec: 7, db: -10 },
    { sec: 7.5, db: -22 },
    { sec: 14, db: -11 },
  ];
  const moments = impactMoments(levels, [7.1, 14.2], 19);
  assert.ok(moments.every((sec) => sec >= 0.8));
  assert.ok(moments.some((sec) => Math.abs(sec - 7) < 1.3));
  assert.equal(snapMoment(7.2, moments), moments.find((sec) => Math.abs(sec - 7) < 1.3));
  assert.equal(snapMoment(0.1, moments), null);
});
