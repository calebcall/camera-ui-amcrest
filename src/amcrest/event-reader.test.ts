import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  detectBoundary,
  extractCompleteEvents,
  splitEventMultipart,
} from "./event-reader.js";
import { classifyAmcrestEvent } from "./classify.js";
import { parseAmcrestEvent } from "./events.js";
import { UnhandledCodeTracker } from "./unhandled-codes.js";

const BODY = [
  "--myboundary",
  "Content-Type: text/plain",
  "Content-Length: 40",
  "",
  "Code=VideoMotion;action=Start;index=0",
  "--myboundary",
  "Content-Type: text/plain",
  "Content-Length: 39",
  "",
  "Code=VideoMotion;action=Stop;index=0",
  "--myboundary--",
].join("\r\n");

test("splits multipart body into event blobs", () => {
  const blobs = splitEventMultipart(BODY, "myboundary");
  assert.equal(blobs.length, 2);
  assert.ok(blobs[0].includes("Code=VideoMotion;action=Start"));
  assert.ok(blobs[1].includes("Code=VideoMotion;action=Stop"));
});

test('handles the "-- boundary" (spaced) variant', () => {
  const spaced = BODY.replace(/--myboundary/g, "-- myboundary");
  const blobs = splitEventMultipart(spaced, "myboundary");
  assert.equal(blobs.length, 2);
});

test("extractCompleteEvents: no boundary marker yields no blobs and an unchanged buffer", () => {
  const buffer = "no boundary has arrived yet";
  const { blobs, rest } = extractCompleteEvents(buffer, "myboundary");
  assert.deepEqual(blobs, []);
  assert.equal(rest, buffer);
});

test("extractCompleteEvents: strips a stray HTTP/1.1 200 OK status line from the emitted blob", () => {
  const buffer = [
    "--myboundary",
    "Content-Type: text/plain",
    "",
    "HTTP/1.1 200 OK",
    "Code=VideoMotion;action=Start;index=0",
    "--myboundary",
    "",
  ].join("\r\n");

  const { blobs } = extractCompleteEvents(buffer, "myboundary");
  assert.equal(blobs.length, 1);
  assert.ok(!blobs[0].includes("HTTP/1.1 200 OK"));
  assert.ok(blobs[0].includes("Code=VideoMotion;action=Start;index=0"));
});

test("extractCompleteEvents: does not double-dispatch an event across chunk boundaries (regression)", () => {
  // Chunk 1 delivers one complete event (E1) followed by the start of the next
  // boundary marker — nothing after it yet, so it is the incomplete "rest".
  const chunk1 = [
    "--myboundary",
    "Content-Type: text/plain",
    "",
    "Code=E1;action=Start",
    "--myboundary",
    "",
  ].join("\r\n");

  const first = extractCompleteEvents(chunk1, "myboundary");
  assert.equal(first.blobs.length, 1);
  assert.ok(first.blobs[0].includes("Code=E1;action=Start"));

  // Chunk 2 appends a second event (E2) and its closing boundary onto the
  // previous "rest". Only E2 should be emitted this time — E1 must not
  // reappear just because it is still sitting in the accumulated buffer.
  const chunk2 =
    first.rest +
    [
      "Content-Type: text/plain",
      "",
      "Code=E2;action=Start",
      "--myboundary",
      "",
    ].join("\r\n");

  const second = extractCompleteEvents(chunk2, "myboundary");
  assert.equal(second.blobs.length, 1);
  assert.ok(second.blobs[0].includes("Code=E2;action=Start"));
  assert.ok(!second.blobs.some((b) => b.includes("E1")));
});

test("detects the multipart boundary from the stream preamble", () => {
  assert.equal(
    detectBoundary("--myboundary\r\nContent-Type: text/plain\r\n\r\nCode=X"),
    "myboundary",
  );
});

test("strips the leading dashes Amcrest sometimes doubles up", () => {
  assert.equal(detectBoundary("----fooBoundary\r\n"), "fooBoundary");
});

test("returns undefined before a boundary has arrived", () => {
  assert.equal(detectBoundary("HTTP/1.1 200 OK\r\n"), undefined);
});

test("handles a real capture: heartbeats dropped, every event recovered once", () => {
  const capture = readFileSync(
    fileURLToPath(
      new URL("../fixtures/event-stream-capture.txt", import.meta.url),
    ),
    "utf8",
  );
  const { blobs } = extractCompleteEvents(capture, "myboundary");
  const events = blobs.map((b) => parseAmcrestEvent(b)!);

  assert.equal(
    events.length,
    10,
    "5 heartbeats must be dropped, 10 events kept",
  );
  assert.deepEqual(
    events.filter((e) => e.code === "VideoMotion").map((e) => e.action),
    ["Start", "Stop", "Start", "Stop"],
  );
  assert.equal(
    events.filter((e) => e.code === "VideoMotionInfo").length,
    6,
    "VideoMotionInfo is the chatty code the tracker mutes",
  );
  // The payload must survive the multipart split intact.
  const start = events.find((e) => e.code === "VideoMotion")!;
  assert.deepEqual((start.data as { RegionName: string[] }).RegionName, [
    "Area1",
  ]);
});

test("mutes the housekeeping codes seen in a real capture", () => {
  const tracker = new UnhandledCodeTracker();
  assert.equal(tracker.shouldReport("VideoMotionInfo"), false);
});

test("classifies a smart-motion vehicle end-to-end from a real capture", () => {
  const capture = readFileSync(
    fileURLToPath(
      new URL("../fixtures/event-stream-smartmotion.txt", import.meta.url),
    ),
    "utf8",
  );
  const { blobs } = extractCompleteEvents(capture, "myboundary");
  const events = blobs.map((b) => parseAmcrestEvent(b)!);
  assert.deepEqual(
    events.map((e) => e.code),
    ["SmartMotionVehicle", "VideoMotion", "VideoMotionInfo", "VideoMotionInfo"],
  );

  const c = classifyAmcrestEvent(events[0]) as {
    category: string;
    active: boolean;
    detections?: { box: { width: number }; trackId?: number }[];
  };
  assert.equal(c.category, "vehicle");
  assert.equal(c.active, true);
  assert.equal(c.detections?.length, 1, "the Rect must survive the split");
  assert.equal(c.detections?.[0].trackId, 2);
  assert.ok(
    c.detections![0].box.width > 0 && c.detections![0].box.width < 1,
    "a real box, not the full-frame placeholder",
  );
});
