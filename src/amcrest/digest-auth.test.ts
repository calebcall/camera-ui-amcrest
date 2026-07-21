import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  buildDigestAuthHeader,
  parseWwwAuthenticate,
  selectQop,
} from "./digest-auth.js";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

test("parseWwwAuthenticate parses a Digest challenge", () => {
  const parsed = parseWwwAuthenticate(
    'Digest realm="Login to camera", qop="auth", nonce="abc123", opaque="xyz"',
  );
  assert.equal(parsed.realm, "Login to camera");
  assert.equal(parsed.qop, "auth");
  assert.equal(parsed.nonce, "abc123");
  assert.equal(parsed.opaque, "xyz");
});

test("buildDigestAuthHeader computes the RFC 2617 response with qop=auth", () => {
  const p = {
    username: "admin",
    password: "secret",
    realm: "Login to camera",
    nonce: "abc123",
    method: "GET",
    uri: "/cgi-bin/magicBox.cgi?action=getSystemInfo",
    qop: "auth",
    nc: "00000001",
    cnonce: "deadbeef",
  };
  const ha1 = md5(`${p.username}:${p.realm}:${p.password}`);
  const ha2 = md5(`${p.method}:${p.uri}`);
  const expectedResponse = md5(
    `${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`,
  );

  const header = buildDigestAuthHeader(p);
  assert.match(header, /^Digest /);
  assert.ok(header.includes(`username="admin"`));
  assert.ok(header.includes(`realm="Login to camera"`));
  assert.ok(header.includes(`nonce="abc123"`));
  assert.ok(header.includes(`uri="${p.uri}"`));
  assert.ok(header.includes(`qop=auth`));
  assert.ok(header.includes(`nc=00000001`));
  assert.ok(header.includes(`cnonce="deadbeef"`));
  assert.ok(header.includes(`response="${expectedResponse}"`));
});

test("selectQop returns auth when only auth is offered", () => {
  assert.equal(selectQop("auth"), "auth");
});

test("selectQop prefers auth over auth-int regardless of order", () => {
  assert.equal(selectQop("auth-int,auth"), "auth");
});

test("selectQop falls back to legacy digest when only auth-int is offered", () => {
  assert.equal(selectQop("auth-int"), undefined);
});

test("selectQop returns undefined when no qop is present", () => {
  assert.equal(selectQop(undefined), undefined);
});

test("selectQop returns undefined for an empty qop string", () => {
  assert.equal(selectQop(""), undefined);
});
