# Amcrest

Amcrest and Dahua-compatible camera integration for camera.ui. Provides camera discovery, live streaming, two-way audio, PTZ control, and motion, object, audio and doorbell events via the native Amcrest/Dahua CGI API.

## Requirements

- **camera.ui 2.0.24 or newer.** Server 2.0.23 rebuilt the sensor system, and this plugin targets the SDK generation that came with it. On older servers the plugin's sensors would not work — the 2.0.24 floor turns that into a clear message at install time instead of sensors that silently never appear. 2.0.24 also carries the server fixes for per-camera plugin settings and camera-bound sensor assignment, both of which this plugin relies on.
- **Node 24 or newer.** `@seydx/rtsp`, used for RTSP relay and talkback, ships syntax Node 22 cannot parse.

## Supported devices

- Standard Amcrest IP cameras (main/sub stream, motion and object detection).
- Amcrest doorbells (e.g. AD110/AD410-style models), including doorbell press events and two-way audio.
- PTZ-capable Amcrest cameras (pan, tilt and zoom).
- Other Dahua-compatible (OEM) devices that expose the same CGI/RTSP interface.

NVR-attached channels are not supported in this release — see [Known limitations](#known-limitations--v2) below.

## Features

- **Live view & snapshot** — native RTSP streaming and CGI snapshot capture, no ONVIF required.
- **Two-way audio** — talkback over the device's native audio path. Amcrest-branded devices use the AAC path; Dahua-branded doorbells use G.711A (see [Known limitations](#known-limitations--v2)).
- **Events** — motion, object detection (person/vehicle), audio detection, and doorbell press, all delivered over the device's native event stream (no polling).
- **PTZ** — pan/tilt/zoom control for capable cameras, exposed as a PTZ sensor/service.
- **Discovery** — automatic discovery of Dahua-compatible devices on the local network via UDP, plus manual add for devices that don't respond to discovery (e.g. across subnets).

## Setup

### Manual add

If a device isn't discovered automatically, add it manually with:

| Field      | Description                                                                |
| ---------- | -------------------------------------------------------------------------- |
| IP Address | The camera/doorbell's IP address, e.g. `192.168.1.50`.                     |
| Username   | Account username (see the admin-credential note below for doorbells).      |
| Password   | Account password.                                                          |
| Channel    | Camera channel (defaults to `1`; only relevant for multi-channel devices). |

### Discovery

The plugin listens for Dahua DHIP discovery responses on the local network (UDP multicast/broadcast on port 37810) and lists any devices found so they can be adopted with the same IP/username/password/channel fields as manual add.

### Admin credential for doorbells

For Amcrest doorbells, the plugin requires the device's local **admin** account credential — the same `admin` username and password used to configure the doorbell directly (e.g. via its web UI or `Amcrest Smart Home` cloud app's device settings).

This is **not** the same as your `Amcrest Smart Home` cloud account login. The cloud account uses an email address and is only used to manage the device from the mobile app; it cannot be used to authenticate directly against the device's CGI API. If you don't remember the `admin` password, it's the one you set the first time you configured the doorbell (before adding it to the cloud app).

## Detection zones

Zones drawn in camera.ui are applied to this plugin's events by the plugin itself. Draw them as normal — there is nothing to enable, and no zone settings on the plugin's own page.

Because detection happens on the camera rather than on frames decoded by camera.ui, zones can only be applied to events that tell us _where_ something happened:

| Event                                         | Carries coordinates | Zones apply |
| --------------------------------------------- | ------------------- | ----------- |
| `SmartMotionHuman` / `SmartMotionVehicle`     | yes                 | yes         |
| `CrossLineDetection` / `CrossRegionDetection` | yes                 | yes         |
| `FaceDetection`                               | usually             | yes         |
| `VideoMotion` (plain motion)                  | no                  | **no**      |

Plain motion carries no coordinates at all, so it is always reported in full. If plain motion is your main source of noise, turn it off on the camera and rely on the smart events instead.

### Which zone lists are used

camera.ui draws five kinds of zone. This plugin uses two of them:

| Zone list   | Used | What it does here                                                                                |
| ----------- | ---- | ------------------------------------------------------------------------------------------------ |
| **Object**  | yes  | An object counts only where an object zone claims its label.                                     |
| **Privacy** | yes  | An object wholly inside one is dropped, unless the zone is set to keep detections.               |
| **Alert**   | no   | Never filters — it decides which detections may raise a push notification. camera.ui applies it. |
| **Motion**  | no   | Scopes the `motion` label only, and `VideoMotion` carries no coordinates to test.                |
| **Lines**   | no   | Line crossings arrive as their own camera-side events.                                           |

Object zones are include gates: every one of them says where something _does_ count, never where it doesn't. To keep something out of an area, use a privacy zone.

### Filtering by object type

A zone's **labels** decide which detections it applies to, and they also decide which labels are watched at all. Drawing any object zone puts the camera into allow-listed mode: from that point a label appearing in **no** zone's label list is dropped wherever it stands, not waved through. That is how you express "never alert me about vehicles" — list only `person` on your object zones. The log says `is a 'vehicle' and no zone lists that label` when this is what dropped something.

One object zone with no labels turns that off: a zone that lists nothing claims every label, so the zones constrain _where_ things count rather than _which_.

### Choosing intersect or contain

|               | Object zone                                 |
| ------------- | ------------------------------------------- |
| **intersect** | alert if the object touches the zone at all |
| **contain**   | alert only if the object is wholly inside   |

**Recommended: `intersect`.**

`contain` is the strict setting, and on this hardware it will miss almost anything that does not begin wholly inside the zone. Because the camera reports an object's position only once, at first detection, that single sample has to satisfy the whole zone. It misfires in two common ways:

- Someone entering from the edge of frame is only partly inside the zone at first, so they do not alert until they are wholly within it.
- Someone close to the camera has a large bounding box. If your zone is a modest patch of driveway, that box may never fit wholly inside it, so they never alert even while standing in the middle of the zone.

Privacy zones always match on containment, so "ignore things wholly inside the neighbour's garden" still lets someone straddling the boundary alert.

### Known limitation

Filtering uses the position reported when the camera first detects the object, because that is the only position available. The camera sends exactly one "started" and one "stopped" event per object, 30–60 seconds apart, with no updates in between — and the two positions can describe completely different parts of the frame. In one measured case a person was first seen in the upper middle of the picture and last seen in the lower left, with no overlap between the two.

So if someone is first picked up outside your zone and then walks into it, **no alert is produced**. Draw object zones generously larger than the area you actually care about, so that the object's _first_ detection already falls inside them.

Enable debug logging to see whether this is happening to you — see [Checking what is being filtered](#checking-what-is-being-filtered) below.

### Checking what is being filtered

Enable debug logging in camera.ui and look for:

```
SmartMotionHuman passed detection zones (1 zone(s)): box [0.38,0.32,0.10,0.51]
SmartMotionHuman suppressed by detection zones: box [0.38,0.11,0.05,0.05] outside object zone(s) 'Driveway'
SmartMotionVehicle partially filtered by detection zones: box [0.71,0.33,0.09,0.21] inside privacy mask 'Street'
Detection zones updated: 2 zone(s)
```

The first line is the one to look for when you are checking that a zone works at all: a detection that passes cleanly says so, naming the box it was tested with. Without it, a working zone looks the same in the log as no zone at all.

Three more lines describe what happened to a suppressed object by the time it left:

```
SmartMotionVehicle stayed outside the zones for the whole event — correctly suppressed
SmartMotionHuman entered the zones during the event — no alert was sent (see #26). Stop box [0.15,0.72,0.18,0.28] would pass; Start was suppressed: box [0.55,0.29,0.08,0.37] outside object zone(s) 'Driveway'
SmartMotionHuman left without coordinates — cannot tell whether it entered the zones
```

The second is the limitation above, caught in the act. If you see it often, the boxes tell you where — and enlarging the zone to cover the first-detection position usually fixes it.

The third appears when the "stopped" event carries no position at all: nothing can be concluded either way, and it is said explicitly so that a quiet log means "this is not happening to you" rather than "this could never be measured".

Editing your zones ends any of these that are still pending. A suppression recorded against the old zones cannot be judged against the new ones, so the object that was in flight when you saved goes unreported rather than being described using two different zone lists.

The `box` is the detection's position as `[x, y, width, height]`, in fractions of the frame from the top-left corner. It tells you whether the zone or the camera's own coordinates are the surprise — a value of `1.00` on an edge means the object was clipped at the edge of frame.

If a camera reports detections without coordinates, you will see this once per event type:

```
SmartMotionHuman (person) carried no coordinates, so detection zones cannot be applied to it — it is reported unfiltered. Further occurrences are not logged.
```

That is expected on some firmware. Those events are always reported rather than dropped, so a terse camera never costs you a real detection. Note that this line is only logged when you have zones drawn — with no zones there is nothing for the missing coordinates to cost you, so it is not worth saying.

## Troubleshooting snapshots and event thumbnails

Snapshots come from the camera's own `snapshot.cgi` over HTTP rather than from a decoded RTSP frame, so they do not compete with live view for the device's limited connections. camera.ui asks this plugin for them before it asks go2rtc.

That same picture is what camera.ui uses for the **event thumbnail** on the dashboard. On a camera whose only event is plain `VideoMotion` there is nothing else it can use — no smart detection means no detection segment, so there are no cropped "moment" pictures to fall back on. If `snapshot.cgi` is not answering with a JPEG, motion events end up with no thumbnail at all even though the event itself is recorded and shows on the timeline.

When that happens the plugin says so:

```
Camera refused the snapshot request: HTTP 503 Service Unavailable — the device is out of spare connections — it is busy serving streams
Camera answered the snapshot request with 45 bytes that are not a JPEG — Error
```

The line is logged at error level the first time and at debug while it stays the same, so a camera that has stopped serving snapshots does not fill the log with one identical line a minute. A snapshot that succeeds re-arms it.

In every one of these cases the plugin returns nothing rather than the bad bytes, which lets camera.ui fall back to grabbing a frame through go2rtc. If you see one of these lines, check that snapshots are enabled on the camera and that the account has permission to read them.

## Troubleshooting events

If a camera-side detection (person, vehicle, face, line crossing) isn't showing up in camera.ui, the likely cause is an event code this plugin doesn't recognize yet — firmware varies in which codes it emits.

Enable debug logging in camera.ui and look for lines like:

```
Unhandled Amcrest event code: ParkingDetection (action=Start) — please report it at ...
```

Each unrecognized code is logged once per camera. If you see one that should map to a detection, please open an issue with that line.

To watch the raw stream directly from a checkout of this repo:

```bash
npm run watch-events -- --ip 192.168.1.50 --user admin --pass secret
```

Then trigger the event on the camera (walk through frame, drive past, ring the doorbell). Each event prints with how the plugin classifies it:

```
14:02:31  CrossRegionDetection     action=Start   -> object person active box=[0.349, 0.156, 0.125, 0.440] track=863
14:02:44  ParkingDetection         action=Start   -> UNHANDLED
```

Credentials can also be supplied as `AMCREST_IP` / `AMCREST_USER` / `AMCREST_PASS`.

## Known limitations / v2

The following are deferred to a future release:

- **NVR channels** — cameras attached to and accessed through an Amcrest/Dahua NVR are not supported; only directly-addressable devices are.
- **Siren / floodlight control** — not exposed in this release.
- **Camera-side recording configuration** — the plugin does not configure the device's own SD-card/NVR recording settings.
- **Door lock/unlock** — Dahua video-intercom lock relay control is not implemented.
- **ONVIF-backchannel talkback fallback** — devices that only support two-way audio via an ONVIF backchannel (rather than the native Amcrest/Dahua audio path) are not yet supported.
- **Dahua-doorbell G.711A talkback** — implemented per the documented codec path but not yet verified against real Dahua-branded doorbell hardware. If it does not work for you, turn on debug logging: the plugin reports the codec it chose, the request it made, and the status the camera answered with, which is what a report needs to be actionable.
- **Discovery byte format** — the Dahua UDP discovery probe/response parsing is based on the documented protocol and has not yet been validated against a real device capture; manual add remains the reliable fallback if discovery doesn't find your device.
- **Camera-side zone configuration** — zones are applied by the plugin, not written to the camera. The device's own recording and alert rules still use whatever regions are configured on it.
