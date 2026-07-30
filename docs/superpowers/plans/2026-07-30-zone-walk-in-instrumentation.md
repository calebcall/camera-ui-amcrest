# Zone Walk-In Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two currently-invisible zone outcomes visible in the log — an object that entered a zone after its activation was suppressed (#26), and an activation that passed its zones cleanly (#27) — without changing any behaviour.

**Architecture:** `decideObjectEvent` is deliberately left untouched; it carries the latch guarantee and is pure. One new pure lookup goes into `src/zones/filter.ts`, the small amount of new state lives in `src/camera.ts` beside the existing `zones` and `boxlessWarned` fields, and every sensor call remains byte-for-byte identical to 1.4.0.

**Tech Stack:** TypeScript 5.9 (strict, NodeNext, `verbatimModuleSyntax`), Node >= 24, `node:test` + `node:assert/strict`, `@camera.ui/sdk` 0.0.33, eslint 9 + `@stylistic`, prettier.

**Spec:** `docs/superpowers/specs/2026-07-30-zone-walk-in-instrumentation-design.md`

**Tracking:** #26 (walk-in instrumentation) and #27 (pass-through logging), bundled.

## Global Constraints

- **No behaviour change.** Every sensor call this plan produces must be identical to 1.4.0's. Only log output differs. If you find yourself changing what `report()` or `pulse()` receives, stop and report it.
- **`decideObjectEvent` is not modified.** It carries the latch guarantee, it is pure and stateless, and it cannot know a prior `Start` was suppressed.
- **The deactivation path still always reports.** New logic there only reads and logs. A filtered `Stop` would latch the object sensor active indefinitely.
- Relative imports MUST end in `.js` (NodeNext resolution).
- Type-only imports MUST use `import type` — `@typescript-eslint/consistent-type-imports` is `error`.
- **Source files use SINGLE quotes; test files use DOUBLE quotes.** `eslint.config.js:12` ignores `**/*.test.ts`, so prettier's default applies there. Getting this backwards means `npm run bundle` rewrites your files.
- Trailing commas on multiline, semicolons always, 2-space indent, max line length 170.
- **Never** add `Co-Authored-By` lines or any Claude/AI attribution to commits. Hard rule from the repo owner.
- Commit messages reference the issue inline, e.g. `feat: log when an object enters a zone after suppression (#26)`.
- Prettier strips clarifying parentheses, after which `@stylistic/no-mixed-operators` can reject a line mixing relational and equality operators. If that happens, extract operands into named booleans rather than fighting the formatter.
- Run `npm test` during TDD loops. Run `npm run bundle` once before the final commit of each task. Run `npm run zone-fuzz` before the final commit of Task 1 — it must report 0 false positives and 0 false negatives.

**Unrelated deprecation, do not act on it:** #28 tracks migrating off `cameraDevice.addSensor`, which `@camera.ui/sdk` 0.0.33 deprecates. It is out of scope here. If the test suite emits a deprecation warning, note it in your report but do not fix it — test output noise is normally a finding, and this is the one documented exception.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/zones/filter.ts` (modify) | Gains `findKeptDetection` and `hasUsableCoordinates`; `describeBox` becomes exported. Stays pure — no logging, no state. |
| `src/zones/filter.test.ts` (modify) | Unit tests for the two new pure functions. |
| `src/camera.ts` (modify) | Gains the `suppressedStarts` map, two private logging methods, and three call sites in `dispatchEvent`. Owns all state and all logging. |
| `src/camera.test.ts` (modify) | Tests the wiring through `dispatchEvent` against the existing fake-sensor harness. |
| `README.md` (modify) | Corrects the walk-in limitation from conditional to factual; strengthens the `contain` guidance; documents the new log lines. |

`src/zones/geometry.ts`, `src/sensors/object.ts` and `src/amcrest/classify.ts` are **not** modified.

---

### Task 1: Pure lookups in `filter.ts`

Issue #26/#27. Branch `26-instrument-zone-walk-in` **already exists** and already contains the spec commit — check it out, don't recreate it.

**Files:**
- Modify: `src/zones/filter.ts`
- Test: `src/zones/filter.test.ts`

**Interfaces:**
- Consumes: `keepDetection(box, label, zones): ZoneVerdict` and the private `hasCoordinates(detection): boolean`, both already in `filter.ts`. `AmcrestDetection` is `{ box: BoundingBox; trackId?: number }`.
- Produces:
  - `findKeptDetection(detections: AmcrestDetection[], label: DetectionLabel, zones: CompiledZone[]): AmcrestDetection | undefined`
  - `hasUsableCoordinates(detections: AmcrestDetection[]): boolean`
  - `describeBox(box: BoundingBox): string` — already exists as a private function, becomes exported. Renders `box [x,y,w,h]` at 2 decimal places.

- [ ] **Step 1: Check out the branch**

```bash
git checkout 26-instrument-zone-walk-in
git status
```

Expected: on branch `26-instrument-zone-walk-in`, clean tree, the spec already committed.

- [ ] **Step 2: Write the failing tests**

Append to `src/zones/filter.test.ts`, and add `findKeptDetection` and `hasUsableCoordinates` to the existing import from `./filter.js`. Note the double quotes — test files are eslint-ignored, prettier default applies. `INSIDE`, `OUTSIDE` and `zone()` already exist at the top of that file; reuse them.

```ts
test("findKeptDetection returns the first detection the zones keep", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  const kept = findKeptDetection(
    [{ box: OUTSIDE }, { box: INSIDE, trackId: 9 }],
    "person",
    zones,
  );
  assert.equal(kept?.trackId, 9);
});

test("findKeptDetection returns undefined when the zones keep none", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  assert.equal(
    findKeptDetection([{ box: OUTSIDE }], "person", zones),
    undefined,
  );
});

test("findKeptDetection keeps the first detection when there are no zones", () => {
  // No zones means nothing gates, so the first detection qualifies.
  const kept = findKeptDetection([{ box: OUTSIDE, trackId: 3 }], "person", []);
  assert.equal(kept?.trackId, 3);
});

test("findKeptDetection returns undefined for an empty detection list", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  assert.equal(findKeptDetection([], "person", zones), undefined);
});

test("hasUsableCoordinates rejects an empty list and zero-area boxes", () => {
  assert.equal(hasUsableCoordinates([]), false);
  assert.equal(
    hasUsableCoordinates([{ box: { x: 0.1, y: 0.1, width: 0, height: 0.2 } }]),
    false,
  );
  assert.equal(
    hasUsableCoordinates([
      { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
    ]),
    true,
  );
});

test("hasUsableCoordinates accepts a reversed box", () => {
  // geometry.ts normalizes reversed extents, so a back-to-front Rect carries a
  // real position and must not be mistaken for a coordinate-free payload.
  assert.equal(
    hasUsableCoordinates([
      { box: { x: 0.9, y: 0.9, width: -0.1, height: -0.1 } },
    ]),
    true,
  );
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: FAIL — `findKeptDetection is not a function` (or a TS import error for the missing exports).

- [ ] **Step 4: Export `describeBox`**

In `src/zones/filter.ts`, change the declaration:

```ts
export function describeBox(box: BoundingBox): string {
```

Leave its body and its existing callers untouched.

- [ ] **Step 5: Add the two new functions**

Add to `src/zones/filter.ts`, immediately after the existing private `hasCoordinates` function. Single quotes — this is a source file.

```ts
/**
 * True if any of these detections carries a usable position. Wraps the
 * per-detection test so callers outside this module can ask the same question
 * the gating path asks, rather than reimplementing it and drifting.
 */
export function hasUsableCoordinates(detections: AmcrestDetection[]): boolean {
  return detections.some(hasCoordinates);
}

/**
 * The first detection these zones would keep, or undefined if none would.
 *
 * Returns the detection rather than a boolean so a caller can name the box that
 * qualified — the walk-in log line in `camera.ts` reports it.
 */
export function findKeptDetection(
  detections: AmcrestDetection[],
  label: DetectionLabel,
  zones: CompiledZone[],
): AmcrestDetection | undefined {
  return detections.find((d) => keepDetection(d.box, label, zones).keep);
}
```

- [ ] **Step 6: Use the new wrapper in `decideObjectEvent`**

In `decideObjectEvent`, replace the existing coordinate guard so there is one expression of this rule rather than two. Find:

```ts
  if (!detections.some(hasCoordinates)) {
```

Replace with:

```ts
  if (!hasUsableCoordinates(detections)) {
```

This is the only permitted edit to `decideObjectEvent` — a pure substitution with identical semantics. Do not change anything else in it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: PASS, 36 tests.

- [ ] **Step 8: Run the full suite and the fuzz**

Run: `npm test`
Expected: PASS, 180 tests.

Run: `npm run zone-fuzz`
Expected: `falsePositives=0 falseNegatives=0` and `zone-fuzz OK`. Step 6 touched a gating path, so this is the check that it is genuinely a no-op.

- [ ] **Step 9: Run the bundle**

Run: `npm run bundle`
Expected: format, lint, test, build and `cui bundle` all succeed. May reformat files; that is fine.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add zone lookups for instrumentation (#26, #27)"
```

---

### Task 2: Wire the logging into `camera.ts`

Issue #26/#27. Continues on the same branch — do **not** create a new branch, and do not merge anything.

**Files:**
- Modify: `src/camera.ts` — imports; new field beside `boxlessWarned` (~line 84); the `case 'object'` branch of `dispatchEvent` (~line 401); two new private methods; the reconnect path in `runEventLoop`; `destroy()`.
- Test: `src/camera.test.ts`

**Interfaces:**
- Consumes: `findKeptDetection`, `hasUsableCoordinates`, `describeBox` from `./zones/filter.js` (Task 1), plus the already-imported `compileZones` and `decideObjectEvent`. `ZoneDecision` variants are `{ kind: 'report'; detections; dropped: string[] }`, `{ kind: 'skipped'; detections; reason: 'deactivation' | 'no-coordinates' }`, `{ kind: 'suppress'; reasons: string[] }`.
- Produces: nothing consumed by later tasks. Task 3 documents the log lines this task emits.

- [ ] **Step 1: Write the failing tests**

Append to `src/camera.test.ts`. Double quotes — test file. `DRIVEWAY`, `human()`, `INSIDE_RECT`, `OUTSIDE_RECT` and `harness()` already exist in that file; reuse them.

First, extend the harness so a test can do what a stream reconnect does. In the `CameraInternals` interface add:

```ts
  suppressedStarts: Map<string, string>;
```

and in `harness()`'s return statement add a `forget` member:

```ts
  return {
    dispatch: (blob) => internals.dispatchEvent(blob),
    forget: () => internals.suppressedStarts.clear(),
    calls,
    debug,
  };
```

Update `harness()`'s return type annotation to include `forget: () => void`.

Then append these tests:

```ts
/** Two objects in one event: one inside the zone, one outside it. */
const MIXED_HUMANS =
  'Code=SmartMotionHuman;action=Start;index=0;data={"object":' +
  '[{"Rect":[3000,3000,4000,4000],"HumanID":1},' +
  '{"Rect":[7000,7000,7500,7500],"HumanID":2}]}';

test("dispatchEvent: an object that enters the zones after a suppressed Start is logged, not alerted", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  const hit = h.debug.find((l) =>
    l.includes("entered the zones during the event"),
  );
  assert.ok(hit, `expected the walk-in line, got: ${JSON.stringify(h.debug)}`);
  assert.ok(hit.includes("Stop box [0.37,0.37,0.12,0.12]"), hit);
  assert.ok(
    hit.includes("box [0.85,0.85,0.06,0.06] outside include zone(s) 'Driveway'"),
    hit,
  );

  // Observation only. No activation was synthesised, and the deactivation still
  // reported — exactly what 1.4.0 did.
  assert.deepEqual(
    h.calls.map((c) => ({ method: c.method, active: c.active })),
    [{ method: "report", active: false }],
  );
});

test("dispatchEvent: an object that stays outside the zones logs the miss, not the walk-in", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch(human("Stop", OUTSIDE_RECT));

  assert.ok(
    h.debug.some((l) =>
      l.includes("stayed outside the zones for the whole event"),
    ),
    `expected the miss line, got: ${JSON.stringify(h.debug)}`,
  );
  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
});

test("dispatchEvent: a coordinate-free Stop after a suppressed Start claims nothing either way", () => {
  // Neither line is true here: with no position on the Stop, whether the object
  // entered the zone is unknowable, and saying it stayed outside would be false.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.dispatch("Code=SmartMotionHuman;action=Stop;index=0");

  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
  assert.ok(!h.debug.some((l) => l.includes("stayed outside the zones")));
});

test("dispatchEvent: a suppressed Pulse is not remembered, so a later Stop says nothing about it", () => {
  // A Pulse never receives a matching Stop. Remembering one would leave an entry
  // that an unrelated later Stop would wrongly be measured against.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Pulse", OUTSIDE_RECT));
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
  assert.ok(!h.debug.some((l) => l.includes("stayed outside the zones")));
});

test("dispatchEvent: a cleanly passing activation says so", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", INSIDE_RECT));

  assert.ok(
    h.debug.some(
      (l) =>
        l.includes("passed detection zones (1 zone(s))") &&
        l.includes("box [0.37,0.37,0.12,0.12]"),
    ),
    `expected the pass-through line, got: ${JSON.stringify(h.debug)}`,
  );
});

test("dispatchEvent: a partially filtered event reports the partial line, not the pass line", () => {
  const h = harness([DRIVEWAY]);

  h.dispatch(MIXED_HUMANS);

  assert.ok(
    h.debug.some((l) => l.includes("partially filtered by detection zones")),
    `expected the partial line, got: ${JSON.stringify(h.debug)}`,
  );
  assert.ok(
    !h.debug.some((l) => l.includes("passed detection zones")),
    "the partial line already names what was dropped; the pass line would duplicate it",
  );
  assert.equal(h.calls[0].detections.length, 1);
  assert.equal(h.calls[0].detections[0].trackId, 1);
});

test("dispatchEvent: a suppression forgotten on reconnect is not measured against a later Stop", () => {
  // What runEventLoop does when the stream drops: track continuity is gone, so a
  // pending suppression must not be paired with an unrelated Stop minutes later.
  const h = harness([DRIVEWAY]);

  h.dispatch(human("Start", OUTSIDE_RECT));
  h.forget();
  h.dispatch(human("Stop", INSIDE_RECT));

  assert.ok(
    !h.debug.some((l) => l.includes("entered the zones during the event")),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test src/camera.test.ts`
Expected: FAIL — the walk-in, miss and pass-through lines do not exist yet, and `suppressedStarts` is undefined on the instance so `h.forget()` throws.

- [ ] **Step 3: Add the imports**

In `src/camera.ts`, extend the existing value import from `./zones/filter.js`:

```ts
import {
  compileZones,
  decideObjectEvent,
  describeBox,
  findKeptDetection,
  hasUsableCoordinates,
} from './zones/filter.js';
```

Add `DetectionLabel` to the `@camera.ui/sdk` type-import list, keeping it alphabetical:

```ts
import type {
  CameraDevice,
  DetectionLabel,
  DeviceStorage,
  Disposable,
  LoggerService,
  SnapshotInterface,
  StreamingInterface,
} from '@camera.ui/sdk';
```

Add `AmcrestDetection` to the local type imports:

```ts
import type { AmcrestDetection } from './amcrest/classify.js';
```

- [ ] **Step 4: Add the field**

Immediately after the existing `boxlessWarned` field:

```ts
  /**
   * Categories whose activation the zones suppressed, keyed to the reason,
   * awaiting a Stop that might show the object moved into a zone after all.
   * Bounded at two entries (person, vehicle). See reviewSuppressedStart.
   */
  private readonly suppressedStarts = new Map<string, string>();
```

- [ ] **Step 5: Replace the `case 'object'` branch**

Replace the whole branch with:

```ts
      case 'object': {
        const decision = decideObjectEvent(c, this.zones);
        if (decision.kind === 'suppress') {
          const reason = decision.reasons.join('; ');
          this.log.debug(
            `${ev.code} suppressed by detection zones: ${reason}`,
          );
          // A Pulse never gets a matching Stop, so there would be nothing to
          // reconsider this against and the entry would never clear.
          if (!c.momentary) this.suppressedStarts.set(c.category, reason);
          break;
        }
        if (
          decision.kind === 'skipped' &&
          decision.reason === 'no-coordinates'
        ) {
          this.warnBoxless(ev.code, c.category);
        }
        if (decision.kind === 'skipped' && decision.reason === 'deactivation') {
          this.reviewSuppressedStart(ev.code, c.category, decision.detections);
        }
        if (decision.kind === 'report' && decision.dropped.length > 0) {
          this.log.debug(
            `${ev.code} partially filtered by detection zones: ${decision.dropped.join('; ')}`,
          );
        }
        if (decision.kind === 'report' && decision.dropped.length === 0) {
          this.logZonePass(ev.code, decision.detections);
        }
        if (c.momentary) {
          this.object?.pulse(c.category, decision.detections);
        } else {
          this.object?.report(c.category, c.active, decision.detections);
        }
        break;
      }
```

The `pulse`/`report` calls at the bottom are unchanged from 1.4.0. That is the point.

- [ ] **Step 6: Add the two private methods**

Add next to the existing `warnBoxless` method:

```ts
  /**
   * Says whether an object whose activation the zones suppressed had, by the
   * time it left, moved somewhere those zones would have accepted.
   *
   * Observation only — see #26. The camera sends one Start and one Stop per
   * track with nothing in between, and the two boxes can be entirely disjoint,
   * so an object that walks into a zone after its Start produces no alert. This
   * records how often that happens, and where, without changing behaviour.
   */
  private reviewSuppressedStart(
    code: string,
    category: DetectionLabel,
    detections: AmcrestDetection[],
  ): void {
    const reason = this.suppressedStarts.get(category);
    if (reason === undefined) return;
    this.suppressedStarts.delete(category);

    // A Stop with no position cannot answer the question either way, and
    // claiming the object stayed outside would put a false statement in the log.
    if (!hasUsableCoordinates(detections)) return;

    const kept = findKeptDetection(detections, category, this.zones);
    if (!kept) {
      this.log.debug(
        `${code} stayed outside the zones for the whole event — correctly suppressed`,
      );
      return;
    }
    this.log.debug(
      `${code} entered the zones during the event — no alert was sent (see #26). Stop ${describeBox(kept.box)} would pass; Start was suppressed: ${reason}`,
    );
  }

  /**
   * Confirms zone evaluation ran and every detection survived. Without this, a
   * working zone is indistinguishable in the log from no zones at all — both
   * produce a notification and silence. See #27.
   */
  private logZonePass(code: string, detections: AmcrestDetection[]): void {
    if (this.zones.length === 0) return;
    const boxes = detections.map((d) => describeBox(d.box)).join(', ');
    this.log.debug(
      `${code} passed detection zones (${this.zones.length} zone(s)): ${boxes}`,
    );
  }
```

`reviewSuppressedStart` needs no zone-count guard: with no zones nothing can be suppressed, so the map is empty and it returns on the first line.

- [ ] **Step 7: Clear the map when the stream drops**

In `runEventLoop`, in the tail that schedules the reconnect, immediately before `this.eventReconnectStreak++;`:

```ts
    // Track continuity ends with the stream, so a pending suppression must not
    // be paired with an unrelated Stop after we reconnect.
    this.suppressedStarts.clear();
```

- [ ] **Step 8: Clear the map on teardown**

In `destroy()`, immediately after `this.zonesSub = undefined;`:

```ts
    this.suppressedStarts.clear();
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `node --import tsx --test src/camera.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS, 187 tests.

Pay attention to two pre-existing tests that must stay green, because they encode the no-behaviour-change constraint:

- `dispatchEvent: with no zones drawn, everything is reported unchanged` asserts `h.debug` is exactly `[]`. If your new lines are not guarded on zones being present, this goes red.
- `dispatchEvent: the deactivation still reaches the sensor after a suppressed activation` is the latch guarantee.

- [ ] **Step 11: Run the bundle**

Run: `npm run bundle`
Expected: all pass. Lint is the real gate — `camera.ts` is linted, unlike the test files, and will reject a missing `import type` or the wrong quote style.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: log zone walk-ins and clean passes (#26, #27)"
```

---

### Task 3: Correct the README

Issue #26/#27. Same branch.

**Files:**
- Modify: `README.md` — the `### Known limitation` subsection, the `contain` guidance paragraph in `### Choosing intersect or contain`, and the `### Checking what is being filtered` subsection. All three are inside the `## Detection zones` section.

**Interfaces:**
- Consumes: the log lines Task 2 emits, verbatim.
- Produces: nothing.

- [ ] **Step 1: Replace the known-limitation text**

Find this paragraph under `### Known limitation`:

```markdown
Filtering uses the position reported when the camera first detects the object. If someone is first picked up outside your zone and then walks into it, and your camera does not re-report that object as it moves, no alert is produced. Prefer `intersect` include zones drawn a little larger than the area you care about.
```

Replace with:

```markdown
Filtering uses the position reported when the camera first detects the object, because that is the only position available. The camera sends exactly one "started" and one "stopped" event per object, 30–60 seconds apart, with no updates in between — and the two positions can describe completely different parts of the frame. In one measured case a person was first seen in the upper middle of the picture and last seen in the lower left, with no overlap between the two.

So if someone is first picked up outside your zone and then walks into it, **no alert is produced**. Draw `intersect` include zones generously larger than the area you actually care about, so that the object's *first* detection already falls inside them.

Enable debug logging to see whether this is happening to you — see [Checking what is being filtered](#checking-what-is-being-filtered) below.
```

- [ ] **Step 2: Strengthen the `contain` guidance**

Find this paragraph under `### Choosing intersect or contain`:

```markdown
`contain` combined with `include` is the strict pairing, and it misfires in two common ways:
```

Replace with:

```markdown
`contain` combined with `include` is the strict pairing, and on this hardware it will miss almost anything that does not begin wholly inside the zone. Because the camera reports an object's position only once, at first detection, that single sample has to satisfy the whole zone. It misfires in two common ways:
```

Leave the two bullets that follow it unchanged.

- [ ] **Step 3: Document the new log lines**

In `### Checking what is being filtered`, find the existing fenced block:

```
SmartMotionHuman suppressed by detection zones: outside include zone(s) 'Driveway'
SmartMotionVehicle partially filtered by detection zones: inside exclude zone 'Street'
Detection zones updated: 2 zone(s)
```

Replace the whole block, and add the explanatory text after it:

```markdown
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
```

- [ ] **Step 4: Verify the README formatting**

Run: `npx prettier --check README.md`
Expected: pass. If it reports differences, run `npx prettier --write README.md`.

Read the section back and confirm the fenced blocks are all opened and closed and the two tables above them are untouched. Step 3 nests a fenced block inside a markdown insertion, which is the easiest thing to get wrong here — count your backtick fences.

- [ ] **Step 5: Run the bundle**

Run: `npm run bundle`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: state the zone walk-in limitation as fact, document the new log lines (#26, #27)"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task:

| Spec requirement | Task |
| --- | --- |
| `findKeptDetection`, exported `describeBox` | Task 1 |
| Coordinate test shared with the gating path (`hasUsableCoordinates`) | Task 1, steps 5–6 |
| `suppressedStarts` map, recorded only when `!c.momentary` | Task 2, steps 4–5 |
| Deactivation reviews the Stop box, clears the entry either way | Task 2, step 6 |
| Coordinate-free Stop logs neither line | Task 2, step 6, and its test in step 1 |
| #26 hit line with both boxes and the original reason | Task 2, step 6 |
| #26 miss line | Task 2, step 6 |
| #27 pass line, only when nothing was dropped | Task 2, steps 5–6 |
| All new lines guarded on zones being present | Task 2, step 6 (`logZonePass` explicitly; `reviewSuppressedStart` implicitly via the empty map) |
| Cleared on reconnect and on destroy | Task 2, steps 7–8 |
| README corrections | Task 3 |

All nine acceptance criteria are covered. The no-behaviour-change criterion is enforced three ways: the Global Constraints state it, Task 2 step 5 keeps the `pulse`/`report` calls byte-identical, and Task 2 step 10 names the two pre-existing tests that fail if it is violated.

**Verification gap, stated plainly.** The tests reach `suppressedStarts.clear()` through the harness's `forget()`, which proves the *consequence* — a forgotten suppression is not measured against a later Stop. They do **not** prove that `runEventLoop` and `destroy()` actually call it, because reaching the reconnect tail needs a real network failure. Those two call sites (Task 2, steps 7–8) are verified by inspection, and a reviewer should check them directly.

**Placeholder scan.** No TBD/TODO. Every code step has literal code; every test step has literal assertions. No "similar to Task N" back-references.

**Type consistency.** `findKeptDetection(detections, label, zones)` and `hasUsableCoordinates(detections)` have the same argument order in Task 1's definitions, Task 1's tests, and Task 2's call sites. `describeBox` already emits its own `box ` prefix, so the #26 line writes `Stop ${describeBox(...)}` rather than `Stop box ${...}` — and the recorded suppression reason already begins `box [...]`, so it is interpolated bare. `reviewSuppressedStart(code, category, detections)` takes `category: DetectionLabel`, and `c.category` is `'person' | 'vehicle'`, which is assignable without a cast — if you find yourself needing one, the import in step 3 is missing.

**Expected test counts.** Task 1 takes `filter.test.ts` from 30 to 36 and the suite from 174 to 180. Task 2 takes `camera.test.ts` from 7 to 14 and the suite to 187. If your numbers differ, something did not run — investigate before proceeding rather than adjusting the plan.

**Verified before writing, not assumed.** The two box strings the tests assert were computed through the same `toFixed(2)` pipeline `describeBox` uses: `INSIDE_RECT` renders `box [0.37,0.37,0.12,0.12]` and `OUTSIDE_RECT` renders `box [0.85,0.85,0.06,0.06]`. The suppression reason interpolated into the walk-in line was produced by running the real `keepDetection` and is exactly `box [0.85,0.85,0.06,0.06] outside include zone(s) 'Driveway'`. `MIXED_HUMANS` was parsed and run through `decideObjectEvent`, returning `report` with `kept=1, dropped=1`. A `Stop` carrying a `Rect` was confirmed to reach the deactivation branch with its detections intact, which is what makes the walk-in review possible at all.
