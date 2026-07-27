# camera.ui Detection Zone Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make detection zones drawn in camera.ui actually filter the object events this plugin reports from the camera's native event stream.

**Architecture:** Two new pure modules under `src/zones/` — `geometry.ts` (polygon maths in normalized 0-1 space, no camera.ui types) and `filter.ts` (compiles `DetectionZone[]` and turns a classified object event into a report/skip/suppress decision). `src/camera.ts` reads `cameraDevice.detectionZones`, subscribes to changes, and applies the decision inside its existing `dispatchEvent` choke point. Nothing is written to the camera; the object sensor is unchanged.

**Tech Stack:** TypeScript 5.9 (strict, NodeNext, `verbatimModuleSyntax`), Node >= 22, `node:test` + `node:assert/strict`, `@camera.ui/sdk` 0.0.22, eslint 9 + `@stylistic`, prettier.

**Spec:** `docs/superpowers/specs/2026-07-27-camera-ui-zone-filtering-design.md`

**Tracking:** epic #12; children #13, #14, #15, #16.

## Global Constraints

- **Relative imports MUST end in `.js`** — NodeNext resolution. `import { x } from './geometry.js'`.
- **Type-only imports MUST use `import type`** — enforced by `@typescript-eslint/consistent-type-imports`.
- **Import ordering follows the existing files**: value imports first, then a blank line, then `import type` groups (local before `@camera.ui/sdk`). Copy the shape of `src/camera.ts`.
- **Source files use single quotes**; `@stylistic/quotes` enforces it.
- **Test files use double quotes.** `eslint.config.js:12` ignores `**/*.test.ts`, so eslint's single-quote rule never reaches them and prettier's default applies. Match `src/sensors/object.test.ts`.
- Trailing commas on multiline, semicolons always, 2-space indent, max line length 170.
- **Never** add `Co-Authored-By` lines or any Claude/AI attribution to commits or PR bodies.
- Commit messages reference the issue inline, e.g. `feat: add zone geometry primitives (#13)`. Closing keywords (`Closes #N`) go **only** in the PR description.
- Each task is its own branch and PR. **Merge each PR before starting the next task** — tasks are strictly sequential and each needs the previous task's code to pass its tests.
- Run `npm test` during TDD loops (fast). Run `npm run bundle` once before the final commit of each task — it runs format, lint, test and build, and will reformat files.

## Pre-flight gate (before Task 1)

This is checklist item 1 on epic #12. It produces no code and no PR, but it can change Task 4's content and it is the only way to know whether the walk-in limitation is theoretical.

- [ ] Run `npm run watch-events -- --ip <noisy camera> --user <user> --pass <pass>` for a meaningful window (walk through frame, drive past, let it idle).
- [ ] Record: which codes fire; whether they carry `Rect` / `BoundingBox`; and **whether a single track re-emits** (same `ObjectID` / `HumanID` / `VehicleID` appearing more than once, or `action=State` events).
- [ ] Comment the findings on #12.
- [ ] If tracks do **not** re-emit, say so before Task 1 starts — `contain` include-zones become a trap and the README guidance in Task 4 needs to be stronger about it.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/zones/geometry.ts` (create) | Polygon maths in normalized 0-1 space. No camera.ui types, no zone concepts. |
| `src/zones/geometry.test.ts` (create) | Geometry unit tests. |
| `src/zones/filter.ts` (create) | Compiles `DetectionZone[]` to `CompiledZone[]`; applies zone semantics; turns a classified object event into a `ZoneDecision`. Pure — no logging, no sensor access. |
| `src/zones/filter.test.ts` (create) | Zone semantics and decision unit tests. |
| `src/camera.ts` (modify) | Holds compiled zones, subscribes to zone edits, applies the decision in `dispatchEvent`, owns all logging. |
| `src/sensors/object.test.ts` (modify) | One regression test for a `Stop` on a never-activated category. |
| `README.md` (modify) | User-facing documentation of zone behaviour. |

`src/sensors/object.ts` is **not** modified. `src/amcrest/classify.ts` is **not** modified.

---

### Task 1: Zone geometry primitives

Issue #13. Branch `13-zone-geometry-primitives` **already exists** and already contains the spec commit — check it out, don't recreate it.

**Files:**
- Create: `src/zones/geometry.ts`
- Test: `src/zones/geometry.test.ts`

**Interfaces:**
- Consumes: `BoundingBox` from `@camera.ui/sdk` — `{ x, y, width, height }`, all 0-1, `x`/`y` being the top-left corner.
- Produces:
  - `type Vec2 = [number, number]`
  - `pointInPolygon(point: Vec2, polygon: Vec2[]): boolean`
  - `boxIntersectsPolygon(box: BoundingBox, polygon: Vec2[]): boolean`
  - `boxInsidePolygon(box: BoundingBox, polygon: Vec2[]): boolean`

**Test fixtures used throughout this task** (define once at the top of the test file):

```ts
// A plain convex square covering 0.2-0.8 in both axes.
const SQUARE: Vec2[] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

// A "U": a solid band across the bottom (y 0-0.3) plus two vertical arms
// (x 0-0.2 and x 0.8-1). The notch — x 0.2-0.8, y 0.3-1 — is OUTSIDE the polygon.
const U_SHAPE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0.8, 1],
  [0.8, 0.3],
  [0.2, 0.3],
  [0.2, 1],
  [0, 1],
];
```

- [ ] **Step 1: Check out the existing branch**

```bash
git checkout 13-zone-geometry-primitives
git status
```

Expected: on branch `13-zone-geometry-primitives`, clean tree, `docs/superpowers/specs/...` already committed.

- [ ] **Step 2: Mark the issue in progress**

```bash
gh issue edit 13 --add-label status:in-progress
gh issue develop 13 --branch 13-zone-geometry-primitives 2>/dev/null || true
```

- [ ] **Step 3: Write the failing `pointInPolygon` tests**

Create `src/zones/geometry.test.ts`. Note the double quotes — test files are eslint-ignored, prettier default applies.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { pointInPolygon } from "./geometry.js";

import type { Vec2 } from "./geometry.js";

const SQUARE: Vec2[] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];

const U_SHAPE: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0.8, 1],
  [0.8, 0.3],
  [0.2, 0.3],
  [0.2, 1],
  [0, 1],
];

test("pointInPolygon: convex interior and exterior", () => {
  assert.equal(pointInPolygon([0.5, 0.5], SQUARE), true);
  assert.equal(pointInPolygon([0.9, 0.5], SQUARE), false);
  assert.equal(pointInPolygon([0.5, 0.1], SQUARE), false);
});

test("pointInPolygon: concave shapes exclude the notch", () => {
  assert.equal(pointInPolygon([0.5, 0.15], U_SHAPE), true, "bottom band");
  assert.equal(pointInPolygon([0.1, 0.6], U_SHAPE), true, "left arm");
  assert.equal(pointInPolygon([0.9, 0.6], U_SHAPE), true, "right arm");
  assert.equal(pointInPolygon([0.5, 0.6], U_SHAPE), false, "notch is outside");
});

// Boundary points are resolved by a half-open convention: the left and bottom
// edges count as inside, the right and top edges as outside. This is not
// arbitrary trivia — it is what stops two zones that share an edge from both
// claiming the same detection.
test("pointInPolygon: boundary points use a consistent half-open rule", () => {
  assert.equal(pointInPolygon([0.2, 0.5], SQUARE), true, "left edge");
  assert.equal(pointInPolygon([0.8, 0.5], SQUARE), false, "right edge");
  assert.equal(pointInPolygon([0.2, 0.2], SQUARE), true, "bottom-left vertex");
  assert.equal(pointInPolygon([0.8, 0.8], SQUARE), false, "top-right vertex");
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: FAIL — cannot find module `./geometry.js`.

- [ ] **Step 5: Implement `Vec2` and `pointInPolygon`**

Create `src/zones/geometry.ts`. Single quotes — this is a source file.

```ts
import type { BoundingBox } from '@camera.ui/sdk';

/**
 * A point in normalized 0-1 space. Deliberately distinct from the SDK's
 * `Point`, which is the same tuple shape but expressed as 0-100 percentages —
 * mixing the two silently compiles and silently misbehaves.
 */
export type Vec2 = [number, number];

/**
 * Standard ray-casting test: count how many polygon edges a ray cast in the
 * +x direction from the point crosses. Odd means inside.
 *
 * Points exactly on a boundary are resolved by a half-open convention — the
 * left and bottom edges read as inside, the right and top edges as outside.
 * That keeps two zones sharing an edge from both claiming the same detection.
 */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    // Only edges that straddle the ray's y can be crossed by it.
    if (yi > py === yj > py) continue;
    const crossX = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < crossX) inside = !inside;
  }
  return inside;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/zones/geometry.ts src/zones/geometry.test.ts
git commit -m "feat: add pointInPolygon for zone matching (#13)"
```

- [ ] **Step 8: Write the failing `boxIntersectsPolygon` tests**

Append to `src/zones/geometry.test.ts`, and add `boxIntersectsPolygon` to the import from `./geometry.js`.

```ts
test("boxIntersectsPolygon: box corner inside the polygon", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, SQUARE),
    true,
  );
});

test("boxIntersectsPolygon: box entirely containing the polygon", () => {
  // No box corner is inside the polygon and no box edge crosses it; this can
  // only be caught by testing whether a polygon vertex falls inside the box.
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0, width: 1, height: 1 }, SQUARE),
    true,
  );
});

test("boxIntersectsPolygon: crossing with neither shape containing the other's vertices", () => {
  // A tall thin polygon and a wide flat box forming a plus sign. Every box
  // corner is outside the polygon and every polygon vertex is outside the box,
  // so only an edge-crossing test finds this overlap. A corners-only
  // implementation returns false here.
  const TALL: Vec2[] = [
    [0.45, 0],
    [0.55, 0],
    [0.55, 1],
    [0.45, 1],
  ];
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0.45, width: 1, height: 0.1 }, TALL),
    true,
  );
});

test("boxIntersectsPolygon: disjoint", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0.85, y: 0.85, width: 0.1, height: 0.1 }, SQUARE),
    false,
  );
});

test("boxIntersectsPolygon: degenerate polygon never matches", () => {
  assert.equal(
    boxIntersectsPolygon({ x: 0, y: 0, width: 1, height: 1 }, [[0, 0], [1, 1]]),
    false,
  );
});
```

- [ ] **Step 9: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: FAIL — `boxIntersectsPolygon is not a function` (or a TS import error).

- [ ] **Step 10: Implement the helpers and `boxIntersectsPolygon`**

Append to `src/zones/geometry.ts`.

```ts
/** The four corners of a box, in ring order. */
function corners(box: BoundingBox): Vec2[] {
  const { x, y, width, height } = box;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

function pointInBox([x, y]: Vec2, box: BoundingBox): boolean {
  return (
    x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
  );
}

/** Sign of the cross product — which side of ab the point c falls on. */
function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
}

/**
 * Proper segment intersection. Collinear and endpoint-touching cases return
 * false, which is what we want: a box whose edge lies exactly along a zone
 * edge should count as inside the zone, not as crossing out of it.
 */
function segmentsIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  return (
    orientation(a1, a2, b1) !== orientation(a1, a2, b2) &&
    orientation(b1, b2, a1) !== orientation(b1, b2, a2)
  );
}

/** True if any edge of ring A properly crosses any edge of ring B. */
function ringsCross(ringA: Vec2[], ringB: Vec2[]): boolean {
  for (let i = 0; i < ringA.length; i++) {
    const a1 = ringA[i];
    const a2 = ringA[(i + 1) % ringA.length];
    for (let j = 0; j < ringB.length; j++) {
      const b1 = ringB[j];
      const b2 = ringB[(j + 1) % ringB.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Overlap test. Three cases, and all three are needed: a box corner inside the
 * polygon, a polygon vertex inside the box (which covers a box that swallows
 * the polygon whole), or edges that cross with neither shape containing any of
 * the other's vertices (two crossed rectangles).
 */
export function boxIntersectsPolygon(
  box: BoundingBox,
  polygon: Vec2[],
): boolean {
  if (polygon.length < 3) return false;
  const boxRing = corners(box);
  if (boxRing.some((c) => pointInPolygon(c, polygon))) return true;
  if (polygon.some((p) => pointInBox(p, box))) return true;
  return ringsCross(boxRing, polygon);
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 12: Commit**

```bash
git add src/zones/geometry.ts src/zones/geometry.test.ts
git commit -m "feat: add boxIntersectsPolygon for zone matching (#13)"
```

- [ ] **Step 13: Write the failing `boxInsidePolygon` tests**

Append to `src/zones/geometry.test.ts`, adding `boxInsidePolygon` to the import.

```ts
test("boxInsidePolygon: wholly inside a convex polygon", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.3, y: 0.3, width: 0.2, height: 0.2 }, SQUARE),
    true,
  );
});

test("boxInsidePolygon: partial overlap is not containment", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, SQUARE),
    false,
  );
});

test("boxInsidePolygon: disjoint", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.85, y: 0.85, width: 0.1, height: 0.1 }, SQUARE),
    false,
  );
});

test("boxInsidePolygon: wholly inside a concave polygon", () => {
  // Sits in the U's bottom band, clear of the notch.
  assert.equal(
    boxInsidePolygon({ x: 0.4, y: 0.05, width: 0.2, height: 0.15 }, U_SHAPE),
    true,
  );
});

test("boxInsidePolygon: all corners inside but bulging through a concave notch", () => {
  // Spans the U's two arms at y 0.5-0.6. All four corners land inside an arm,
  // but the middle of the box crosses the notch, which is outside the polygon.
  // A corners-only implementation returns true here — it must be false.
  assert.equal(
    boxInsidePolygon({ x: 0.1, y: 0.5, width: 0.8, height: 0.1 }, U_SHAPE),
    false,
  );
});

test("boxInsidePolygon: degenerate polygon never contains", () => {
  assert.equal(
    boxInsidePolygon({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, [[0, 0], [1, 1]]),
    false,
  );
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: FAIL — `boxInsidePolygon is not a function`.

- [ ] **Step 15: Implement `boxInsidePolygon`**

Append to `src/zones/geometry.ts`.

```ts
/**
 * Containment test. Checking the four corners is not sufficient: in a concave
 * polygon all four can sit inside while the box still bulges out through a
 * notch and back in. The edge-crossing check is what catches that.
 */
export function boxInsidePolygon(box: BoundingBox, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false;
  const boxRing = corners(box);
  if (!boxRing.every((c) => pointInPolygon(c, polygon))) return false;
  return !ringsCross(boxRing, polygon);
}
```

- [ ] **Step 16: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/geometry.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 17: Run the full bundle**

Run: `npm run bundle`
Expected: format, lint, all tests, build and `cui bundle` all succeed. This step may reformat files.

- [ ] **Step 18: Commit and open the PR**

```bash
git add -A
git commit -m "feat: add boxInsidePolygon for zone matching (#13)"
git push -u origin 13-zone-geometry-primitives
gh pr create --title "Zone geometry primitives" --body "$(cat <<'EOF'
Closes #13
Parent: #12

Pure polygon maths in normalized 0-1 space for detection-zone matching: `pointInPolygon`, `boxIntersectsPolygon`, `boxInsidePolygon`, plus the `Vec2` coordinate type. No camera.ui types, no behaviour change — nothing calls this yet.

Also lands the design spec for the epic.

Two non-obvious cases are covered by tests because naive implementations get them wrong:

- `boxIntersectsPolygon` on two crossed rectangles, where no vertex of either shape falls inside the other. A corners-only check misses it.
- `boxInsidePolygon` on a box whose four corners all sit inside a concave polygon while the box bulges out through a notch. A corners-only check wrongly returns true.

Verified with `npm run bundle`.
EOF
)"
gh issue edit 13 --remove-label status:in-progress --add-label status:in-review
```

---

### Task 2: Zone matching and event decision

Issue #14. **Merge Task 1's PR first**, then branch off updated `main`.

**Files:**
- Create: `src/zones/filter.ts`
- Test: `src/zones/filter.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `boxIntersectsPolygon`, `boxInsidePolygon` from `./geometry.js` (Task 1). `AmcrestClassification` and `AmcrestDetection` from `../amcrest/classify.js` — `AmcrestDetection` is `{ box: BoundingBox; trackId?: number }`, and the object variant of `AmcrestClassification` is `{ kind: 'object'; category: 'person' | 'vehicle'; active: boolean; detections?: AmcrestDetection[]; momentary?: boolean }`.
- Produces:
  - `interface CompiledZone { name: string; polygon: Vec2[]; type: ZoneType; filter: ZoneFilter; labels: Set<DetectionLabel>; isPrivacyMask: boolean }`
  - `compileZones(zones: DetectionZone[]): CompiledZone[]`
  - `type ZoneVerdict = { keep: true } | { keep: false; reason: string }`
  - `keepDetection(box: BoundingBox, label: DetectionLabel, zones: CompiledZone[]): ZoneVerdict`
  - `type ZoneDecision = { kind: 'report'; detections: AmcrestDetection[]; dropped: string[] } | { kind: 'skipped'; detections: AmcrestDetection[]; reason: 'deactivation' | 'no-coordinates' } | { kind: 'suppress'; reasons: string[] }`
  - `decideObjectEvent(c: Extract<AmcrestClassification, { kind: 'object' }>, zones: CompiledZone[]): ZoneDecision`

**Note on `keepDetection`'s return type.** Issue #14 originally specified `boolean`. It returns a `ZoneVerdict` instead, because Task 3 must log *which* zone suppressed a detection and a boolean discards that. Update the issue body when you start.

- [ ] **Step 1: Branch and mark in progress**

```bash
git checkout main && git pull
git checkout -b 14-zone-matching-and-decision
gh issue edit 14 --add-label status:in-progress
```

- [ ] **Step 2: Update issue #14 for the return-type change**

```bash
gh issue comment 14 --body "\`keepDetection\` returns a \`ZoneVerdict\` (\`{ keep: true } | { keep: false; reason: string }\`) rather than a bare \`boolean\`. #15 has to log which zone suppressed a detection, and a boolean throws that away. The \`reason\` string is built where the zone name is in scope and consumed verbatim by the logger, which keeps this module free of logging concerns."
```

- [ ] **Step 3: Write the failing `compileZones` tests**

Create `src/zones/filter.test.ts`. Double quotes — test file.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { compileZones } from "./filter.js";

import type { DetectionZone } from "@camera.ui/sdk";

/** A 0.2-0.8 square once compiled. Override any field per test. */
function zone(overrides: Partial<DetectionZone> = {}): DetectionZone {
  return {
    name: "Zone",
    points: [
      [20, 20],
      [80, 20],
      [80, 80],
      [20, 80],
    ],
    type: "intersect",
    filter: "include",
    labels: [],
    isPrivacyMask: false,
    color: "#ffffff",
    ...overrides,
  };
}

test("compileZones scales 0-100 percentages into 0-1 space", () => {
  const [compiled] = compileZones([zone()]);
  assert.deepEqual(compiled.polygon, [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ]);
  assert.equal(compiled.name, "Zone");
  assert.equal(compiled.type, "intersect");
  assert.equal(compiled.filter, "include");
  assert.equal(compiled.isPrivacyMask, false);
  assert.deepEqual([...compiled.labels], []);
});

test("compileZones drops polygons with fewer than three points", () => {
  const kept = compileZones([
    zone({ name: "Line", points: [[0, 0], [100, 100]] }),
    zone({ name: "Real" }),
  ]);
  assert.deepEqual(kept.map((z) => z.name), ["Real"]);
});

test("compileZones handles an empty list", () => {
  assert.deepEqual(compileZones([]), []);
});

test("compileZones carries labels into a Set", () => {
  const [compiled] = compileZones([zone({ labels: ["person", "vehicle"] })]);
  assert.equal(compiled.labels.has("person"), true);
  assert.equal(compiled.labels.has("vehicle"), true);
  assert.equal(compiled.labels.has("animal"), false);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: FAIL — cannot find module `./filter.js`.

- [ ] **Step 5: Implement `CompiledZone` and `compileZones`**

Create `src/zones/filter.ts`. Single quotes — source file.

```ts
import { boxInsidePolygon, boxIntersectsPolygon } from './geometry.js';

import type { Vec2 } from './geometry.js';
import type {
  BoundingBox,
  DetectionLabel,
  DetectionZone,
  ZoneFilter,
  ZoneType,
} from '@camera.ui/sdk';

/** camera.ui stores zone polygons as 0-100 percentages; we work in 0-1. */
const ZONE_COORD_MAX = 100;

/** A `DetectionZone` normalized once, so per-event matching stays cheap. */
export interface CompiledZone {
  name: string;
  polygon: Vec2[];
  type: ZoneType;
  filter: ZoneFilter;
  /** Empty means the zone applies to every label. */
  labels: Set<DetectionLabel>;
  isPrivacyMask: boolean;
}

/**
 * Runs once per zone-list change, not per event. Polygons with fewer than
 * three points cannot enclose anything, so they are dropped rather than
 * silently matching nothing later.
 */
export function compileZones(zones: DetectionZone[]): CompiledZone[] {
  return zones
    .filter((z) => Array.isArray(z.points) && z.points.length >= 3)
    .map((z) => ({
      name: z.name,
      polygon: z.points.map(
        ([x, y]): Vec2 => [x / ZONE_COORD_MAX, y / ZONE_COORD_MAX],
      ),
      type: z.type,
      filter: z.filter,
      labels: new Set(z.labels ?? []),
      isPrivacyMask: z.isPrivacyMask,
    }));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/zones/filter.ts src/zones/filter.test.ts
git commit -m "feat: compile camera.ui detection zones into 0-1 space (#14)"
```

- [ ] **Step 8: Write the failing `keepDetection` tests**

Append to `src/zones/filter.test.ts`, adding `keepDetection` to the import from `./filter.js`.

```ts
const INSIDE = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
const PARTIAL = { x: 0.75, y: 0.75, width: 0.1, height: 0.1 };
const OUTSIDE = { x: 0.9, y: 0.9, width: 0.05, height: 0.05 };

test("keepDetection: no zones keeps everything", () => {
  assert.equal(keepDetection(OUTSIDE, "person", []).keep, true);
});

test("keepDetection: the four type x filter combinations", () => {
  const cases: {
    type: "intersect" | "contain";
    filter: "include" | "exclude";
    box: typeof INSIDE;
    expected: boolean;
    label: string;
  }[] = [
    { type: "intersect", filter: "include", box: INSIDE, expected: true, label: "include/intersect wholly inside" },
    { type: "intersect", filter: "include", box: PARTIAL, expected: true, label: "include/intersect overlapping" },
    { type: "intersect", filter: "include", box: OUTSIDE, expected: false, label: "include/intersect outside" },
    { type: "contain", filter: "include", box: INSIDE, expected: true, label: "include/contain wholly inside" },
    { type: "contain", filter: "include", box: PARTIAL, expected: false, label: "include/contain only overlapping" },
    { type: "contain", filter: "include", box: OUTSIDE, expected: false, label: "include/contain outside" },
    { type: "intersect", filter: "exclude", box: INSIDE, expected: false, label: "exclude/intersect wholly inside" },
    { type: "intersect", filter: "exclude", box: PARTIAL, expected: false, label: "exclude/intersect overlapping" },
    { type: "intersect", filter: "exclude", box: OUTSIDE, expected: true, label: "exclude/intersect outside" },
    { type: "contain", filter: "exclude", box: INSIDE, expected: false, label: "exclude/contain wholly inside" },
    { type: "contain", filter: "exclude", box: PARTIAL, expected: true, label: "exclude/contain only overlapping" },
    { type: "contain", filter: "exclude", box: OUTSIDE, expected: true, label: "exclude/contain outside" },
  ];

  for (const c of cases) {
    const zones = compileZones([zone({ type: c.type, filter: c.filter })]);
    assert.equal(keepDetection(c.box, "person", zones).keep, c.expected, c.label);
  }
});

test("keepDetection: a zone whose labels exclude this one is ignored entirely", () => {
  const zones = compileZones([zone({ labels: ["vehicle"] })]);
  // An include zone that does not apply to 'person' must not gate a person.
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, true);
  assert.equal(keepDetection(OUTSIDE, "vehicle", zones).keep, false);
});

test("keepDetection: empty labels applies the zone to every label", () => {
  const zones = compileZones([zone({ labels: [] })]);
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, false);
  assert.equal(keepDetection(OUTSIDE, "vehicle", zones).keep, false);
});

test("keepDetection: a privacy mask drops a detection an include zone would have kept", () => {
  const zones = compileZones([
    zone({ name: "Everything", points: [[0, 0], [100, 0], [100, 100], [0, 100]] }),
    zone({ name: "Bins", isPrivacyMask: true }),
  ]);
  const verdict = keepDetection(INSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(verdict.keep === false && verdict.reason, "inside privacy mask 'Bins'");
});

test("keepDetection: matching any one of several include zones is enough", () => {
  const zones = compileZones([
    zone({ name: "Corner", points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
    zone({ name: "Driveway" }),
  ]);
  assert.equal(keepDetection(INSIDE, "person", zones).keep, true);
});

test("keepDetection: with only exclude zones, not being excluded is enough", () => {
  const zones = compileZones([zone({ name: "Street", filter: "exclude" })]);
  assert.equal(keepDetection(OUTSIDE, "person", zones).keep, true);
  const verdict = keepDetection(INSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(verdict.keep === false && verdict.reason, "inside exclude zone 'Street'");
});

test("keepDetection: failing every include zone names them all", () => {
  const zones = compileZones([
    zone({ name: "Driveway" }),
    zone({ name: "Porch", points: [[0, 0], [10, 0], [10, 10], [0, 10]] }),
  ]);
  const verdict = keepDetection(OUTSIDE, "person", zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "outside include zone(s) 'Driveway', 'Porch'",
  );
});
```

- [ ] **Step 9: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: FAIL — `keepDetection is not a function`.

- [ ] **Step 10: Implement `ZoneVerdict` and `keepDetection`**

Append to `src/zones/filter.ts`.

```ts
/**
 * Why a detection was dropped. The `reason` is a finished, human-readable
 * phrase rather than structured data: it is built here, where the zone name is
 * in scope, and consumed verbatim by the caller's logger. That keeps this
 * module free of logging and the caller free of zone vocabulary.
 */
export type ZoneVerdict = { keep: true } | { keep: false; reason: string };

const KEEP: ZoneVerdict = { keep: true };

function applies(zone: CompiledZone, label: DetectionLabel): boolean {
  return zone.labels.size === 0 || zone.labels.has(label);
}

/** What "in the zone" means for this zone — its `type` decides. */
function inZone(box: BoundingBox, zone: CompiledZone): boolean {
  return zone.type === 'contain'
    ? boxInsidePolygon(box, zone.polygon)
    : boxIntersectsPolygon(box, zone.polygon);
}

/**
 * Applies camera.ui's zone model to a single detection.
 *
 * `type` decides what "in the zone" means; `filter` decides whether being in it
 * qualifies or disqualifies. A detection with no applicable zones is kept —
 * that is what makes this whole feature invisible to anyone who has not drawn
 * a zone, and why it needs no opt-in setting.
 */
export function keepDetection(
  box: BoundingBox,
  label: DetectionLabel,
  zones: CompiledZone[],
): ZoneVerdict {
  const applicable = zones.filter((z) => applies(z, label));

  // Privacy masks win outright: anything wholly inside one is dropped,
  // whatever that zone's own intersect/contain setting says.
  const mask = applicable.find(
    (z) => z.isPrivacyMask && boxInsidePolygon(box, z.polygon),
  );
  if (mask) return { keep: false, reason: `inside privacy mask '${mask.name}'` };

  const gates = applicable.filter((z) => !z.isPrivacyMask);
  if (gates.length === 0) return KEEP;

  const excluded = gates.find((z) => z.filter === 'exclude' && inZone(box, z));
  if (excluded) {
    return { keep: false, reason: `inside exclude zone '${excluded.name}'` };
  }

  const includes = gates.filter((z) => z.filter === 'include');
  if (includes.length === 0) return KEEP;
  if (includes.some((z) => inZone(box, z))) return KEEP;

  const names = includes.map((z) => `'${z.name}'`).join(', ');
  return { keep: false, reason: `outside include zone(s) ${names}` };
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 12: Commit**

```bash
git add src/zones/filter.ts src/zones/filter.test.ts
git commit -m "feat: apply camera.ui zone semantics to detections (#14)"
```

- [ ] **Step 13: Write the failing `decideObjectEvent` tests**

Append to `src/zones/filter.test.ts`, adding `decideObjectEvent` to the import from `./filter.js`.

```ts
test("decideObjectEvent: a deactivation is never filtered, however badly it fails the zones", () => {
  // Load-bearing. Stop payloads carry no boxes of their own, and suppressing a
  // Stop would leave the object sensor latched active forever.
  const zones = compileZones([zone({ name: "Driveway" })]);
  const decision = decideObjectEvent(
    { kind: "object", category: "person", active: false, detections: [{ box: OUTSIDE }] },
    zones,
  );
  assert.equal(decision.kind, "skipped");
  assert.equal(decision.kind === "skipped" && decision.reason, "deactivation");
  assert.equal(decision.kind === "skipped" && decision.detections.length, 1);
});

test("decideObjectEvent: an activation with no coordinates fails open", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  const decision = decideObjectEvent(
    { kind: "object", category: "person", active: true },
    zones,
  );
  assert.equal(decision.kind, "skipped");
  assert.equal(decision.kind === "skipped" && decision.reason, "no-coordinates");
});

test("decideObjectEvent: reports only the detections that survive", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  const decision = decideObjectEvent(
    {
      kind: "object",
      category: "person",
      active: true,
      detections: [{ box: INSIDE, trackId: 1 }, { box: OUTSIDE, trackId: 2 }],
    },
    zones,
  );
  assert.equal(decision.kind, "report");
  assert.deepEqual(
    decision.kind === "report" && decision.detections.map((d) => d.trackId),
    [1],
  );
  assert.equal(decision.kind === "report" && decision.dropped.length, 1);
});

test("decideObjectEvent: suppresses when nothing survives", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  const decision = decideObjectEvent(
    { kind: "object", category: "person", active: true, detections: [{ box: OUTSIDE }] },
    zones,
  );
  assert.equal(decision.kind, "suppress");
  assert.deepEqual(
    decision.kind === "suppress" && decision.reasons,
    ["outside include zone(s) 'Driveway'"],
  );
});

test("decideObjectEvent: momentary events are filtered the same way", () => {
  const zones = compileZones([zone({ name: "Driveway" })]);
  const decision = decideObjectEvent(
    {
      kind: "object",
      category: "person",
      active: true,
      momentary: true,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(decision.kind, "suppress");
});

test("decideObjectEvent: with no zones, every activation reports unchanged", () => {
  const decision = decideObjectEvent(
    { kind: "object", category: "vehicle", active: true, detections: [{ box: OUTSIDE }] },
    [],
  );
  assert.equal(decision.kind, "report");
  assert.equal(decision.kind === "report" && decision.detections.length, 1);
  assert.equal(decision.kind === "report" && decision.dropped.length, 0);
});
```

- [ ] **Step 14: Run the tests to verify they fail**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: FAIL — `decideObjectEvent is not a function`.

- [ ] **Step 15: Implement `ZoneDecision` and `decideObjectEvent`**

Append to `src/zones/filter.ts`, and add the classify types to the import block at the top:

```ts
import type {
  AmcrestClassification,
  AmcrestDetection,
} from '../amcrest/classify.js';
```

```ts
/**
 * What the caller should do with an object event.
 *
 * `skipped` still reports — it means the event bypassed zone filtering rather
 * than passing it, and carries why so the caller can say so once in the log.
 */
export type ZoneDecision =
  | { kind: 'report'; detections: AmcrestDetection[]; dropped: string[] }
  | {
    kind: 'skipped';
    detections: AmcrestDetection[];
    reason: 'deactivation' | 'no-coordinates';
  }
  | { kind: 'suppress'; reasons: string[] };

type ObjectClassification = Extract<AmcrestClassification, { kind: 'object' }>;

/**
 * Applies the camera's detection zones to a classified object event.
 *
 * Deactivations and coordinate-free activations deliberately bypass filtering;
 * see the inline notes. Everything else is filtered per detection, and an event
 * whose detections are all dropped is suppressed outright rather than reported
 * as an empty activation.
 */
export function decideObjectEvent(
  c: ObjectClassification,
  zones: CompiledZone[],
): ZoneDecision {
  // A Stop carries no boxes, so it can never satisfy a zone. Filtering it would
  // suppress it, and the sensor would stay latched active forever.
  if (!c.active) {
    return {
      kind: 'skipped',
      detections: c.detections ?? [],
      reason: 'deactivation',
    };
  }

  const detections = c.detections ?? [];
  // Fail open. Some firmware sends a bare Start with no payload; a terse
  // payload must never cost a real person detection.
  if (detections.length === 0) {
    return { kind: 'skipped', detections, reason: 'no-coordinates' };
  }

  const kept: AmcrestDetection[] = [];
  const dropped: string[] = [];
  for (const detection of detections) {
    const verdict = keepDetection(detection.box, c.category, zones);
    if (verdict.keep) kept.push(detection);
    else dropped.push(verdict.reason);
  }

  if (kept.length === 0) return { kind: 'suppress', reasons: dropped };
  return { kind: 'report', detections: kept, dropped };
}
```

- [ ] **Step 16: Run the tests to verify they pass**

Run: `node --import tsx --test src/zones/filter.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 17: Run the full bundle**

Run: `npm run bundle`
Expected: everything passes. May reformat files.

- [ ] **Step 18: Commit and open the PR**

```bash
git add -A
git commit -m "feat: decide report/skip/suppress for zone-filtered object events (#14)"
git push -u origin 14-zone-matching-and-decision
gh pr create --title "Zone matching and event decision" --body "$(cat <<'EOF'
Closes #14
Parent: #12

Compiles camera.ui's `DetectionZone[]` into 0-1 space once per change, applies the include/exclude/intersect/contain/labels/privacy-mask semantics to a detection, and turns a classified object event into a report/skip/suppress decision. Pure — no logging, no sensor access, nothing calls it yet.

Two decisions worth review:

- `keepDetection` returns a `ZoneVerdict` rather than a `boolean`. #15 has to log *which* zone suppressed a detection; a boolean discards that. The reason string is built where the zone name is in scope and consumed verbatim by the logger.
- Deactivations and coordinate-free activations bypass filtering rather than failing it, and say so via `kind: 'skipped'`. The deactivation case is load-bearing: a `Stop` carries no boxes, so filtering one would suppress it and latch the object sensor active forever. There is a regression test for exactly that.

Verified with `npm run bundle`.
EOF
)"
gh issue edit 14 --remove-label status:in-progress --add-label status:in-review
```

---

### Task 3: Wire zone filtering into the camera event path

Issue #15. **Merge Task 2's PR first**, then branch off updated `main`.

**Files:**
- Modify: `src/camera.ts` — imports; new fields near the existing sensor fields (~line 76-84); `initialize()` (~line 140, before `this.startEventLoop()`); `destroy()` (~line 172); `dispatchEvent()` `case 'object'` (~line 384); one new private method.
- Modify: `src/sensors/object.test.ts` — append one test.

**Interfaces:**
- Consumes: `compileZones`, `decideObjectEvent`, `CompiledZone` from `./zones/filter.js` (Task 2). `cameraDevice.detectionZones: DetectionZone[]` and `cameraDevice.onPropertyChange('detectionZones')`, which returns an `Observable<{ property; oldData; newData }>` whose `.subscribe(cb)` returns a `Disposable` with `.dispose()`.
- Produces: nothing consumed by later tasks. Task 4 documents the behaviour this task ships.

- [ ] **Step 1: Branch and mark in progress**

```bash
git checkout main && git pull
git checkout -b 15-wire-zone-filtering
gh issue edit 15 --add-label status:in-progress
```

- [ ] **Step 2: Write the failing object-sensor regression test**

Append to `src/sensors/object.test.ts`. Double quotes, and reuse the existing `observe` helper already in that file.

```ts
test("a Stop for a never-activated category leaves other categories alone", () => {
  // Zone filtering can suppress a Start while its matching Stop still arrives.
  // The Stop must be harmless rather than clobbering an unrelated category.
  const sensor = new AmcrestObjectSensor();
  const calls = observe(sensor);

  sensor.report("person", true);
  sensor.report("vehicle", false);

  const last = calls[calls.length - 1];
  assert.equal(last.active, true);
  assert.deepEqual(last.detections.map((d) => d.label), ["person"]);
});
```

- [ ] **Step 3: Run the test**

Run: `node --import tsx --test src/sensors/object.test.ts`
Expected: PASS. This documents existing behaviour rather than driving a change — `object.ts` is deliberately not modified. If it FAILS, stop: the assumption that a stray `Stop` is harmless is wrong, and Task 2's design needs revisiting before continuing.

- [ ] **Step 4: Commit the regression test**

```bash
git add src/sensors/object.test.ts
git commit -m "test: cover a Stop for a never-activated object category (#15)"
```

- [ ] **Step 5: Add the imports to `src/camera.ts`**

Add to the value-import block, after the `./sensors/index.js` import:

```ts
import { compileZones, decideObjectEvent } from './zones/filter.js';
```

Add to the local type-import block:

```ts
import type { CompiledZone } from './zones/filter.js';
```

Add `Disposable` to the existing `@camera.ui/sdk` type import list, keeping it alphabetical:

```ts
import type {
  CameraDevice,
  DeviceStorage,
  Disposable,
  LoggerService,
  SnapshotInterface,
  StreamingInterface,
} from '@camera.ui/sdk';
```

- [ ] **Step 6: Add the new fields**

In the field block alongside `private ptz?: AmcrestPTZSensor;`:

```ts
private zones: CompiledZone[] = [];
private zonesSub?: Disposable;
/** `${code}:${category}` pairs already warned about; see warnBoxless. */
private readonly boxlessWarned = new Set<string>();
```

- [ ] **Step 7: Seed and subscribe in `initialize()`**

In `initialize()`, immediately before `this.startEventLoop();`:

```ts
this.zones = compileZones(this.cameraDevice.detectionZones ?? []);
this.zonesSub = this.cameraDevice
  .onPropertyChange('detectionZones')
  .subscribe(({ newData }) => {
    this.zones = compileZones(newData ?? []);
    this.log.debug(`Detection zones updated: ${this.zones.length} zone(s)`);
  });
```

Order matters: zones must be compiled before the event loop can deliver anything.

- [ ] **Step 8: Dispose in `destroy()`**

In `destroy()`, after `this.eventAbort?.abort();`:

```ts
this.zonesSub?.dispose();
this.zonesSub = undefined;
```

- [ ] **Step 9: Replace the `case 'object'` branch in `dispatchEvent`**

Replace the existing branch with:

```ts
      case 'object': {
        const decision = decideObjectEvent(c, this.zones);
        if (decision.kind === 'suppress') {
          this.log.debug(
            `${ev.code} suppressed by detection zones: ${decision.reasons.join('; ')}`,
          );
          break;
        }
        if (decision.kind === 'skipped' && decision.reason === 'no-coordinates') {
          this.warnBoxless(ev.code, c.category);
        }
        if (decision.kind === 'report' && decision.dropped.length > 0) {
          this.log.debug(
            `${ev.code} partially filtered by detection zones: ${decision.dropped.join('; ')}`,
          );
        }
        if (c.momentary) {
          this.object?.pulse(c.category, decision.detections);
        } else {
          this.object?.report(c.category, c.active, decision.detections);
        }
        break;
      }
```

The branch needs braces — it declares a `const`.

- [ ] **Step 10: Add the `warnBoxless` method**

Add as a private method on `AmcrestCamera`, next to `dispatchEvent`:

```ts
  /**
   * Warns once per code+category that an event arrived without coordinates, so
   * detection zones could not be applied to it. Only worth saying when the user
   * has actually drawn zones — otherwise it describes a non-problem.
   */
  private warnBoxless(code: string, category: string): void {
    if (this.zones.length === 0) return;
    const key = `${code}:${category}`;
    if (this.boxlessWarned.has(key)) return;
    this.boxlessWarned.add(key);
    this.log.debug(
      `${code} (${category}) carried no coordinates, so detection zones cannot be applied to it — it is reported unfiltered. Further occurrences are not logged.`,
    );
  }
```

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: PASS, all files including the new `src/zones/*.test.ts`.

- [ ] **Step 12: Run the full bundle**

Run: `npm run bundle`
Expected: format, lint, test, build and `cui bundle` all succeed. Lint is the real check here — `camera.ts` is linted (unlike the test files) and will reject a missing `import type` or a wrong quote style.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: apply camera.ui detection zones to object events (#15)"
```

- [ ] **Step 14: Verify against real hardware**

This cannot be unit-tested and gates the PR. Enable debug logging in camera.ui, then:

1. Draw an **exclude** zone over the noisy area. Trigger motion there. Confirm a `suppressed by detection zones: inside exclude zone '<name>'` line naming the correct zone.
2. Draw an **include** zone. Walk into it. Confirm the alert fires **and** the bounding-box overlay shows only the surviving object.
3. Walk out. **Confirm the sensor clears and does not stay latched active.** Highest-risk regression in this change.
4. Edit a zone in camera.ui without restarting. Confirm a `Detection zones updated: N zone(s)` line, and that the new shape takes effect on the next event.
5. Delete all zones. Confirm events flow unfiltered again.

Record the results in the PR body. If step 3 fails, do not merge.

- [ ] **Step 15: Open the PR**

```bash
git push -u origin 15-wire-zone-filtering
gh pr create --title "Apply camera.ui detection zones to object events" --body "$(cat <<'EOF'
Closes #15
Parent: #12

Wires zone filtering into `AmcrestCamera`. Compiled zones are seeded in `initialize()` and kept current through `onPropertyChange('detectionZones')`; the subscription is disposed in `destroy()`. `dispatchEvent`'s `case 'object'` applies the decision and owns all the logging.

`motion`, `audio` and `doorbell` are deliberately untouched. `VideoMotion` carries no box, and the motion sensor needs to stay usable as a cheap detection-cascade trigger for any frame-based detector assigned later — filtering it would starve that.

`src/sensors/object.ts` is unchanged; filtering happens before `report()`/`pulse()` are called.

### Verified

`npm run bundle` passes. On hardware, with debug logging on:

- [ ] Exclude zone suppresses, and the log names the right zone
- [ ] Include zone alerts, and the overlay shows only the surviving object
- [ ] Sensor clears on walk-out and does not latch
- [ ] Zone edits take effect without a restart
- [ ] Removing all zones restores unfiltered behaviour
EOF
)"
gh issue edit 15 --remove-label status:in-progress --add-label status:in-review
```

Tick the verification boxes in the PR body as you complete step 14.

---

### Task 4: Document zone behaviour in the README

Issue #16. **Merge Task 3's PR first**, then branch off updated `main`.

**Files:**
- Modify: `README.md` — new section between `## Setup` and `## Troubleshooting events`.

**Interfaces:**
- Consumes: the shipped behaviour from Task 3, and the pre-flight findings recorded on #12.
- Produces: nothing.

- [ ] **Step 1: Branch and mark in progress**

```bash
git checkout main && git pull
git checkout -b 16-document-zone-behaviour
gh issue edit 16 --add-label status:in-progress
```

- [ ] **Step 2: Re-read the pre-flight findings**

```bash
gh issue view 12 --comments
```

You need the answer to "do tracks re-emit?" for the limitation paragraph in step 3. If they do **not** re-emit, strengthen the `contain` warning from "misfires in two ways" to an explicit recommendation against `contain` include-zones on this hardware.

- [ ] **Step 3: Add the README section**

Insert after the `## Setup` section, before `## Troubleshooting events`:

```markdown
## Detection zones

Zones drawn in camera.ui are applied to this plugin's events by the plugin itself. Draw them as normal — there is nothing to enable, and no zone settings on the plugin's own page.

Because detection happens on the camera rather than on frames decoded by camera.ui, zones can only be applied to events that tell us *where* something happened:

| Event | Carries coordinates | Zones apply |
| --- | --- | --- |
| `SmartMotionHuman` / `SmartMotionVehicle` | yes | yes |
| `CrossLineDetection` / `CrossRegionDetection` | yes | yes |
| `FaceDetection` | usually | yes |
| `VideoMotion` (plain motion) | no | **no** |

Plain motion carries no coordinates at all, so it is always reported in full. If plain motion is your main source of noise, turn it off on the camera and rely on the smart events instead.

Object types are filtered by the same mechanism: a zone's **labels** decide which detections it applies to. There is no separate "never alert me about vehicles" setting — express it as a zone. To ignore vehicles everywhere, draw an `exclude` zone covering the frame with its labels set to `vehicle`.

### Choosing intersect or contain

|  | `include` | `exclude` |
| --- | --- | --- |
| **intersect** | alert if the object touches the zone at all | drop if it touches the zone at all |
| **contain** | alert only if the object is wholly inside | drop only if it is wholly inside |

**Recommended: `intersect` for include zones, `contain` for exclude zones.**

`contain` combined with `include` is the strict pairing, and it misfires in two common ways:

- Someone entering from the edge of frame is only partly inside the zone at first, so they do not alert until they are wholly within it.
- Someone close to the camera has a large bounding box. If your zone is a modest patch of driveway, that box may never fit wholly inside it, so they never alert even while standing in the middle of the zone.

`contain` with `exclude` is the safe pairing — "ignore things wholly inside the neighbour's garden", where someone straddling the boundary still alerts.

### Known limitation

Filtering uses the position reported when the camera first detects the object. If someone is first picked up outside your zone and then walks into it, and your camera does not re-report that object as it moves, no alert is produced. Prefer `intersect` include zones drawn a little larger than the area you care about.

### Checking what is being filtered

Enable debug logging in camera.ui and look for:

```
SmartMotionHuman suppressed by detection zones: outside include zone(s) 'Driveway'
SmartMotionVehicle partially filtered by detection zones: inside exclude zone 'Street'
Detection zones updated: 2 zone(s)
```

If a camera reports detections without coordinates, you will see this once per event type:

```
SmartMotionHuman (person) carried no coordinates, so detection zones cannot be applied to it — it is reported unfiltered.
```

That is expected on some firmware. Those events are always reported rather than dropped, so a terse camera never costs you a real detection.
```

- [ ] **Step 4: Update the known-limitations list**

The `## Known limitations / v2` section at the end of the README lists deferred work. Add:

```markdown
- **Camera-side zone configuration** — zones are applied by the plugin, not written to the camera. The device's own recording and alert rules still use whatever regions are configured on it.
```

- [ ] **Step 5: Verify the README renders**

Run: `npx prettier --check README.md`
Expected: pass. If it reports differences, run `npx prettier --write README.md`.

Read the rendered tables back and confirm no broken pipes or stray backticks.

- [ ] **Step 6: Run the full bundle**

Run: `npm run bundle`
Expected: all pass.

- [ ] **Step 7: Commit and open the PR**

```bash
git add README.md
git commit -m "docs: document detection zone behaviour (#16)"
git push -u origin 16-document-zone-behaviour
gh pr create --title "Document detection zone behaviour" --body "$(cat <<'EOF'
Closes #16
Parent: #12

README section covering which events zones apply to and why plain `VideoMotion` is exempt, the intersect/contain x include/exclude matrix, the recommendation to use `intersect` for include zones and `contain` for exclude zones, the first-detection limitation, and the debug log lines to look for.

Also notes that label filtering lives on the zone rather than as a separate setting, since that is not obvious from the camera.ui UI.

Verified with `npm run bundle`.
EOF
)"
gh issue edit 16 --remove-label status:in-progress --add-label status:in-review
```

- [ ] **Step 8: Close out the epic**

Once all four PRs are merged:

```bash
gh issue view 12
```

Confirm all four sub-issues show closed, tick the remaining checklist boxes (including the pre-flight gate), verify the acceptance criteria against the shipped behaviour, then close #12.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task:

| Spec section | Task |
| --- | --- |
| `geometry.ts` module | Task 1 |
| `filter.ts` module, zone matching semantics | Task 2 |
| Wiring into `camera.ts`, decision rules, edge cases, logging | Task 3 |
| Guidance on drawing zones, known limitations | Task 4 |
| Hardware verification | Pre-flight gate + Task 3 step 14 |
| `object.test.ts` addition | Task 3 steps 2-4 |

All nine acceptance criteria from the spec are covered: zone/label filtering by Task 2's semantics tests plus Task 3's wiring; multi-object partial reporting by Task 2 step 13; the no-latch guarantee by Task 2's deactivation test, Task 3's `object.test.ts` regression and hardware check 3; boxless fail-open logging by Task 2's `no-coordinates` test and Task 3's `warnBoxless`; live zone edits by Task 3 step 7 and hardware check 4; the no-zones no-op by Task 2's final test and hardware check 5; motion/audio/doorbell untouched by leaving those branches alone; `npm run bundle` at the end of every task.

**Deviations from the spec and issues, both deliberate:**

1. `keepDetection` returns `ZoneVerdict`, not `boolean`. Issue #14 says `boolean`; that cannot satisfy issue #15's requirement to log the responsible zone. Task 2 step 2 updates the issue.
2. `ZoneDecision.report` carries a `dropped: string[]` the spec did not mention, and Task 3 logs it. Without it, the mixed case — one object kept, one dropped — is silent, and that is precisely the case a user would find confusing.

**Placeholder scan.** No TBD/TODO. Every code step has literal code. Every test step has literal assertions. No "similar to Task N" back-references.

**Type consistency.** `Vec2` is defined in Task 1 and imported in Task 2. `CompiledZone`, `ZoneVerdict` and `ZoneDecision` are defined in Task 2 and consumed in Task 3 with matching field names (`kind`, `detections`, `dropped`, `reasons`, `reason`, `keep`). `decideObjectEvent(c, zones)` has the same argument order everywhere. `warnBoxless(code, category)` is declared and called with matching arity. The reason strings asserted in Task 2's tests are byte-identical to those produced by `keepDetection`.

**Boundary-case note.** Task 1's half-open boundary tests assert the specific behaviour of the ray-casting convention in the given implementation. They are documented as a deliberate tie-break rather than incidental, because the convention is what keeps adjacent zones from double-claiming a detection. Should the implementation change, these are the tests to revisit first.
