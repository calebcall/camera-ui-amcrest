import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDiscoveryProbe, parseDiscoveryResponse } from "./discovery.js";

// These tests are self-consistent (they check the implementation against
// itself / synthetic data), NOT against a real device capture. See the
// file-level comment in discovery.ts: the byte format is unvalidated
// against real hardware until Task 15.

test("buildDiscoveryProbe: trailing bytes are the expected JSON body", () => {
  const probe = buildDiscoveryProbe();
  const header = probe.subarray(0, 32);
  const body = probe.subarray(32);

  assert.deepEqual(JSON.parse(body.toString("utf8")), {
    method: "DHDiscover.search",
    params: { mac: "", uni: 1 },
  });

  // The header's length fields (offsets 4 and 12, per this implementation's
  // own encoding) must equal the JSON body's byte length.
  assert.equal(header.readUInt32LE(4), body.length);
  assert.equal(header.readUInt32LE(12), body.length);
});

test("buildDiscoveryProbe: fixed header bytes", () => {
  const probe = buildDiscoveryProbe();
  assert.equal(probe.readUInt8(0), 0x20);
  assert.equal(probe.readUInt8(1), 0x00);
  assert.equal(
    probe.length,
    32 +
      Buffer.from(
        JSON.stringify({
          method: "DHDiscover.search",
          params: { mac: "", uni: 1 },
        }),
      ).length,
  );
});

function syntheticDatagram(jsonBody: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(jsonBody), "utf8");
  const header = Buffer.alloc(32);
  header.writeUInt8(0x20, 0);
  header.writeUInt8(0x00, 1);
  header.writeUInt32LE(body.length, 4);
  header.writeUInt32LE(body.length, 12);
  return Buffer.concat([header, body]);
}

test("parseDiscoveryResponse: extracts ip/mac/deviceType from a synthetic datagram", () => {
  const datagram = syntheticDatagram({
    params: {
      deviceInfo: {
        IPv4Address: { IPAddress: "192.168.1.77" },
        PhysicalAddress: "aa:bb:cc:dd:ee:ff",
        DeviceType: "IP4M-1041B",
      },
    },
  });

  const parsed = parseDiscoveryResponse(datagram);
  assert.ok(parsed);
  assert.equal(parsed!.ip, "192.168.1.77");
  assert.equal(parsed!.mac, "aa:bb:cc:dd:ee:ff");
  assert.equal(parsed!.deviceType, "IP4M-1041B");
});

test("parseDiscoveryResponse: undefined when the datagram has no JSON body", () => {
  const datagram = Buffer.from([
    0x20, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  ]);
  assert.equal(parseDiscoveryResponse(datagram), undefined);
});

test("parseDiscoveryResponse: undefined when the content between braces is invalid JSON", () => {
  const datagram = Buffer.from("garbage{not: valid json,,,}trailing", "utf8");
  assert.equal(parseDiscoveryResponse(datagram), undefined);
});

test("parseDiscoveryResponse: undefined when the JSON body is missing an IP", () => {
  const datagram = syntheticDatagram({
    params: {
      deviceInfo: {
        PhysicalAddress: "aa:bb:cc:dd:ee:ff",
        DeviceType: "IP4M-1041B",
      },
    },
  });

  assert.equal(parseDiscoveryResponse(datagram), undefined);
});
