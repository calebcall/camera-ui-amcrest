# Changelog

## Unreleased

- Objects: handle the documented `SmartMotionVehicle` event code. The previous `Vehicle` code is not in the Dahua CGI spec and may never have fired; it is kept as an alias.
- Events: log each unrecognized event code once per camera at debug level, so detections the plugin doesn't map are visible instead of silently dropped. Chatty housekeeping codes (`VideoMotionInfo`, `NTPAdjustTime`, …) are muted.
- Add `npm run watch-events` to tail a camera's event stream and print how each event is classified. See the README's troubleshooting section.
- Tests: add a regression fixture captured from real hardware covering heartbeat filtering and multipart reassembly.

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
