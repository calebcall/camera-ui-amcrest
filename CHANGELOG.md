# Changelog

## 1.4.0

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
