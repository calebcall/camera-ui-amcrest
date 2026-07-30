# Amcrest

Amcrest and Dahua-compatible camera integration for camera.ui. Provides camera discovery, live streaming, two-way audio, PTZ control, and motion, object, audio and doorbell events via the native Amcrest/Dahua CGI API.

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

Object types are filtered by the same mechanism: a zone's **labels** decide which detections it applies to. There is no separate "never alert me about vehicles" setting — express it as a zone. To ignore vehicles everywhere, draw an `exclude` zone covering the frame with its labels set to `vehicle`.

### Choosing intersect or contain

|               | `include`                                   | `exclude`                          |
| ------------- | ------------------------------------------- | ---------------------------------- |
| **intersect** | alert if the object touches the zone at all | drop if it touches the zone at all |
| **contain**   | alert only if the object is wholly inside   | drop only if it is wholly inside   |

**Recommended: `intersect` for include zones, `contain` for exclude zones.**

`contain` combined with `include` is the strict pairing, and on this hardware it will miss almost anything that does not begin wholly inside the zone. Because the camera reports an object's position only once, at first detection, that single sample has to satisfy the whole zone. It misfires in two common ways:

- Someone entering from the edge of frame is only partly inside the zone at first, so they do not alert until they are wholly within it.
- Someone close to the camera has a large bounding box. If your zone is a modest patch of driveway, that box may never fit wholly inside it, so they never alert even while standing in the middle of the zone.

`contain` with `exclude` is the safe pairing — "ignore things wholly inside the neighbour's garden", where someone straddling the boundary still alerts.

### Known limitation

Filtering uses the position reported when the camera first detects the object, because that is the only position available. The camera sends exactly one "started" and one "stopped" event per object, 30–60 seconds apart, with no updates in between — and the two positions can describe completely different parts of the frame. In one measured case a person was first seen in the upper middle of the picture and last seen in the lower left, with no overlap between the two.

So if someone is first picked up outside your zone and then walks into it, **no alert is produced**. Draw `intersect` include zones generously larger than the area you actually care about, so that the object's _first_ detection already falls inside them.

Enable debug logging to see whether this is happening to you — see [Checking what is being filtered](#checking-what-is-being-filtered) below.

### Checking what is being filtered

Enable debug logging in camera.ui and look for:

```
SmartMotionHuman passed detection zones (1 zone(s)): box [0.38,0.32,0.10,0.51]
SmartMotionHuman suppressed by detection zones: box [0.38,0.11,0.05,0.05] outside include zone(s) 'Driveway'
SmartMotionVehicle partially filtered by detection zones: box [0.71,0.33,0.09,0.21] inside exclude zone 'Street'
Detection zones updated: 2 zone(s)
```

The first line is the one to look for when you are checking that a zone works at all: a detection that passes cleanly says so, naming the box it was tested with. Without it, a working zone looks the same in the log as no zone at all.

Two more lines describe what happened to a suppressed object by the time it left:

```
SmartMotionVehicle stayed outside the zones for the whole event — correctly suppressed
SmartMotionHuman entered the zones during the event — no alert was sent (see #26). Stop box [0.15,0.72,0.18,0.28] would pass; Start was suppressed: box [0.55,0.29,0.08,0.37] outside include zone(s) 'Driveway'
```

The second is the limitation above, caught in the act. If you see it often, the boxes tell you where — and enlarging the zone to cover the first-detection position usually fixes it.

The `box` is the detection's position as `[x, y, width, height]`, in fractions of the frame from the top-left corner. It tells you whether the zone or the camera's own coordinates are the surprise — a value of `1.00` on an edge means the object was clipped at the edge of frame.

If a camera reports detections without coordinates, you will see this once per event type:

```
SmartMotionHuman (person) carried no coordinates, so detection zones cannot be applied to it — it is reported unfiltered. Further occurrences are not logged.
```

That is expected on some firmware. Those events are always reported rather than dropped, so a terse camera never costs you a real detection. Note that this line is only logged when you have zones drawn — with no zones there is nothing for the missing coordinates to cost you, so it is not worth saying.

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
- **Dahua-doorbell G.711A talkback** — implemented per the documented codec path but not yet verified against real Dahua-branded doorbell hardware.
- **Discovery byte format** — the Dahua UDP discovery probe/response parsing is based on the documented protocol and has not yet been validated against a real device capture; manual add remains the reliable fallback if discovery doesn't find your device.
- **Camera-side zone configuration** — zones are applied by the plugin, not written to the camera. The device's own recording and alert rules still use whatever regions are configured on it.
