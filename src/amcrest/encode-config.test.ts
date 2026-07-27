import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEncodeConfig } from "./encode-config.js";

const SAMPLE = `table.Encode[0].MainFormat[0].VideoEnable=true
table.Encode[0].MainFormat[0].Video.Compression=H.264
table.Encode[0].MainFormat[0].Video.Width=1920
table.Encode[0].MainFormat[0].Video.Height=1080
table.Encode[0].ExtraFormat[0].VideoEnable=true
table.Encode[0].ExtraFormat[0].Video.Compression=H.265
table.Encode[0].ExtraFormat[0].Video.Width=704
table.Encode[0].ExtraFormat[0].Video.Height=480`;

/**
 * Layout reported by a live camera: four main profiles (all the same stream,
 * different triggers) and three extra slots, two of them disabled.
 */
const LIVE = `table.Encode[0].MainFormat[0].VideoEnable=true
table.Encode[0].MainFormat[0].Video.Compression=H.264
table.Encode[0].MainFormat[0].Video.Width=2560
table.Encode[0].MainFormat[0].Video.Height=1440
table.Encode[0].MainFormat[1].VideoEnable=true
table.Encode[0].MainFormat[1].Video.Compression=H.264
table.Encode[0].MainFormat[1].Video.Width=2560
table.Encode[0].MainFormat[1].Video.Height=1440
table.Encode[0].MainFormat[2].VideoEnable=true
table.Encode[0].MainFormat[2].Video.Compression=H.264
table.Encode[0].MainFormat[2].Video.Width=2560
table.Encode[0].MainFormat[2].Video.Height=1440
table.Encode[0].MainFormat[3].VideoEnable=true
table.Encode[0].MainFormat[3].Video.Compression=H.264
table.Encode[0].MainFormat[3].Video.Width=2560
table.Encode[0].MainFormat[3].Video.Height=1440
table.Encode[0].ExtraFormat[0].VideoEnable=true
table.Encode[0].ExtraFormat[0].Video.Compression=H.264
table.Encode[0].ExtraFormat[0].Video.Width=640
table.Encode[0].ExtraFormat[0].Video.Height=480
table.Encode[0].ExtraFormat[1].VideoEnable=false
table.Encode[0].ExtraFormat[1].Video.Compression=H.264
table.Encode[0].ExtraFormat[1].Video.Width=352
table.Encode[0].ExtraFormat[1].Video.Height=240
table.Encode[0].ExtraFormat[2].VideoEnable=false
table.Encode[0].ExtraFormat[2].Video.Compression=H.264
table.Encode[0].ExtraFormat[2].Video.Width=352
table.Encode[0].ExtraFormat[2].Video.Height=240`;

/** LIVE with ExtraFormat[1] switched on at 1280x720. */
const LIVE_THREE = LIVE.replace(
  "ExtraFormat[1].VideoEnable=false",
  "ExtraFormat[1].VideoEnable=true",
)
  .replace("ExtraFormat[1].Video.Width=352", "ExtraFormat[1].Video.Width=1280")
  .replace(
    "ExtraFormat[1].Video.Height=240",
    "ExtraFormat[1].Video.Height=720",
  );

test("parses main and sub streams for channel 1", () => {
  const { streams } = parseEncodeConfig(SAMPLE, 1);
  assert.deepEqual(streams, [
    {
      role: "high-resolution",
      subtype: 0,
      codec: "h264",
      width: 1920,
      height: 1080,
    },
    {
      role: "low-resolution",
      subtype: 1,
      codec: "h265",
      width: 704,
      height: 480,
    },
  ]);
});

test("skips a disabled extra format", () => {
  const disabled = SAMPLE.replace(
    "ExtraFormat[0].VideoEnable=true",
    "ExtraFormat[0].VideoEnable=false",
  );
  const { streams } = parseEncodeConfig(disabled, 1);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].role, "high-resolution");
});

test("never emits a source for MainFormat[1..3]", () => {
  assert.deepEqual(
    parseEncodeConfig(LIVE, 1).streams.map((s) => s.subtype),
    [0, 1],
    "MainFormat 1-3 are trigger profiles for subtype 0, not extra streams",
  );
});

test("maps each enabled ExtraFormat to its own subtype", () => {
  assert.deepEqual(
    parseEncodeConfig(LIVE_THREE, 1).streams.map((s) => [s.subtype, s.width]),
    [
      [0, 2560],
      [2, 1280],
      [1, 640],
    ],
    "ExtraFormat[i] is served as subtype i+1",
  );
});

test("assigns roles by resolution, not config position", () => {
  assert.deepEqual(
    parseEncodeConfig(LIVE_THREE, 1).streams.map((s) => s.role),
    ["high-resolution", "mid-resolution", "low-resolution"],
  );
});

test("caps at the three roles camera.ui supports, dropping the smallest", () => {
  const four = LIVE_THREE.replace(
    "ExtraFormat[2].VideoEnable=false",
    "ExtraFormat[2].VideoEnable=true",
  );
  const { streams, dropped } = parseEncodeConfig(four, 1);
  assert.equal(streams.length, 3, "four enabled streams, three roles");
  assert.deepEqual(
    streams.map((s) => s.role),
    ["high-resolution", "mid-resolution", "low-resolution"],
  );
  assert.equal(
    streams.some((s) => s.width === 352),
    false,
    "the smallest stream is the one dropped",
  );
  assert.deepEqual(
    dropped.map((s) => s.width),
    [352],
    "the dropped stream is reported, not silently discarded",
  );
});

test("reads the channel offset", () => {
  const ch2 = SAMPLE.replace(/Encode\[0\]/g, "Encode[1]");
  assert.equal(parseEncodeConfig(ch2, 2).streams.length, 2);
  assert.equal(parseEncodeConfig(ch2, 1).streams.length, 0);
});
