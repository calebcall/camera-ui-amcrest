# Instrument the zone walk-in case, and make passing zone evaluation observable

Date: 2026-07-30
Status: Approved, pending implementation plan
Issues: #26 (walk-in miss), #27 (no positive log signal)

## Problem

Two findings from 1.4.0 hardware verification, both about the same blind spot.

### #26 — objects that enter the zone after the Start event are missed

`decideObjectEvent` filters on the box present at the `Start` event. Hardware confirms the camera emits **exactly one `Start` and one `Stop` per track, with no intermediate updates**, and the two boxes can describe completely different parts of the frame:

| | Start | Stop | Gap |
| --- | --- | --- | --- |
| `SmartMotionVehicle` (track 48884) | `[0.477, 0.099, 0.060, 0.063]` | `[0.602, 0.110, 0.043, 0.046]` | 30s |
| `SmartMotionHuman` | `[0.552, 0.289, 0.084, 0.369]` | `[0.152, 0.716, 0.178, 0.281]` | 57s |

The person's `Start` box spans x 0.552–0.636, y 0.289–0.658; the `Stop` box spans x 0.152–0.330, y 0.716–0.997. Disjoint — opposite corners.

So someone entering frame outside an include zone and then walking into it produces a suppressed `Start`, then a `Stop` that passes through as a deactivation, and therefore **no alert** — despite the object spending most of the event inside the zone.

The README currently frames this as conditional on whether the firmware re-emits. It does not re-emit, so the limitation is unconditional.

### #27 — a cleanly-passing detection logs nothing

`dispatchEvent`'s `case 'object'` logs only on `suppress`, on boxless (once per code+category), and on a partially-filtered `report`. A detection that passes its zones is silent, which makes the working case unobservable and indistinguishable from zones not being applied at all: an empty zone list also produces a notification and silence.

This caused real confusion during verification — confirming an include zone worked required deliberately drawing it somewhere the object would not be, to force a suppression.

## Why instrument rather than fix

The walk-in case has **not yet cost a real alert** in practice. Building the retrospective-alert behaviour now would mean shipping unclear UX to solve a problem with no measured frequency:

- The notification would fire as the object **leaves**, up to a minute late.
- camera.ui begins its event recording when the sensor activates, so the attached footage would start as the object walks away — arguably worse than the current silence.

Instrumenting first converts a guess into data. A week of logs answers both *how often* it happens and *where*, and the second may show that simply enlarging the zone fixes it with no code at all.

The state this instrumentation needs is the same state the real fix needs. If the data justifies the fix, turning the log into an alert is a small change in one place, against a mechanism already built and tested.

### Rejected alternatives

**Ship the retrospective alert now.** Rejected: unclear UX, unmeasured frequency, and the recording-start problem above.

**Docs only.** Rejected: correct but leaves no way to learn whether this matters.

**Use a continuous position stream.** Investigated and rejected on evidence: `VideoMotionInfo action=State` fires constantly during motion but carries **no payload at all** in real captures — just the code line, no `data={…}`. It is a pure "motion still happening" heartbeat. There is no continuous position available, so the design space is genuinely limited to the `Start` box and the `Stop` box.

(Noted for the record: `VideoMotion action=Start` does carry `RegionName: ["Area1"]`, the camera-side motion region that fired. Not usable against camera.ui polygons, but it exists.)

## Constraints

**`decideObjectEvent` is not modified.** It carries the latch guarantee, it is deliberately pure and stateless, and it cannot know that a prior `Start` was suppressed. Leaving it untouched is the largest available risk reduction in this change.

**The deactivation path still always reports.** The new logic on that path only reads and logs. A filtered `Stop` would leave the object sensor latched active indefinitely; that guarantee is covered by tests at both the `filter.ts` and `object.ts` levels and is not in play here.

**No behaviour change.** Every sensor call this change makes is identical to 1.4.0's. Only log output differs.

## Design

### Modules

#### `src/zones/filter.ts`

One new pure function, and one existing helper promoted to exported:

```ts
/** The first detection these zones would keep, or undefined if none would. */
export function findKeptDetection(
  detections: AmcrestDetection[],
  label: DetectionLabel,
  zones: CompiledZone[],
): AmcrestDetection | undefined;

/** Already present, currently private. Renders `box [x,y,w,h]` at 2dp. */
export function describeBox(box: BoundingBox): string;
```

`findKeptDetection` returns the detection rather than a boolean so the log line can name the box that would have qualified.

#### `src/camera.ts`

New state, alongside the existing `zones` and `boxlessWarned` fields:

```ts
/** Categories whose activation zones suppressed, with the reason, awaiting a Stop. */
private suppressedStarts = new Map<string, string>();
```

Flow:

- On a `suppress` decision, record `category → reasons.join('; ')` — **only when `!c.momentary`**. A Pulse never receives a matching `Stop`, so recording one would leave an entry that is never reconsidered and never cleared.
- On the deactivation path (`kind === 'skipped'` and `reason === 'deactivation'`), if an entry exists for that category, call `findKeptDetection` against the `Stop`'s detections. Log the hit or the miss line. Clear the entry either way.
- **If the `Stop` carries no usable coordinates, log neither line** and clear the entry. Reuse the same test the gating path uses — a detection whose box has zero width or height counts as carrying nothing. A coordinate-free `Stop` means we cannot tell whether the object entered the zone, and claiming it "stayed outside for the whole event" would be a false statement in the log. Silence is correct here; the boxless case is already reported once per code+category by `warnBoxless`.
- Report to the sensor exactly as before, on every path.

Hygiene:

- The map is cleared on **event-stream reconnect** — specifically in `runEventLoop`, on the path that schedules the reconnect, alongside the existing backoff bookkeeping. A reconnect means track continuity is lost, so a stale suppression could otherwise pair with an unrelated `Stop` minutes later and produce a misleading line. Also cleared in `destroy()`.
- Bounded at two entries (`person`, `vehicle`), so there is no growth concern even if a `Stop` never arrives.

### Log lines

All at `debug`, all guarded on `this.zones.length > 0`, matching the existing `warnBoxless` guard, so users with no zones drawn see nothing new.

**#26 hit** — the line this change exists to produce. It is a **single** log call; wrapped here only to fit the page:

```
SmartMotionHuman entered the zones during the event — no alert was sent (see #26). Stop box [0.15,0.72,0.18,0.28] would pass; Start was suppressed: box [0.55,0.29,0.08,0.37] outside include zone(s) 'sideyard'
```

Carries both boxes and the original suppression reason, so the logs report not only how often this happens but where — which may show that enlarging the zone resolves it without code.

Note that `describeBox` already emits its own `box ` prefix, and the recorded suppression reason already reads `box [...] outside include zone(s) '...'`, so neither is prefixed again when interpolated.

**#26 miss** — terse:

```
SmartMotionVehicle stayed outside the zones for the whole event — correctly suppressed
```

This doubles the line count on a street-facing camera, which is the cost. Without it a silent log is ambiguous between "never happens" and "instrumentation broken" — the same blindness #27 exists to fix, which should not be reproduced in the change that fixes it.

**#27 pass-through:**

```
SmartMotionHuman passed detection zones (1 zone(s)): box [0.38,0.32,0.10,0.51]
```

Emitted only when `kind === 'report'` **and** `dropped.length === 0`. If anything was dropped, the existing `partially filtered by detection zones` line already fires and names what went, so this would be duplicate. Deactivations are `skipped` rather than `report` and never reach this path, so it stays at one line per passing activation.

Volume is acceptable: these are per-track events, not per-frame. Real captures show roughly two smart events per two minutes. This is not `VideoMotionInfo`.

### README changes

- **Known limitation** — remove the conditional framing. State it as fact, with the evidence: one `Start`, one `Stop`, 30–60 seconds apart, boxes potentially disjoint, so an object that enters the zone after its first detection produces no alert.
- **`contain` + `include` guidance** — strengthen from "misfires in two common ways" to the accurate statement that it will miss almost anything that does not begin wholly inside the zone.
- **Diagnostics section** — document the three new log lines and what each means.

## Testing

### `src/zones/filter.test.ts`

`findKeptDetection`: one detection passing; none passing; an empty zone list (everything passes, so the first detection returns); an empty detection list (undefined).

### `src/camera.test.ts`

The existing harness already captures both sensor calls and `debug` output, so no new test scaffolding is needed.

- Suppressed `Start`, then a `Stop` whose box would pass ⇒ the hit line fires, **and the deactivation still reports to the sensor**
- Suppressed `Start`, then a `Stop` that also fails ⇒ the miss line, and no hit line
- Suppressed `Start`, then a `Stop` carrying no usable coordinates ⇒ neither line, and the entry is cleared
- A **momentary** suppression is never recorded, so a later unrelated `Stop` produces no #26 line
- A passing `Start` ⇒ the #27 line; the same event with no zones ⇒ no new lines
- A partially filtered event ⇒ `partially filtered` only, not the pass line
- The map clears on event-stream reconnect, so a stale suppression cannot pair with an unrelated `Stop`

The momentary case and the "deactivation still reports" case are the two a plausible implementation gets wrong quietly.

## Acceptance criteria

- A suppressed activation followed by a `Stop` that would pass the zones logs the #26 hit line, naming both boxes and the original suppression reason.
- A suppressed activation followed by a `Stop` that also fails logs the miss line.
- A suppressed activation followed by a `Stop` carrying no usable coordinates logs **neither** line, since whether the object entered is unknowable.
- A momentary (`Pulse`) suppression is never recorded and never produces a #26 line.
- A cleanly-passing activation logs the #27 line; a partially filtered one does not.
- With no zones drawn, no new log lines are emitted.
- **Every sensor call is byte-for-byte identical to 1.4.0.** No behaviour change.
- The object sensor cannot latch as a result of this change.
- The README states the walk-in limitation unconditionally and documents the new log lines.
- `npm run bundle` passes, and `npm run zone-fuzz` reports 0 false positives and 0 false negatives.
