import assert from "node:assert/strict";
import { test } from "node:test";

import { AmcrestAuthError, AmcrestClient } from "./api.js";

test("urlFor builds default http url", () => {
  const c = new AmcrestClient({
    ip: "192.168.1.50",
    username: "admin",
    password: "pw",
  });
  assert.equal(
    c.urlFor("/cgi-bin/magicBox.cgi?action=getSystemInfo"),
    "http://192.168.1.50/cgi-bin/magicBox.cgi?action=getSystemInfo",
  );
});

test("urlFor honours a custom http port", () => {
  const c = new AmcrestClient({
    ip: "192.168.1.50",
    username: "admin",
    password: "pw",
    httpPort: 8080,
  });
  assert.equal(
    c.urlFor("/cgi-bin/snapshot.cgi?channel=1"),
    "http://192.168.1.50:8080/cgi-bin/snapshot.cgi?channel=1",
  );
});

test("rtspUrl delegates to buildRtspUrl", () => {
  const c = new AmcrestClient({
    ip: "10.0.0.9",
    username: "admin",
    password: "pw",
    port: 5544,
  });
  assert.equal(
    c.rtspUrl(2, 1),
    "rtsp://admin:pw@10.0.0.9:5544/cam/realmonitor?channel=2&subtype=1",
  );
});

test("AmcrestAuthError carries a clear default message", () => {
  const err = new AmcrestAuthError();
  assert.equal(err.name, "AmcrestAuthError");
  assert.match(err.message, /username and password/i);
  assert.ok(err instanceof Error);
});
