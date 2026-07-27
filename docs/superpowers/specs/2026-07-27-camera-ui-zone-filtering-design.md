# Apply camera.ui detection zones to Amcrest camera-side events

Date: 2026-07-27
Status: Approved, pending implementation plan

## Problem

The plugin reports motion, object, audio and doorbell events straight from the
camera's native event stream. This is deliberate — detection happens on the
camera, so camera.ui never decodes a frame for it.

The cost of that choice is that detection zones drawn in camera.ui have no
effect. Zones are still honoured for other detectors, so the behaviour looks
like a bug in this plugin rather than a design consequence.

The cause is structural. The SDK has two tiers of sensor:

- `MotionDetectorSensor` / `ObjectDetectorSensor` set `_requiresFrames = true`
  and receive frames from the backend pipeline. Per the SDK's own doc comment
  on `MotionDetectorSensor`, the backend *"calls `detectMotion()` at the
  configured frame interval, zone-filters the returned detections and applies
  them."*
- Plain `MotionSensor` / `ObjectSensor` set `_requiresFrames = false`.
  `reportDetections()` writes directly to sensor state.

This plugin uses the second tier. The zone filter lives in the frame pipeline
that camera-side events bypass by design, so zones are never consulted.

### Requirements

1. Do not alert for detections outside the zone the user drew.
2. Do not alert for object types the user has excluded.

Both are expressible in camera.ui's existing model: `DetectionZone` carries
`points` (the polygon) *and* `labels[]` (which detection labels the zone
applies to). There is no separate per-camera "ignore this label" setting, so a
single mechanism covers both requirements.

## Approach

Filter in the plugin. Read `cameraDevice.detectionZones`, test each detection's
bounding box against it, and suppress non-qualifying detections before they
reach the sensor.

`CameraDevice` exposes `readonly detectionZones: DetectionZone[]` and
`onPropertyChange('detectionZones')`, which returns a `Disposable`. The plugin
can therefore both read the zones the user drew and react to live edits,
without rebuilding a zone editor.

### Which events can be filtered

| Amcrest event | Box in payload | Filterable |
| --- | --- | --- |
| `SmartMotionHuman` / `SmartMotionVehicle` | yes (`Rect`, 0–8191) | yes, exactly |
| `CrossLineDetection` / `CrossRegionDetection` | yes (`BoundingBox`) | yes, exactly |
| `FaceDetection` | usually | yes |
| `VideoMotion` | **no** | **no** |

`classify.ts` already normalizes the first three to 0–1 boxes. `VideoMotion`
carries no coordinates; `object.ts` substitutes a full-frame box, which
intersects every zone, so it can never be filtered meaningfully.

### Rejected alternatives

**Push zones down to the camera** (`VideoAnalyseRule` IVS polygons and/or the
`MotionDetect` region grid, over CGI). Rejected: it gates the wrong events.
IVS polygons affect `CrossLine`/`CrossRegion` only, not `SmartMotionHuman` /
`SmartMotionVehicle`, which is the actual noise source. It also overwrites
device configuration the user currently has no way to re-edit (the Amcrest web
UI does not expose zone editing; a separate mobile app is required), cannot
express `exclude` or `contain`, and varies by firmware in its per-label rule
support. High blast radius, no benefit against the stated requirements.

**Zone editor in plugin settings.** Rejected: plugin settings render as plain
text fields only, so this would mean hand-typing polygon coordinates, and would
duplicate a drawing UI camera.ui already provides and already persists.

### Explicit non-goals

- No reduction in camera-to-server event traffic. The camera still sends every
  event; the plugin declines to act on some. Given events are cheap and require
  no server-side inference, the saving is negligible and not worth the risk of
  writing device configuration.
- No improvement to the camera's own classification accuracy. If the camera
  calls a rubbish bin a person, zones cannot help; a real detector plugin is
  the answer.
- The motion sensor (`VideoMotion`) is not filtered. See "Constraints".

## Constraints

**The motion sensor must remain unfiltered.** Two independent reasons:

1. `VideoMotion` carries no box, so filtering would be all-or-nothing rather
   than spatial.
2. camera.ui's detection cascade (`cascadeDetection`, `cascadeTimeout`,
   `SensorTriggerSettings.triggers`) uses a cheap sensor to wake the frame
   pipeline for an expensive detector. A camera-side motion event is close to
   the cheapest possible wake source. Filtering it would starve any frame-based
   detector the user later assigns.

This is a constraint, not a preference — changing it breaks scenario 2 below.

Audio and doorbell sensors are also unfiltered; neither has spatial meaning.

## Interaction with other detector plugins

`PluginAssignments` declares `motion`, `object` and `audio` as singular — one
plugin per detection role per camera. That makes the roles exclusive:

1. **Another plugin assigned to `object`** (e.g. openvino). This plugin is no
   longer the object detector for that camera, so the filter is inert; it only
   ever touches `AmcrestObjectSensor`. The other plugin's results are
   zone-filtered natively by the backend.
2. **Hybrid: Amcrest motion as cascade trigger, another plugin classifying.**
   Works, and is why the motion sensor stays unfiltered (see "Constraints").
3. **Both filters active on the same detections.** Cannot occur given singular
   assignment. Harmless if it did — same zones, same semantics, and the
   predicate is idempotent.

The work is therefore additive and self-scoping: it improves the camera-side
event path, and costs nothing if the user later moves to a frame-based
detector.

Confidence note: scenario 1's backend zone-filtering is stated directly in the
SDK doc comment on `MotionDetectorSensor`. Scenario 2's cascade behaviour is
inferred from SDK type names and doc comments; camera.ui's server source is not
part of this repository and has not been read. Confirm against a running
instance before relying on scenario 2.

## Design

### Modules

Two new pure modules, matching the repo's existing shape (small, focused,
colocated `.test.ts`).

#### `src/zones/geometry.ts`

No camera.ui types. Operates on 0–1 coordinates only, via its own coordinate
type:

```ts
/** A point in normalized 0-1 space. Distinct from the SDK's `Point`, which is 0-100. */
export type Vec2 = [number, number];
```

- `pointInPolygon(point: Vec2, polygon: Vec2[])` — ray casting.
- `boxIntersectsPolygon(box, polygon)` — true if any box corner lies in the
  polygon, **or** any polygon vertex lies in the box, **or** any box edge
  crosses any polygon edge. The third condition catches a polygon that slices
  through the box without either shape containing the other's vertices.
- `boxInsidePolygon(box, polygon)` — all four corners inside **and** no box edge
  crosses any polygon edge. The second condition is what makes this correct for
  concave zones, where all four corners can be inside while the box still
  bulges out through a notch.

#### `src/zones/filter.ts`

```ts
interface CompiledZone {
  name: string;
  polygon: Vec2[];               // normalized 0-1 (SDK's Point is 0-100)
  type: ZoneType;                // 'intersect' | 'contain'
  filter: ZoneFilter;            // 'include' | 'exclude'
  labels: Set<DetectionLabel>;   // empty = applies to all labels
  isPrivacyMask: boolean;
}

export function compileZones(zones: DetectionZone[]): CompiledZone[];

export function keepDetection(
  box: BoundingBox,
  label: DetectionLabel,
  zones: CompiledZone[],
): boolean;

export type ZoneDecision =
  | { kind: 'report'; detections: AmcrestDetection[] }
  | { kind: 'skipped'; detections: AmcrestDetection[]; reason: 'deactivation' | 'no-coordinates' }
  | { kind: 'suppress' };

export function decideObjectEvent(
  c: Extract<AmcrestClassification, { kind: 'object' }>,
  zones: CompiledZone[],
): ZoneDecision;
```

`compileZones` runs once per zone-list change, not per event. It divides
coordinates by 100 and drops degenerate polygons (fewer than three points).

The plugin's object categories are `'person'` and `'vehicle'`, which are
literal members of the SDK's `DETECTION_LABELS`. No mapping table is needed.

### Zone matching semantics

Define `inZone(box, z)` as `boxInsidePolygon` when `z.type === 'contain'`, else
`boxIntersectsPolygon`. `keepDetection` resolves in this order:

1. **Privacy masks win outright.** Any applicable privacy zone that *fully
   contains* the box drops the detection. Fully-contains regardless of the
   zone's `type`, per the SDK's wording: "detections fully inside it are
   dropped".
2. **Applicable zones** are non-privacy zones whose `labels` is empty or
   contains this label.
3. **No applicable zones means keep.** This is what makes the feature invisible
   to users who have not drawn zones, and why no opt-in setting is required.
4. **Exclude gate.** Any applicable `exclude` zone where `inZone` is true drops
   the detection.
5. **Include gate.** If applicable `include` zones exist, at least one must
   satisfy `inZone`, otherwise drop. If only exclude zones apply, surviving
   step 4 is sufficient.

`type` therefore decides what "in the zone" means; `filter` decides whether
being in it qualifies or disqualifies:

| | `include` | `exclude` |
| --- | --- | --- |
| **intersect** | alert if the object touches the zone at all | drop if it touches the zone at all |
| **contain** | alert only if the object is wholly inside | drop only if it is wholly inside |

#### Guidance on drawing zones

The implementation is fully general, but `contain` + `include` is the strict
combination and the one that misfires in practice:

- A person entering from the frame edge is only partially inside for the first
  several frames. Under `intersect` they alert immediately; under `contain`
  they do not alert until wholly inside — and if the firmware does not re-emit
  per track (see "Known limitations"), they may never alert.
- A person close to the camera has a large bounding box. If the zone is a
  modest patch of driveway, that box may never fit wholly inside it, so they
  never alert even while standing in the middle of the zone.

`contain` + `exclude` is the safe and useful pairing: "ignore things wholly
inside the neighbour's yard", where someone straddling the boundary still
alerts.

Recommended default: **`intersect` for include zones, `contain` for exclude
zones.** This is guidance for how zones are drawn, not a code behaviour.

A "centre point in zone" mode would be more robust than either for the
walk-in case, and is deliberately **not** added: `DetectionZone` has no way to
express it, so it would mean a plugin setting that contradicts the zone editor
the user is drawing in.

### Wiring into `camera.ts`

`dispatchEvent` (`src/camera.ts:363`) is already the single choke point for
every event.

New state on `AmcrestCamera`:

```ts
private zones: CompiledZone[] = [];
private zonesSub?: Disposable;
```

In `initialize()`, seed from the current value and subscribe for live edits:

```ts
this.zones = compileZones(this.cameraDevice.detectionZones ?? []);
this.zonesSub = this.cameraDevice
  .onPropertyChange('detectionZones')
  .subscribe(({ newData }) => {
    this.zones = compileZones(newData ?? []);
  });
```

`destroy()` calls `this.zonesSub?.dispose()` alongside existing teardown.

The `case 'object'` branch calls `decideObjectEvent` and switches on the
result: report on `report` and `skipped`; log once per camera+category when
`reason === 'no-coordinates'`; do nothing on `suppress`. All filtering logic
stays pure and in `filter.ts`; only the logging side effect lives in
`camera.ts`.

The `motion`, `audio` and `doorbell` branches are unchanged.

`AmcrestObjectSensor` requires **no changes**. `report()` and `pulse()` stay
unaware of zones; filtering happens before they are called.

### Decision rules

Resolved in this order inside `decideObjectEvent`:

1. **Deactivations always pass, unfiltered.** If `!c.active`, return `skipped`
   with reason `'deactivation'`. This is load-bearing: `Stop` payloads carry no
   boxes, so a filtered `Stop` would be suppressed and the sensor would latch
   active indefinitely.
2. **Boxless activations pass** (fail-open). If the activation carries no
   detections, return `skipped` with reason `'no-coordinates'`. Rationale: a
   terse firmware payload must never cost a real person detection. The caller
   logs this once per camera+category so the situation is diagnosable.
3. **Otherwise filter** each detection through `keepDetection`. No survivors →
   `suppress`. Survivors → `report` carrying **only those**, so camera.ui's
   bounding-box overlay shows the object that mattered and not the one on the
   pavement.

### Edge cases

- **Suppressed `Start`, then a `Stop` arrives.** `report(category, false)` on a
  never-activated category: `object.ts` performs a no-op `delete` then
  `emit()`, which re-derives state from whatever else is active. It re-reports
  a `false` that was already `false`. Harmless; no change to `object.ts`.
- **Mixed event.** A person in-zone plus a person on the pavement passes,
  carrying only the in-zone person.
- **Zones edited mid-track.** The next event uses the new list; anything
  currently latched stays until its `Stop`. Re-evaluating latched state would
  require boxes no longer held.
- **No zones drawn.** `compileZones([])` returns `[]`, step 3 keeps everything.
  The change is a strict no-op for users without zones.

### Logging

Suppressions log at `debug`, naming the zone responsible:

```
SmartMotionHuman suppressed: box [0.71,0.33,0.09,0.21] outside include zone 'Driveway'
```

Without this, "it is quieter now" is unfalsifiable, and user bug reports are
not actionable. The `no-coordinates` warning is emitted once per
camera+category, reusing the pattern already established by
`UnhandledCodeTracker`.

## Known limitations

**Filtering uses the box present at `Start`.** If a person is first detected at
the frame edge outside the zone and then walks into it, and the firmware does
not re-emit for that track, no alert is produced. This is inherent to
event-based filtering, not a defect.

Whether it bites depends on whether the hardware emits repeated or `State`
events per track. If it does, the limitation disappears by itself, since each
re-emission is re-tested. Verification step 1 below answers this, and it must
be answered before any code is written — if tracks do not re-emit, `contain`
include-zones should be reconsidered entirely.

## Testing

### `src/zones/geometry.test.ts`

Cases chosen because naive implementations get them wrong:

- `pointInPolygon`: inside, outside, on-vertex, on-edge, inside a concave notch.
- `boxIntersectsPolygon`: box corner in polygon; polygon vertex in box; **edge
  crossing where neither shape contains the other's vertices** (a thin polygon
  slicing across a box — the case a corners-only check misses); disjoint; box
  fully containing the polygon.
- `boxInsidePolygon`: fully inside convex; fully inside concave; **all four
  corners inside but the box bulges out through a concave notch** (must be
  `false` — the reason the edge-crossing check exists); partial overlap;
  disjoint.

### `src/zones/filter.test.ts`

`compileZones`: scales 0–100 to 0–1, drops polygons with fewer than three
points, handles the empty list.

`keepDetection`, as a table test: no zones keeps; each of the four
`type` × `filter` combinations at full, partial and no overlap; label mismatch
means the zone is ignored entirely; empty `labels` applies to all labels;
privacy mask drops even when an include zone also matches (ordering); multiple
include zones where only the second matches; exclude-only zones where nothing
excludes.

`decideObjectEvent`, including the two regressions that matter most:

- **A deactivation whose box would fail every zone still reports.** If this
  goes red, the sensor latches on forever.
- A boxless activation returns `skipped` / `'no-coordinates'`, never
  `suppress`.
- Mixed detections return only survivors; all-dropped returns `suppress`; the
  pulse path is treated identically.

### `src/sensors/object.test.ts`

One addition: `report(category, false)` on a never-activated category, while a
different category is active, must leave the active category alone.

### Hardware verification

Step 1 happens **before** any code is written.

1. Run `npm run watch-events -- --ip <noisy camera>` for a meaningful window.
   Establishes which codes actually fire, whether they carry
   `Rect` / `BoundingBox`, and **whether a single track re-emits**. The third
   determines whether the walk-in limitation is theoretical or routine.
2. Draw an exclude zone over the noisy area; confirm suppression lines appear
   in the debug log naming the correct zone.
3. Draw an include zone; walk into it; confirm the alert fires **and** the
   bounding-box overlay shows only the surviving object.
4. Walk out; confirm the sensor clears and does not latch. Highest-risk
   regression, so it gets a manual check despite being unit-tested.

Existing tests should be unaffected. `npm test` already globs
`src/**/*.test.ts`, so new files are picked up automatically.

## Acceptance criteria

- Detections whose bounding box fails the camera.ui zone test do not reach the
  object sensor.
- Detections whose label is excluded by every applicable zone do not reach the
  object sensor.
- Events carrying multiple objects report only the objects that survive
  filtering.
- Deactivation (`Stop`) events are never suppressed; the object sensor cannot
  latch active as a result of this change.
- Activations carrying no coordinates are reported, and log once per
  camera+category at `debug`.
- Zone edits in camera.ui take effect without restarting the plugin.
- With no zones drawn, behaviour is byte-for-byte unchanged.
- The motion, audio and doorbell sensors are unaffected.
- `npm run bundle` passes (format, lint, test, build).
