# Changelog

## 1.8.0

**camera.ui 2.1.10 or newer is now required** (previously `>=2.0.24`). Server 2.1.6 replaced the single detection-zone list with one list per purpose — motion, object, privacy, alert and lines — and 2.1.10 settled that shape by dropping the interim include/exclude filter. This plugin is now built against the SDK that came with it, so on an older server its zones would not work. As in 1.6.0, the floor turns that into a clear message at install time instead of a feature that silently does nothing. Node 24 is unchanged.

**If you have detection zones drawn, read the zones section below before upgrading** — camera.ui's own zone model changed, and one thing you may have configured no longer exists.

### Detection zones

- **Zone filtering is now camera.ui's job, not the plugin's.** camera.ui already applies your zones to everything a camera-side plugin reports, and it does so with a better bounding box than the one the camera sends — tracked across the event, and refined by object assist where you have it. The plugin was applying the same zones first, on the single coarse position the camera reports at first sight, and anything it dropped never reached the server at all. That cost more than a duplicate check: a dropped detection was invisible to PTZ autotracking's presence tracking and to camera.ui's own object assist, both of which run before the server filters. The plugin now reports what the camera saw and leaves the filtering to camera.ui. **Your zones behave the same or better; there is nothing to reconfigure.**
- **The zone logging stays, and is now phrased as an observation.** camera.ui's filtering is silent, so the debug lines that tell you a zone is working are still worth having — they just describe what your zones make of a detection rather than what the plugin did about it. `suppressed by detection zones` is now `is outside the detection zones`, and the walk-in and pass-through lines are reworded to match. Because the server judges a better box, its verdict and the log line can occasionally differ; the log always describes the box as it arrived from the camera.
- **`exclude` zones no longer exist — camera.ui removed them.** Object zones are now include-only. If you had an exclude zone, camera.ui's own 2.1.x upgrade migrated it for you; the two replacements are privacy zones (for "ignore anything in this area") and object-zone labels (for "ignore this type"). The way to say "never alert me about vehicles" is now to list only `person` on your object zones: once every object zone names its labels, a type none of them names is not watched anywhere. The README's zone section has been rewritten around the new model.

### Event thumbnails

- **Motion events get their thumbnail back on cameras without smart detection.** On a camera whose only event is plain motion, camera.ui has no cropped object shots to build an event card from, so the dashboard thumbnail is the plugin's own snapshot and nothing else can stand in for it. The plugin returned whatever `snapshot.cgi` sent without checking it — and since a refusal still counts as a completed request, a camera answering "503, no spare connections" or serving a plain-text error page handed those bytes to camera.ui as if they were a picture. camera.ui caches what a plugin gives it and stops looking, so the bad bytes also suppressed its own fallback. The result was motion events that recorded and appeared on the timeline with no thumbnail, and an empty log. Snapshots are now checked — status, and that the body really is a JPEG — and a bad answer is refused so camera.ui falls back to grabbing a frame itself.
- **A camera that stops serving snapshots now says so.** The failure is logged with the status, whatever the device explained, and what that status usually means. It is logged loudly the first time and quietly while it stays the same, because snapshots are taken on a timer *and* on every event — an unchanged failure would otherwise be one identical line a minute.
- **Snapshot requests time out.** They had no deadline, and camera.ui queues concurrent snapshot requests behind one in-flight call, so a camera that accepted the connection and then stalled took every later event thumbnail down with it.

### New sensors

- **Tamper and fault state.** The camera's own reports that its view has been interfered with — lens covered, scene changed, defocused — now raise a **Tamper** sensor, and its reports that the device is unwell — video signal lost, storage missing, failing or nearly full — raise a **Problem** sensor. Both appear on every camera: whether a device sends these codes cannot be asked, only observed, so a sensor sitting at false is a truthful answer rather than a missing one. Both work as cascade triggers, so you can have a tamper start a detection event.
- These codes come from the published Dahua CGI event list rather than from a capture on real hardware, and firmware varies. If one behaves differently on your camera, `npm run watch-events` now prints these events with their state so a report can settle it.

### Also

- Streams now carry their reconnect timeout as a proper source setting, editable per source in camera.ui. The plugin had been expressing it as a URL fragment, which camera.ui strips when the setting is unset — so the 30 seconds it thought it was asking for was governing nothing, and go2rtc's own default applied instead.
- Build tooling moved to `@camera.ui/sdk` 1.2.35 and `@camera.ui/cli` 0.0.103.

### Known issue

Two-way audio may not work at all on any device, not only the Dahua-branded doorbells already flagged. Tracing the server showed that camera.ui only routes streaming through a plugin when the plugin registers a source with no URL of its own — and this plugin registers direct RTSP URLs, so its relay, and the audio backchannel that rides on it, is never connected to. That is a code reading rather than a confirmed reproduction, and fixing it changes how every viewer's live stream is routed, so it is being handled separately. See [#61](https://github.com/calebcall/camera-ui-amcrest/issues/61).

## 1.7.0

Fixes a streaming bug that quietly wasted CPU on every multi-stream camera, and makes two-way audio say what it is doing. Nothing to reconfigure on upgrade; the requirements are unchanged at camera.ui 2.0.24 and Node 24.

- **Streams: asking for the low-resolution source now gets you the low-resolution stream.** Since 1.3.0 the plugin has registered every enabled stream on the camera as its own source, with roles assigned by resolution — but it answered every request for a stream URL with the main one, whatever was asked for. A detector or a recording configured against the low-resolution source was decoding full-resolution video the entire time, which is the exact cost registering the streams separately was meant to avoid. Each source now resolves to the stream it was registered from. The main stream still goes through the plugin's RTSP relay, because that is the path two-way audio rides on; if you have renamed a source in camera.ui the plugin can no longer tell which stream it came from and falls back to the relay, as it did before.
- **Two-way audio: a camera that refuses talkback now says so.** The plugin posts audio to the device and never looked at the answer. Since a rejected request still counts as a completed one, a camera replying "401, this account may not send audio" or "400, not that codec" produced an empty log and silent failure — indistinguishable from camera.ui never sending anything. Refusals are now reported with the status code, whatever explanation the device included, and a note on what that status usually means for talkback specifically.
- **Two-way audio: the path is traceable at debug level.** Opening a session logs the codec, sample rate and content type chosen for your device, and the request being made; closing one logs that too. Enough to tell "camera.ui is not sending audio" apart from "the camera is rejecting it" without guessing. It is one line per session, not per packet — the backchannel carries about fifty packets a second.
- **Two-way audio: a refused session is no longer retried immediately.** A session the camera rejected is torn down and left alone for 30 seconds. Previously the next audio packet would reopen the same doomed request, which at fifty packets a second meant hammering the device for as long as anyone held the talk button.

If Dahua-branded doorbell talkback does not work for you, this release is what makes that reportable — turn on debug logging and the log will name the codec, the request and the camera's answer. That path is still unverified against real Dahua hardware; see [Known limitations](README.md#known-limitations--v2).

## 1.6.1

A build-tooling release. Nothing about the plugin itself changed — no behaviour difference, no configuration to revisit, and the requirements set in 1.6.0 (camera.ui 2.0.24, Node 24) still stand.

- Updated `@camera.ui/cli` to 0.0.75, which fixes the bundler writing dependency entries into the plugin's own manifest where they did not belong. That bug only affected plugins shipping per-platform compiled binaries, which this one does not, so it was never reachable here — verified rather than assumed. The published plugin is functionally identical to 1.6.0.

## 1.6.0

**camera.ui 2.0.24 or newer is now required** (previously `>=2.0.15`). Like the Node 24 change in 1.4.0, this corrects a declaration that was already wrong rather than imposing something new.

The plugin does not ship its own copy of the camera.ui SDK — it asks the server for one at runtime. That means the SDK it actually runs against is whichever the server provides, and 2.0.23 changed which that is: servers up to 2.0.22 provide the old SDK, 2.0.23 and later provide the new one built for the rebuilt sensor system. This plugin has been written against the new SDK since 1.5.0, so on a server older than 2.0.23 its sensors were never going to work — the plugin simply never said so. You would have seen motion, object, audio and doorbell sensors quietly fail to appear, with nothing in the log pointing at the cause. Now the mismatch is refused at install time with a clear message.

The floor is 2.0.24 rather than the strict 2.0.23 minimum because 2.0.24 fixes four server-side bugs that hit this plugin directly: per-camera plugin settings being wiped when a plugin is toggled off and on (this is where your detection zones live), camera-bound sensors permanently losing their camera assignment, cleared settings becoming undefined and making motion detectors fail on every frame, and the plugin settings panel sticking on "No configuration available". The two versions were released the same day, so requiring the later one costs nothing.

**If you are on camera.ui 2.0.23 or older**, update the server first; this plugin will not be offered to you until you do, and you will stay on 1.5.1. Nothing else about the plugin changed — no configuration to revisit, no behaviour difference on a server that meets the new floor.

- Bumped `@camera.ui/cli` to 0.0.74 (build tooling only; `@camera.ui/sdk` was already current at 1.2.3).
- The README now states both the camera.ui and Node requirements up front. The Node 24 requirement was previously only visible in `package.json`.

## 1.5.1

A maintenance release. Every dependency was checked against the registry and updated; there is no behaviour change and nothing to do on upgrade. Detection, zones, streaming, PTZ and talkback all work exactly as they did in 1.5.0, and the runtime floor is unchanged at camera.ui >=2.0.15 and Node >=24.

- The plugin bundle now declares which version of the camera.ui plugin API it was built against, as `cameraui.protocolLevel`. Newer camera.ui servers will read that stamp and refuse to start a plugin built against an incompatible API rather than failing in some harder-to-diagnose way later. No server enforces it yet, so this changes nothing today — it means this plugin is already carrying the marker when they do. Comes from `@camera.ui/cli` 0.0.73 and `@camera.ui/sdk` 1.2.3.
- Resolved a high-severity advisory (GHSA-mh99-v99m-4gvg) in `brace-expansion`, which the plugin picked up indirectly through ESLint. This was build-time only and never reachable from the running plugin, but the dependency tree is now clean.
- Toolchain moved to TypeScript 6 and ESLint 10. Development-only; it does not affect what is published beyond the two points above. TypeScript is deliberately held at 6.x rather than 7.x — the plugin's type-aware lint rules do not yet support the TypeScript 7 compiler, and the reason is recorded in `updates.config.js` so it does not have to be rediscovered.
- Fixed a long-standing annoyance where the formatter and the linter disagreed about source style and quietly undid each other's work depending on which ran last. They no longer format the same files.

## 1.5.0

Makes two detection-zone outcomes visible in the log. No behaviour change: every detection reported to camera.ui is exactly what 1.4.0 reported, and zones continue to filter exactly as before.

- Zones: a detection that passes its zones cleanly now says so at debug level, naming the box it was tested against. Previously it logged nothing, which was indistinguishable from zones not being applied at all — confirming a zone worked meant deliberately drawing it somewhere the object would not be, to force a suppression.
- Zones: when an object's detection is suppressed and it has moved somewhere the zones would accept by the time it leaves, that is now logged with both positions and the original reason. **The alert is still not sent** — this records how often the situation arises, and where, so the case for acting on it can be made from data rather than guesswork.
- Zones: an object that stays outside for the whole event says so too, so a quiet log is not ambiguous between "this never happens" and "the instrumentation is broken". Where the camera reports no position on the way out, the log says the question cannot be answered rather than guessing.
- Docs: the walk-in limitation is now stated as fact rather than as something conditional on firmware behaviour. Real captures settled it — the camera sends exactly one "started" and one "stopped" event per object, 30–60 seconds apart, with no updates in between, and the two positions can describe completely different parts of the frame. Zones are therefore matched against an object's *first* detection only.
- Docs: the guidance on `contain` include zones is correspondingly stronger. Because position is reported once, such a zone will miss almost anything that does not begin wholly inside it. Prefer `intersect` include zones drawn generously larger than the area you care about.

If you have zones drawn, enable debug logging for a week and look for `entered the zones during the event`. Its frequency, and the positions it reports, are what decide whether this is worth fixing properly — and the positions may simply show that enlarging the zone is enough.

## 1.4.0

**Node 24 or newer is now required** (`engines.node` was previously `>=22.0.0`). This corrects a declaration that was already wrong rather than imposing something new: `@seydx/rtsp`, which the plugin imports for RTSP relay and talkback, ships explicit-resource-management syntax (`for await (using x of y)`) that Node 22 cannot parse. On Node 22 the plugin has therefore failed to load at all since 1.3.0 — the requirement was real, only undeclared. Anyone on Node 22 now gets a clear engine error at install instead of an unexplained crash.

Detection zones drawn in camera.ui now apply to this plugin's object events. Previously they had no effect, which looked like a bug but was structural: camera.ui zone-filters detections inside its frame pipeline, and this plugin reports events straight from the camera, bypassing that pipeline entirely.

- Objects: zones are read from the camera's own configuration and applied before a detection reaches the sensor. Full camera.ui semantics — `include`/`exclude`, `intersect`/`contain`, per-zone label filters and privacy masks. Nothing is written to the camera; zones are applied on the server side, so no device configuration is touched.
- Objects: an event describing several objects now reports only those that survive its zones, so the bounding-box overlay shows the object that mattered rather than the one on the pavement.
- Zone edits take effect immediately, without restarting the plugin.
- Events that carry no coordinates are reported unfiltered rather than dropped, so a terse firmware payload never costs a real detection. This is logged once per event type at debug level when zones are drawn.
- Suppressions are logged at debug level naming the responsible zone and the box that was tested, so a zone drawn in the wrong place is diagnosable rather than silently quiet.
- Motion, audio and doorbell events are deliberately **not** filtered. Plain `VideoMotion` carries no coordinates, so there is nothing to test a zone against; keeping it unfiltered also leaves it usable as a cheap trigger for camera.ui's detection cascade, where a frame-based detector does the classifying and applies zones itself.
- Add `npm run zone-fuzz`, a differential fuzz of zone containment against an independent oracle. Three correctness bugs were found this way while the unit suite was green, so it is kept as a regression net rather than discarded.

With no zones drawn, behaviour is unchanged. Object types are filtered through a zone's labels — there is no separate per-camera setting — so to ignore vehicles everywhere, draw an `exclude` zone over the frame with its labels set to `vehicle`. See the README's new "Detection zones" section, in particular the guidance to prefer `intersect` for include zones and `contain` for exclude zones.

## 1.3.0

- Streams: register every enabled stream the camera serves, not just main + the first substream. `ExtraFormat[0..2]` map to RTSP `subtype=1..3`; disabled slots are skipped. Roles are now assigned by resolution (largest → `high-resolution`, smallest → `low-resolution`, any third → `mid-resolution`) rather than by config position. If a camera serves more than three enabled streams, the extras are logged at adoption rather than dropped silently — camera.ui has only three streaming roles.
- Streams: `MainFormat[1..3]` are deliberately never registered. They are per-trigger encoder profiles (general / motion / alarm) for the *same* `subtype=0` stream, so treating them as separate streams would register the same video several times.
- Adoption now logs each registered stream with its role, subtype and resolution.

Applies to newly adopted cameras; already-adopted cameras keep their stored source list until re-adopted.

## 1.2.0

Event handling verified against real hardware captures for the first time; both captures are now regression fixtures.

- Objects: read the SmartMotion payload shape (`object[]` entries with `Rect` and `VehicleID`/`HumanID`), which differs from the `Object.BoundingBox` / `ObjectID` shape used by the cross-line, cross-region and face events. Smart-motion detections previously fell back to a full-frame box even though the camera supplied real coordinates, so the bounding boxes added in 1.1.0 did not reach smart-motion events.
- Objects: report every object described by an event instead of only the first — one event can describe several, each with its own box and track ID.
- Objects: handle the documented `SmartMotionVehicle` event code, confirmed emitted by real hardware. The speculative `Vehicle` code it replaces was never emitted by the device and has been removed.
- Events: log each unrecognized event code once per camera at debug level, so detections the plugin doesn't map are visible instead of silently dropped. Chatty housekeeping codes (`VideoMotionInfo`, `NTPAdjustTime`, …) stay muted.
- Add `npm run watch-events` to tail a camera's event stream and print how each event is classified, including decoded boxes and track IDs. See the README's troubleshooting section.

Note: smart motion must be enabled on the device (`SmartMotionDetect[0].Enable=true`, or Setting → Event → Smart Motion Detection) before it emits person/vehicle events at all.

## 1.1.1

- Objects: handle `action=Pulse` smart events. Firmwares that emit face detections (and, on some models, line crossings) as an instantaneous Pulse with no matching `Stop` were previously **clearing** the object sensor instead of triggering it, so those detections never surfaced. A pulse now activates the category and self-clears after 5s; a repeat pulse extends the window, and a `Start` takes ownership of the category so its timer can't clear a held detection.

## 1.1.0

- Objects: report the real bounding box and camera-side track ID from smart events (`CrossLineDetection`, `CrossRegionDetection`, `FaceDetection`) instead of a full-frame placeholder, converting Dahua's fixed 0-8191 coordinate space to camera.ui's normalized 0-1 box. Payload-less codes (`VideoMotion`, `SmartMotionHuman`) still report full frame.
- Detections now carry `trackId` from the camera's `Object.ObjectID`, so consumers can follow an object across events.

## 1.0.4

- Add automated GitHub Actions publish pipeline (npm Trusted Publishing / OIDC). Verification release; no functional changes.

## 1.0.3

- Update repo to standalone repo

## 1.0.2

- Update logo to be Amcrest colors

## 1.0.1

- Discovery: use dependency-free ONVIF WS-Discovery (unicast subnet sweep) instead of the Dahua DHIP probe, which many Amcrest units don't answer; label discovered/manual cameras as "Amcrest".
- Manual add: fix the "Add Camera" form (submit button now reads the entered IP).
- Snapshots: serve via the plugin's SnapshotInterface (snapshot.cgi) instead of ffmpeg-over-RTSP, avoiding connection contention and "exit status 69/183" under load.
- Events: add `heartbeat` to the event stream so idle cameras no longer hit undici's body timeout and reconnect every ~5 min.
- Auth: report invalid credentials clearly instead of the misleading "not amcrest".
- Talkback: fix the streaming POST (`duplex: 'half'`) so two-way audio can open.
- Whitelist the node-av install script (allowScripts).

## 0.0.1

- Initial release: Amcrest / Dahua-compatible cameras, doorbells and PTZ.
- Live streaming and snapshots via native RTSP + CGI.
- Two-way audio (Amcrest doorbell AAC path).
- Motion, object (person/vehicle), audio and doorbell events via the native event stream.
- PTZ control.
- Dahua UDP discovery and manual add.
