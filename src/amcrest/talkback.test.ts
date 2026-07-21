import assert from "node:assert/strict";
import { test } from "node:test";

import { selectTalkbackTarget } from "./talkback.js";

test("amcrest doorbell defaults to AAC", () => {
  assert.deepEqual(selectTalkbackTarget("AD410"), {
    codec: "aac",
    contentType: "Audio/AAC",
    sampleRate: 16000,
  });
});

test("unknown device defaults to AAC", () => {
  assert.deepEqual(selectTalkbackTarget(undefined), {
    codec: "aac",
    contentType: "Audio/AAC",
    sampleRate: 16000,
  });
});

test("dahua device uses G.711A", () => {
  assert.deepEqual(selectTalkbackTarget("DH-VTO2211"), {
    codec: "pcm_alaw",
    contentType: "Audio/G.711A",
    sampleRate: 8000,
  });
});

test("plain VTO intercom (no DH- prefix) uses G.711A", () => {
  assert.deepEqual(selectTalkbackTarget("VTO2211"), {
    codec: "pcm_alaw",
    contentType: "Audio/G.711A",
    sampleRate: 8000,
  });
});
