import assert from "node:assert/strict";
import test from "node:test";
import { clipLink } from "../src/shared/link";

test("a pasted link is kept, whatever the host", () => {
  assert.equal(clipLink("https://www.tiktok.com/@example/video/1"), "https://www.tiktok.com/@example/video/1");
  assert.equal(clipLink("  http://youtu.be/abc  "), "http://youtu.be/abc");
  assert.equal(clipLink("youtube.com/shorts/abc"), "https://youtube.com/shorts/abc");
  assert.equal(clipLink("www.instagram.com/reel/xyz"), "https://www.instagram.com/reel/xyz");
});

test("an empty field is not a link", () => {
  assert.throws(() => clipLink("   "), /Paste a link/);
  assert.throws(() => clipLink("just a note"), /Paste a link/);
});
