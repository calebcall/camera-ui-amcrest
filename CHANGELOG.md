# Changelog

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
