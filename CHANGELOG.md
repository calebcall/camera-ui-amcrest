# Changelog

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
