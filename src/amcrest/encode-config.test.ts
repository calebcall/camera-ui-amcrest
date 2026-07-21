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

test("parses main and sub streams for channel 1", () => {
  const streams = parseEncodeConfig(SAMPLE, 1);
  assert.deepEqual(streams, [
    { role: "main", subtype: 0, codec: "h264", width: 1920, height: 1080 },
    { role: "sub", subtype: 1, codec: "h265", width: 704, height: 480 },
  ]);
});

test("skips a disabled extra format", () => {
  const disabled = SAMPLE.replace(
    "ExtraFormat[0].VideoEnable=true",
    "ExtraFormat[0].VideoEnable=false",
  );
  const streams = parseEncodeConfig(disabled, 1);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].role, "main");
});
