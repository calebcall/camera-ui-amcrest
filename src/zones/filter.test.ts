import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compileZones,
  reviewObjectEvent,
  findKeptDetection,
  hasUsableCoordinates,
  keepDetection,
} from './filter.js';

import type { CompiledZone } from './filter.js';

import type {
  CameraZones,
  ObjectZone,
  Point,
  PrivacyZone,
} from '@camera.ui/sdk';

/** A 0.2-0.8 square once compiled. Override any field per test. */
const SQUARE: Point[] = [
  [20, 20],
  [80, 20],
  [80, 80],
  [20, 80],
];

function objectZone(overrides: Partial<ObjectZone> = {}): ObjectZone {
  return {
    name: 'Zone',
    points: SQUARE,
    type: 'intersect',
    labels: [],
    color: '#ffffff',
    ...overrides,
  };
}

function privacyZone(overrides: Partial<PrivacyZone> = {}): PrivacyZone {
  return {
    name: 'Mask',
    points: SQUARE,
    dropDetections: true,
    ...overrides,
  };
}

/** A `CameraZones` carrying only the lists a test cares about. */
function cameraZones(parts: Partial<CameraZones> = {}): CameraZones {
  return {
    privacyFallback: 'send',
    motion: [],
    object: [],
    privacy: [],
    alert: [],
    lines: [],
    ...parts,
  };
}

/**
 * Compiles a mixed list, sorting each entry into the `CameraZones` bucket it
 * belongs to. Keeps the matcher tests reading as one zone list, which is how
 * `keepDetection` sees them.
 */
function compile(list: (ObjectZone | PrivacyZone)[]): CompiledZone[] {
  return compileZones(
    cameraZones({
      object: list.filter((z): z is ObjectZone => !('dropDetections' in z)),
      privacy: list.filter((z): z is PrivacyZone => 'dropDetections' in z),
    }),
  );
}

test('compileZones scales 0-100 percentages into 0-1 space', () => {
  const [compiled] = compile([objectZone()]);
  assert.deepEqual(compiled.polygon, [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ]);
  assert.equal(compiled.name, 'Zone');
  assert.equal(compiled.type, 'intersect');
  assert.equal(compiled.isPrivacyMask, false);
  assert.deepEqual([...compiled.labels], []);
});

test('compileZones drops polygons with fewer than three points', () => {
  const kept = compile([
    objectZone({
      name: 'Line',
      points: [
        [0, 0],
        [100, 100],
      ],
    }),
    objectZone({ name: 'Real' }),
  ]);
  assert.deepEqual(
    kept.map((z) => z.name),
    ['Real'],
  );
});

test('compileZones handles an empty list', () => {
  assert.deepEqual(compile([]), []);
});

test('compileZones skips malformed points instead of throwing', () => {
  // This runs inside a shared SDK property-change subscriber, and Subject.next
  // has no try/catch — a throw here would abort delivery to every other
  // subscriber, and on the seeding call would leave the camera offline.
  const malformed = [
    { name: 'NotArrays', points: [1, 2, 3] },
    { name: 'TooShort', points: [[10], [20, 20], [30, 30]] },
    {
      name: 'NotNumbers',
      points: [
        ['a', 'b'],
        [20, 20],
        [30, 30],
      ],
    },
    {
      name: 'NotFinite',
      points: [
        [NaN, 0],
        [20, 20],
        [30, 30],
      ],
    },
    { name: 'Null', points: [null, [20, 20], [30, 30]] },
  ] as unknown as Partial<ObjectZone>[];

  const kept = compile([
    ...malformed.map((m) => objectZone(m)),
    objectZone({ name: 'Real' }),
  ]);
  assert.deepEqual(
    kept.map((z) => z.name),
    ['Real'],
  );
});

test('compileZones carries labels into a Set', () => {
  const [compiled] = compile([objectZone({ labels: ['person', 'vehicle'] })]);
  assert.equal(compiled.labels.has('person'), true);
  assert.equal(compiled.labels.has('vehicle'), true);
  assert.equal(compiled.labels.has('animal'), false);
});

const INSIDE = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
const PARTIAL = { x: 0.75, y: 0.75, width: 0.1, height: 0.1 };
const OUTSIDE = { x: 0.9, y: 0.9, width: 0.05, height: 0.05 };

test('keepDetection: no zones keeps everything', () => {
  assert.equal(keepDetection(OUTSIDE, 'person', []).keep, true);
});

test('keepDetection: intersect and contain, the two matches an object zone has', () => {
  // `filter` is gone from the SDK's zone model: every object zone is an include
  // gate, and the exclude role belongs to privacy zones.
  const cases: {
    type: 'intersect' | 'contain';
    box: typeof INSIDE;
    expected: boolean;
    label: string;
  }[] = [
    {
      type: 'intersect',
      box: INSIDE,
      expected: true,
      label: 'intersect wholly inside',
    },
    {
      type: 'intersect',
      box: PARTIAL,
      expected: true,
      label: 'intersect overlapping',
    },
    {
      type: 'intersect',
      box: OUTSIDE,
      expected: false,
      label: 'intersect outside',
    },
    {
      type: 'contain',
      box: INSIDE,
      expected: true,
      label: 'contain wholly inside',
    },
    {
      type: 'contain',
      box: PARTIAL,
      expected: false,
      label: 'contain only overlapping',
    },
    {
      type: 'contain',
      box: OUTSIDE,
      expected: false,
      label: 'contain outside',
    },
  ];

  for (const c of cases) {
    const zones = compile([objectZone({ type: c.type })]);
    assert.equal(
      keepDetection(c.box, 'person', zones).keep,
      c.expected,
      c.label,
    );
  }
});

test('keepDetection: a label an object zone does not list is not gated by its polygon', () => {
  // Position only matters inside the zones that claim your label. Here the
  // 'Path' zone claims neither, so both labels get past its polygon — and only
  // the whitelist decides, from a second zone that keeps 'vehicle' in play.
  const zones = compile([
    objectZone({ name: 'Path', labels: ['person'] }),
    objectZone({
      name: 'Kerb',
      labels: ['vehicle'],
      points: [
        [85, 85],
        [100, 85],
        [100, 100],
        [85, 100],
      ],
    }),
  ]);
  assert.equal(keepDetection(OUTSIDE, 'vehicle', zones).keep, true);
  assert.equal(keepDetection(OUTSIDE, 'person', zones).keep, false);
});

test('keepDetection: empty labels applies the zone to every label', () => {
  const zones = compile([objectZone({ labels: [] })]);
  assert.equal(keepDetection(OUTSIDE, 'person', zones).keep, false);
  assert.equal(keepDetection(OUTSIDE, 'vehicle', zones).keep, false);
});

test('keepDetection: a privacy mask drops a detection an include zone would have kept', () => {
  const zones = compile([
    objectZone({
      name: 'Everything',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    }),
    privacyZone({ name: 'Bins' }),
  ]);
  const verdict = keepDetection(INSIDE, 'person', zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.40,0.40,0.10,0.10] inside privacy mask 'Bins'",
  );
});

test('keepDetection: a privacy zone masks every label', () => {
  // PrivacyZone has no labels in the SDK's model — it hides an area, not a
  // category — so it applies to whatever is standing in it.
  const zones = compile([privacyZone({ name: 'Road' })]);
  assert.equal(keepDetection(INSIDE, 'vehicle', zones).keep, false);
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, false);
});

test('keepDetection: a privacy zone that keeps detections does not filter', () => {
  // `dropDetections: false` means "hide the picture, keep watching". Filtering
  // on it would blind the detector in an area the user only wanted obscured.
  const zones = compile([
    privacyZone({ name: 'Neighbour', dropDetections: false }),
  ]);
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, true);
});

// A person clipped at the bottom of frame: Amcrest coordinates at or past 8191
// normalize to exactly 1.0, and a zone drawn to the edge of the picture
// compiles to exactly 1.0 too. Both of the following used to fail open.
const BOTTOM_CLIPPED = { x: 0.3, y: 0.55, width: 0.4, height: 0.45 };
const RIGHT_CLIPPED = { x: 0.6, y: 0.2, width: 0.4, height: 0.3 };
const FULL_FRAME_POINTS: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

test('keepDetection: a full-frame privacy mask masks an object clipped at the frame edge', () => {
  const zones = compile([
    privacyZone({
      name: 'Everything',
      points: FULL_FRAME_POINTS,
    }),
  ]);
  assert.equal(keepDetection(BOTTOM_CLIPPED, 'person', zones).keep, false);
  assert.equal(keepDetection(RIGHT_CLIPPED, 'person', zones).keep, false);
});

test('keepDetection: a label named by no object zone is dropped wherever it is', () => {
  // The whitelist rule, mirroring the server's `objectWhitelist`. Once every
  // object zone names its labels, a label none of them names is not watched at
  // all — this is what replaced the old exclude filter for "never alert me
  // about vehicles".
  const zones = compile([objectZone({ name: 'Path', labels: ['person'] })]);
  const verdict = keepDetection(INSIDE, 'vehicle', zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "label 'vehicle' is in no object zone (zones watch 'person')",
  );
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, true);
});

test('keepDetection: one object zone listing no labels turns the whitelist off', () => {
  // A zone with no labels constrains *where* every label counts, not *which*
  // labels count, so it must not let the other zones narrow the roster.
  const zones = compile([
    objectZone({ name: 'Path', labels: ['person'] }),
    objectZone({ name: 'Everything', points: FULL_FRAME_POINTS, labels: [] }),
  ]);
  assert.equal(keepDetection(INSIDE, 'vehicle', zones).keep, true);
});

test('keepDetection: a full-frame contain zone keeps a near-field object', () => {
  const zones = compile([
    objectZone({
      name: 'Everything',
      points: FULL_FRAME_POINTS,
      type: 'contain',
    }),
  ]);
  assert.equal(keepDetection(BOTTOM_CLIPPED, 'person', zones).keep, true);
});

test('keepDetection: matching any one of several object zones is enough', () => {
  const zones = compile([
    objectZone({
      name: 'Corner',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    }),
    objectZone({ name: 'Driveway' }),
  ]);
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, true);
});

test('keepDetection: failing every object zone names them all', () => {
  const zones = compile([
    objectZone({ name: 'Driveway' }),
    objectZone({
      name: 'Porch',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    }),
  ]);
  const verdict = keepDetection(OUTSIDE, 'person', zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.90,0.90,0.05,0.05] outside object zone(s) 'Driveway', 'Porch'",
  );
});

test('keepDetection: the reason names the box that was tested', () => {
  // The box is what makes a rejection diagnosable — "outside 'Driveway'" on
  // its own cannot tell you whether the zone or the coordinates are wrong.
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const verdict = keepDetection(
    { x: 0.7100000000000001, y: 0.9, width: 0.09, height: 0.21 },
    'person',
    zones,
  );
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.71,0.90,0.09,0.21] outside object zone(s) 'Driveway'",
  );
});

test('reviewObjectEvent: a deactivation is reported as such, never judged', () => {
  // A Stop's boxes describe where the object left, not where it was seen, so
  // the zones have no claim on them. The detections still come back: the
  // walk-in review in camera.ts is the one thing that reads a Stop's position.
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: false,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(review.kind, 'deactivation');
  assert.equal(review.kind === 'deactivation' && review.detections.length, 1);
});

test('reviewObjectEvent: with no zones drawn there is nothing to say', () => {
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'vehicle',
      active: true,
      detections: [{ box: OUTSIDE }],
    },
    [],
  );
  assert.deepEqual(review, { kind: 'no-zones' });
});

test('reviewObjectEvent: an activation with no coordinates cannot be judged', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    { kind: 'object', category: 'person', active: true },
    zones,
  );
  assert.equal(review.kind, 'no-coordinates');
});

test('reviewObjectEvent: an activation whose only box has no area cannot be judged', () => {
  // Some firmware sends a placeholder Rect of [0,0,0,0]. A zero-area box fails
  // every zone, so calling it "outside" would put a claim in the log that the
  // payload does not support.
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [{ box: { x: 0, y: 0, width: 0, height: 0 } }],
    },
    zones,
  );
  assert.equal(review.kind, 'no-coordinates');
  assert.equal(review.kind === 'no-coordinates' && review.detections.length, 1);
});

test('reviewObjectEvent: a real box alongside a degenerate one is still judged', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [
        { box: { x: 0, y: 0, width: 0, height: 0 }, trackId: 1 },
        { box: INSIDE, trackId: 2 },
      ],
    },
    zones,
  );
  assert.equal(review.kind, 'partial');
  assert.deepEqual(
    review.kind === 'partial' && review.kept.map((d) => d.trackId),
    [2],
  );
});

// A mask with a narrow off-centre slot cut out of it, in 0-100 percentages.
const NOTCHED_MASK_POINTS: Point[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [25, 100],
  [25, 25],
  [8, 25],
  [8, 100],
  [0, 100],
];

test("keepDetection: a zero-area box crossing a mask's slot is not inside the mask", () => {
  // The mixed-payload path: `reviewObjectEvent` only excuses an event when *no*
  // detection has coordinates, so one collapsed Rect next to a real one reaches
  // the mask test on its own. This box spans the mask's slot, which is not
  // masked ground, so the mask must not claim it.
  const zones = compile([
    privacyZone({
      name: 'Mask',
      points: NOTCHED_MASK_POINTS,
    }),
  ]);
  assert.equal(
    keepDetection({ x: 0, y: 0.5, width: 1, height: 0 }, 'person', zones).keep,
    true,
  );
});

test('keepDetection: a zero-area box wholly inside a mask is still masked', () => {
  // The other half of the same behaviour: collapsing an axis must not become a
  // way to walk through a privacy mask.
  const zones = compile([
    privacyZone({
      name: 'Mask',
      points: NOTCHED_MASK_POINTS,
    }),
  ]);
  const verdict = keepDetection(
    { x: 0.4, y: 0.5, width: 0.3, height: 0 },
    'person',
    zones,
  );
  assert.equal(verdict.keep, false);
  assert.match(verdict.reason ?? '', /inside privacy mask 'Mask'/);
});

test('reviewObjectEvent: partial names what is inside and what is not', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [
        { box: INSIDE, trackId: 1 },
        { box: OUTSIDE, trackId: 2 },
      ],
    },
    zones,
  );
  assert.equal(review.kind, 'partial');
  assert.deepEqual(
    review.kind === 'partial' && review.kept.map((d) => d.trackId),
    [1],
  );
  assert.equal(review.kind === 'partial' && review.dropped.length, 1);
});

test('reviewObjectEvent: fail when nothing is inside, with the reasons', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(review.kind, 'fail');
  assert.deepEqual(review.kind === 'fail' && review.reasons, [
    "box [0.90,0.90,0.05,0.05] outside object zone(s) 'Driveway'",
  ]);
});

test('reviewObjectEvent: momentary events are judged the same way', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      momentary: true,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(review.kind, 'fail');
});

test('reviewObjectEvent: a reversed box is judged, not called coordinate-free', () => {
  // classify.ts does not enforce x2 > x1, and geometry.ts normalizes reversed
  // extents. So a reversed box carries a real position and must be measured
  // rather than excused.
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const review = reviewObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      // The OUTSIDE box, expressed back-to-front.
      detections: [{ box: { x: 0.95, y: 0.95, width: -0.05, height: -0.05 } }],
    },
    zones,
  );
  assert.equal(review.kind, 'fail');
});

test('keepDetection: a contain zone whose notch opens on the frame edge does not contain a clipped box spanning it', () => {
  // End-to-end guard for the frame-edge notch regression. Without it, a
  // contain+include zone accepts an object largely outside it, and the
  // exclude/privacy-mask form drops a detection it should have kept.
  const zones = compile([
    objectZone({
      name: 'Yard',
      type: 'contain',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [80, 100],
        [80, 30],
        [20, 30],
        [20, 100],
        [0, 100],
      ],
    }),
  ]);
  const verdict = keepDetection(
    { x: 0.1, y: 0.2, width: 0.8, height: 0.8 },
    'person',
    zones,
  );
  assert.equal(verdict.keep, false);
});

test('findKeptDetection returns the first detection the zones keep', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  const kept = findKeptDetection(
    [{ box: OUTSIDE }, { box: INSIDE, trackId: 9 }],
    'person',
    zones,
  );
  assert.equal(kept?.trackId, 9);
});

test('findKeptDetection returns undefined when the zones keep none', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  assert.equal(
    findKeptDetection([{ box: OUTSIDE }], 'person', zones),
    undefined,
  );
});

test('findKeptDetection keeps the first detection when there are no zones', () => {
  // No zones means nothing gates, so the first detection qualifies.
  const kept = findKeptDetection([{ box: OUTSIDE, trackId: 3 }], 'person', []);
  assert.equal(kept?.trackId, 3);
});

test('findKeptDetection returns undefined for an empty detection list', () => {
  const zones = compile([objectZone({ name: 'Driveway' })]);
  assert.equal(findKeptDetection([], 'person', zones), undefined);
});

test('hasUsableCoordinates rejects an empty list and zero-area boxes', () => {
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

test('hasUsableCoordinates accepts a reversed box', () => {
  // geometry.ts normalizes reversed extents, so a back-to-front Rect carries a
  // real position and must not be mistaken for a coordinate-free payload.
  assert.equal(
    hasUsableCoordinates([
      { box: { x: 0.9, y: 0.9, width: -0.1, height: -0.1 } },
    ]),
    true,
  );
});
