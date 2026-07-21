import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildWsDiscoveryProbe,
  isAmcrestDevice,
  parseWsProbeMatch,
  scopeValue,
  subnetHosts,
} from "./wsdiscovery.js";

const AMCREST_MATCH = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<SOAP-ENV:Body>
<d:ProbeMatches><d:ProbeMatch>
<d:Types>dn:NetworkVideoTransmitter</d:Types>
<d:Scopes>onvif://www.onvif.org/type/Network_Video_Transmitter onvif://www.onvif.org/name/AMC012345 onvif://www.onvif.org/hardware/IP4M-1041B onvif://www.onvif.org/manufacturer/Amcrest onvif://www.onvif.org/Profile/Streaming</d:Scopes>
<d:XAddrs>http://10.1.126.128/onvif/device_service</d:XAddrs>
</d:ProbeMatch></d:ProbeMatches>
</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const OTHER_MATCH = `<d:ProbeMatch xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<d:Scopes>onvif://www.onvif.org/name/SomeCam onvif://www.onvif.org/hardware/XYZ-100 onvif://www.onvif.org/manufacturer/Acme</d:Scopes>
<d:XAddrs>http://192.168.1.9:80/onvif/device_service</d:XAddrs>
</d:ProbeMatch>`;

test("buildWsDiscoveryProbe embeds the Probe action and message id", () => {
  const xml = buildWsDiscoveryProbe("abc-123");
  assert.ok(xml.includes("urn:uuid:abc-123"));
  assert.ok(
    xml.includes("http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe"),
  );
  assert.ok(xml.includes("dn:NetworkVideoTransmitter"));
});

test("parseWsProbeMatch extracts ip and scopes (namespace-agnostic)", () => {
  const d = parseWsProbeMatch(AMCREST_MATCH);
  assert.ok(d);
  assert.equal(d.ip, "10.1.126.128");
  assert.equal(d.manufacturer, "Amcrest");
  assert.equal(d.name, "AMC012345");
  assert.equal(d.hardware, "IP4M-1041B");
});

test("scopeValue reads a scope by key", () => {
  const d = parseWsProbeMatch(AMCREST_MATCH)!;
  assert.equal(scopeValue(d.scopes, "hardware"), "IP4M-1041B");
  assert.equal(scopeValue(d.scopes, "missing"), undefined);
});

test("isAmcrestDevice matches Amcrest, rejects other manufacturers", () => {
  const amcrest = parseWsProbeMatch(AMCREST_MATCH)!;
  const other = parseWsProbeMatch(OTHER_MATCH)!;
  assert.equal(isAmcrestDevice(amcrest.scopes), true);
  assert.equal(isAmcrestDevice(other.scopes), false);
});

test("isAmcrestDevice matches by hardware prefix when manufacturer scope is absent", () => {
  assert.equal(
    isAmcrestDevice(["onvif://www.onvif.org/hardware/IP8M-2496E"]),
    true,
  );
});

test("parseWsProbeMatch returns undefined without an address", () => {
  assert.equal(
    parseWsProbeMatch(
      "<d:ProbeMatch><d:Scopes>onvif://x/name/y</d:Scopes></d:ProbeMatch>",
    ),
    undefined,
  );
});

test("subnetHosts enumerates a /24 excluding network and broadcast", () => {
  const hosts = subnetHosts("10.1.126.179/24");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "10.1.126.1");
  assert.equal(hosts[hosts.length - 1], "10.1.126.254");
  assert.ok(!hosts.includes("10.1.126.0"));
  assert.ok(!hosts.includes("10.1.126.255"));
});

test("subnetHosts handles a /30", () => {
  assert.deepEqual(subnetHosts("192.168.1.5/30"), [
    "192.168.1.5",
    "192.168.1.6",
  ]);
});

test("subnetHosts refuses large subnets and bad input", () => {
  assert.deepEqual(subnetHosts("10.0.0.5/16"), []);
  assert.deepEqual(subnetHosts(null), []);
  assert.deepEqual(subnetHosts("not-a-cidr"), []);
});
