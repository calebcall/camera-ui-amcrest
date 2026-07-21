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

| Field | Description |
| --- | --- |
| IP Address | The camera/doorbell's IP address, e.g. `192.168.1.50`. |
| Username | Account username (see the admin-credential note below for doorbells). |
| Password | Account password. |
| Channel | Camera channel (defaults to `1`; only relevant for multi-channel devices). |

### Discovery

The plugin listens for Dahua DHIP discovery responses on the local network (UDP multicast/broadcast on port 37810) and lists any devices found so they can be adopted with the same IP/username/password/channel fields as manual add.

### Admin credential for doorbells

For Amcrest doorbells, the plugin requires the device's local **admin** account credential — the same `admin` username and password used to configure the doorbell directly (e.g. via its web UI or `Amcrest Smart Home` cloud app's device settings).

This is **not** the same as your `Amcrest Smart Home` cloud account login. The cloud account uses an email address and is only used to manage the device from the mobile app; it cannot be used to authenticate directly against the device's CGI API. If you don't remember the `admin` password, it's the one you set the first time you configured the doorbell (before adding it to the cloud app).

## Known limitations / v2

The following are deferred to a future release:

- **NVR channels** — cameras attached to and accessed through an Amcrest/Dahua NVR are not supported; only directly-addressable devices are.
- **Siren / floodlight control** — not exposed in this release.
- **Camera-side recording configuration** — the plugin does not configure the device's own SD-card/NVR recording settings.
- **Door lock/unlock** — Dahua video-intercom lock relay control is not implemented.
- **ONVIF-backchannel talkback fallback** — devices that only support two-way audio via an ONVIF backchannel (rather than the native Amcrest/Dahua audio path) are not yet supported.
- **Dahua-doorbell G.711A talkback** — implemented per the documented codec path but not yet verified against real Dahua-branded doorbell hardware.
- **Discovery byte format** — the Dahua UDP discovery probe/response parsing is based on the documented protocol and has not yet been validated against a real device capture; manual add remains the reliable fallback if discovery doesn't find your device.
