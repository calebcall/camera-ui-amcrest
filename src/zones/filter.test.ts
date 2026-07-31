import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compileZones,
  decideObjectEvent,
  findKeptDetection,
  hasUsableCoordinates,
  keepDetection,
} from './filter.js';

import type { DetectionZone } from '@camera.ui/sdk';

/** A 0.2-0.8 square once compiled. Override any field per test. */
function zone(overrides: Partial<DetectionZone> = {}): DetectionZone {
  return {
    name: 'Zone',
    points: [
      [20, 20],
      [80, 20],
      [80, 80],
      [20, 80],
    ],
    type: 'intersect',
    filter: 'include',
    labels: [],
    isPrivacyMask: false,
    color: '#ffffff',
    ...overrides,
  };
}

test('compileZones scales 0-100 percentages into 0-1 space', () => {
  const [compiled] = compileZones([zone()]);
  assert.deepEqual(compiled.polygon, [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ]);
  assert.equal(compiled.name, 'Zone');
  assert.equal(compiled.type, 'intersect');
  assert.equal(compiled.filter, 'include');
  assert.equal(compiled.isPrivacyMask, false);
  assert.deepEqual([...compiled.labels], []);
});

test('compileZones drops polygons with fewer than three points', () => {
  const kept = compileZones([
    zone({
      name: 'Line',
      points: [
        [0, 0],
        [100, 100],
      ],
    }),
    zone({ name: 'Real' }),
  ]);
  assert.deepEqual(
    kept.map((z) => z.name),
    ['Real'],
  );
});

test('compileZones handles an empty list', () => {
  assert.deepEqual(compileZones([]), []);
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
  ] as unknown as Partial<DetectionZone>[];

  const kept = compileZones([
    ...malformed.map((m) => zone(m)),
    zone({ name: 'Real' }),
  ]);
  assert.deepEqual(
    kept.map((z) => z.name),
    ['Real'],
  );
});

test('compileZones carries labels into a Set', () => {
  const [compiled] = compileZones([zone({ labels: ['person', 'vehicle'] })]);
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

test('keepDetection: the four type x filter combinations', () => {
  const cases: {
    type: 'intersect' | 'contain';
    filter: 'include' | 'exclude';
    box: typeof INSIDE;
    expected: boolean;
    label: string;
  }[] = [
    {
      type: 'intersect',
      filter: 'include',
      box: INSIDE,
      expected: true,
      label: 'include/intersect wholly inside',
    },
    {
      type: 'intersect',
      filter: 'include',
      box: PARTIAL,
      expected: true,
      label: 'include/intersect overlapping',
    },
    {
      type: 'intersect',
      filter: 'include',
      box: OUTSIDE,
      expected: false,
      label: 'include/intersect outside',
    },
    {
      type: 'contain',
      filter: 'include',
      box: INSIDE,
      expected: true,
      label: 'include/contain wholly inside',
    },
    {
      type: 'contain',
      filter: 'include',
      box: PARTIAL,
      expected: false,
      label: 'include/contain only overlapping',
    },
    {
      type: 'contain',
      filter: 'include',
      box: OUTSIDE,
      expected: false,
      label: 'include/contain outside',
    },
    {
      type: 'intersect',
      filter: 'exclude',
      box: INSIDE,
      expected: false,
      label: 'exclude/intersect wholly inside',
    },
    {
      type: 'intersect',
      filter: 'exclude',
      box: PARTIAL,
      expected: false,
      label: 'exclude/intersect overlapping',
    },
    {
      type: 'intersect',
      filter: 'exclude',
      box: OUTSIDE,
      expected: true,
      label: 'exclude/intersect outside',
    },
    {
      type: 'contain',
      filter: 'exclude',
      box: INSIDE,
      expected: false,
      label: 'exclude/contain wholly inside',
    },
    {
      type: 'contain',
      filter: 'exclude',
      box: PARTIAL,
      expected: true,
      label: 'exclude/contain only overlapping',
    },
    {
      type: 'contain',
      filter: 'exclude',
      box: OUTSIDE,
      expected: true,
      label: 'exclude/contain outside',
    },
  ];

  for (const c of cases) {
    const zones = compileZones([zone({ type: c.type, filter: c.filter })]);
    assert.equal(
      keepDetection(c.box, 'person', zones).keep,
      c.expected,
      c.label,
    );
  }
});

test('keepDetection: a zone whose labels exclude this one is ignored entirely', () => {
  const zones = compileZones([zone({ labels: ['vehicle'] })]);
  // An include zone that does not apply to 'person' must not gate a person.
  assert.equal(keepDetection(OUTSIDE, 'person', zones).keep, true);
  assert.equal(keepDetection(OUTSIDE, 'vehicle', zones).keep, false);
});

test('keepDetection: empty labels applies the zone to every label', () => {
  const zones = compileZones([zone({ labels: [] })]);
  assert.equal(keepDetection(OUTSIDE, 'person', zones).keep, false);
  assert.equal(keepDetection(OUTSIDE, 'vehicle', zones).keep, false);
});

test('keepDetection: a privacy mask drops a detection an include zone would have kept', () => {
  const zones = compileZones([
    zone({
      name: 'Everything',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    }),
    zone({ name: 'Bins', isPrivacyMask: true }),
  ]);
  const verdict = keepDetection(INSIDE, 'person', zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.40,0.40,0.10,0.10] inside privacy mask 'Bins'",
  );
});

test('keepDetection: a privacy mask only masks the labels it is scoped to', () => {
  // labels scopes all of a zone's behaviour, privacy masks included. A mask set
  // to 'vehicle' is a vehicle mask; it must not silently hide people too.
  const zones = compileZones([
    zone({ name: 'Road', isPrivacyMask: true, labels: ['vehicle'] }),
  ]);
  assert.equal(keepDetection(INSIDE, 'vehicle', zones).keep, false);
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, true);
});

// A person clipped at the bottom of frame: Amcrest coordinates at or past 8191
// normalize to exactly 1.0, and a zone drawn to the edge of the picture
// compiles to exactly 1.0 too. Both of the following used to fail open.
const BOTTOM_CLIPPED = { x: 0.3, y: 0.55, width: 0.4, height: 0.45 };
const RIGHT_CLIPPED = { x: 0.6, y: 0.2, width: 0.4, height: 0.3 };
const FULL_FRAME_POINTS: DetectionZone['points'] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

test('keepDetection: a full-frame privacy mask masks an object clipped at the frame edge', () => {
  const zones = compileZones([
    zone({
      name: 'Everything',
      points: FULL_FRAME_POINTS,
      isPrivacyMask: true,
    }),
  ]);
  assert.equal(keepDetection(BOTTOM_CLIPPED, 'person', zones).keep, false);
  assert.equal(keepDetection(RIGHT_CLIPPED, 'person', zones).keep, false);
});

test('keepDetection: a full-frame contain/exclude zone drops an object clipped at the frame edge', () => {
  // The README's own recipe for "never alert me about vehicles", combined with
  // its own recommendation to pair exclude with contain.
  const zones = compileZones([
    zone({
      name: 'No vehicles',
      points: FULL_FRAME_POINTS,
      type: 'contain',
      filter: 'exclude',
      labels: ['vehicle'],
    }),
  ]);
  assert.equal(keepDetection(BOTTOM_CLIPPED, 'vehicle', zones).keep, false);
  assert.equal(keepDetection(RIGHT_CLIPPED, 'vehicle', zones).keep, false);
});

test('keepDetection: a full-frame contain/include zone keeps a near-field object', () => {
  const zones = compileZones([
    zone({ name: 'Everything', points: FULL_FRAME_POINTS, type: 'contain' }),
  ]);
  assert.equal(keepDetection(BOTTOM_CLIPPED, 'person', zones).keep, true);
});

test('keepDetection: matching any one of several include zones is enough', () => {
  const zones = compileZones([
    zone({
      name: 'Corner',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    }),
    zone({ name: 'Driveway' }),
  ]);
  assert.equal(keepDetection(INSIDE, 'person', zones).keep, true);
});

test('keepDetection: with only exclude zones, not being excluded is enough', () => {
  const zones = compileZones([zone({ name: 'Street', filter: 'exclude' })]);
  assert.equal(keepDetection(OUTSIDE, 'person', zones).keep, true);
  const verdict = keepDetection(INSIDE, 'person', zones);
  assert.equal(verdict.keep, false);
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.40,0.40,0.10,0.10] inside exclude zone 'Street'",
  );
});

test('keepDetection: failing every include zone names them all', () => {
  const zones = compileZones([
    zone({ name: 'Driveway' }),
    zone({
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
    "box [0.90,0.90,0.05,0.05] outside include zone(s) 'Driveway', 'Porch'",
  );
});

test('keepDetection: the reason names the box that was tested', () => {
  // The box is what makes a suppression diagnosable — "outside 'Driveway'" on
  // its own cannot tell you whether the zone or the coordinates are wrong.
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const verdict = keepDetection(
    { x: 0.7100000000000001, y: 0.9, width: 0.09, height: 0.21 },
    'person',
    zones,
  );
  assert.equal(
    verdict.keep === false && verdict.reason,
    "box [0.71,0.90,0.09,0.21] outside include zone(s) 'Driveway'",
  );
});

test('decideObjectEvent: a deactivation is never filtered, however badly it fails the zones', () => {
  // Load-bearing. Stop payloads carry no boxes of their own, and suppressing a
  // Stop would leave the object sensor latched active forever.
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: false,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(decision.kind, 'skipped');
  assert.equal(decision.kind === 'skipped' && decision.reason, 'deactivation');
  assert.equal(decision.kind === 'skipped' && decision.detections.length, 1);
});

test('decideObjectEvent: an activation with no coordinates fails open', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    { kind: 'object', category: 'person', active: true },
    zones,
  );
  assert.equal(decision.kind, 'skipped');
  assert.equal(
    decision.kind === 'skipped' && decision.reason,
    'no-coordinates',
  );
});

test('decideObjectEvent: an activation whose only box has no area fails open', () => {
  // Some firmware sends a placeholder Rect of [0,0,0,0]. A zero-area box fails
  // every include zone, so filtering it would suppress a real detection on the
  // strength of a terse payload — the exact thing the fail-open rule forbids.
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [{ box: { x: 0, y: 0, width: 0, height: 0 } }],
    },
    zones,
  );
  assert.equal(decision.kind, 'skipped');
  assert.equal(
    decision.kind === 'skipped' && decision.reason,
    'no-coordinates',
  );
  assert.equal(decision.kind === 'skipped' && decision.detections.length, 1);
});

test('decideObjectEvent: a real box alongside a degenerate one is still filtered', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
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
  assert.equal(decision.kind, 'report');
  assert.deepEqual(
    decision.kind === 'report' && decision.detections.map((d) => d.trackId),
    [2],
  );
});

// A mask with a narrow off-centre slot cut out of it, in 0-100 percentages.
const NOTCHED_MASK_POINTS: DetectionZone['points'] = [
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
  // The mixed-payload path: `decideObjectEvent` only fails open when *no*
  // detection has coordinates, so one collapsed Rect next to a real one reaches
  // the mask test on its own. This box spans the mask's slot, which is not
  // masked ground, so the mask must not claim it.
  const zones = compileZones([
    zone({
      name: 'Mask',
      isPrivacyMask: true,
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
  const zones = compileZones([
    zone({
      name: 'Mask',
      isPrivacyMask: true,
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

test('decideObjectEvent: reports only the detections that survive', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
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
  assert.equal(decision.kind, 'report');
  assert.deepEqual(
    decision.kind === 'report' && decision.detections.map((d) => d.trackId),
    [1],
  );
  assert.equal(decision.kind === 'report' && decision.dropped.length, 1);
});

test('decideObjectEvent: suppresses when nothing survives', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(decision.kind, 'suppress');
  assert.deepEqual(decision.kind === 'suppress' && decision.reasons, [
    "box [0.90,0.90,0.05,0.05] outside include zone(s) 'Driveway'",
  ]);
});

test('decideObjectEvent: momentary events are filtered the same way', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      momentary: true,
      detections: [{ box: OUTSIDE }],
    },
    zones,
  );
  assert.equal(decision.kind, 'suppress');
});

test('decideObjectEvent: with no zones, every activation reports unchanged', () => {
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'vehicle',
      active: true,
      detections: [{ box: OUTSIDE }],
    },
    [],
  );
  assert.equal(decision.kind, 'report');
  assert.equal(decision.kind === 'report' && decision.detections.length, 1);
  assert.equal(decision.kind === 'report' && decision.dropped.length, 0);
});

test('keepDetection: a contain zone whose notch opens on the frame edge does not contain a clipped box spanning it', () => {
  // End-to-end guard for the frame-edge notch regression. Without it, a
  // contain+include zone accepts an object largely outside it, and the
  // exclude/privacy-mask form drops a detection it should have kept.
  const zones = compileZones([
    zone({
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

test('decideObjectEvent: a reversed box is filtered, not treated as coordinate-free', () => {
  // classify.ts does not enforce x2 > x1, and geometry.ts normalizes reversed
  // extents. So a reversed box carries real coordinates and must go through the
  // zone test rather than taking the fail-open path meant for empty payloads.
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const decision = decideObjectEvent(
    {
      kind: 'object',
      category: 'person',
      active: true,
      // The OUTSIDE box, expressed back-to-front.
      detections: [{ box: { x: 0.95, y: 0.95, width: -0.05, height: -0.05 } }],
    },
    zones,
  );
  assert.equal(decision.kind, 'suppress');
});

test('findKeptDetection returns the first detection the zones keep', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
  const kept = findKeptDetection(
    [{ box: OUTSIDE }, { box: INSIDE, trackId: 9 }],
    'person',
    zones,
  );
  assert.equal(kept?.trackId, 9);
});

test('findKeptDetection returns undefined when the zones keep none', () => {
  const zones = compileZones([zone({ name: 'Driveway' })]);
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
  const zones = compileZones([zone({ name: 'Driveway' })]);
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
