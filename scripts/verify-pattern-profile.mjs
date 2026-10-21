import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compositions, getComposition } from '../src/compositions/registry.js';
import { createMotionModel } from '../src/motion/model.js';
import { ROST_STYLE, ROST_MOTION, ROST_SPACING, nextSpacingGap } from '../src/motion/pattern-profile.js';
import { buildRostFan } from './build-rost-fan.mjs';

// Every supplied composition shares the approved visual defaults. Future real
// compositions may use a different geometry or motion mode without changing this check.
for (const composition of compositions) {
  assert.deepEqual(composition.style, ROST_STYLE, `${composition.id}: approved ROST stroke style`);
  const model = createMotionModel(composition);
  for (const svg of [model.staticSvg(), model.animatedSvg()]) {
    assert.ok(svg.includes('fill="none"') && svg.includes('stroke-linejoin="miter"'),
      `${composition.id}: exported lines remain open strokes with sharp joins`);
    assert.ok(svg.includes(`stroke="${ROST_STYLE.stroke}"`) && svg.includes(`stroke-width="${ROST_STYLE.strokeWidth}"`),
      `${composition.id}: export uses the shared color and width`);
  }
}

const fan = getComposition('rost-fan');
assert.deepEqual(fan.motion, ROST_MOTION, 'The new pattern keeps the approved tempo and fades');
const storedFan = JSON.parse(readFileSync(new URL('../src/compositions/rost-fan.json', import.meta.url), 'utf8'));
assert.deepEqual(fan, storedFan, 'The registry exposes the saved real composition');
assert.deepEqual(buildRostFan(), storedFan, 'The saved geometry is reproducible from its Figma SVG and shared spacing profile');

const reference = getComposition('rost-fold');
assert.ok(fan.rows.length > ROST_SPACING.length, 'The longer pattern adds rows beyond the original spacing profile');
let maxGapError = 0;
for (let row = 1; row < fan.rows.length; row++) {
  const previous = fan.rows[row - 1][2], current = fan.rows[row][2];
  const actual = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
  // Compare against the approved geometry as well as the public profile helper:
  // a future profile refactor must not silently stretch all gaps to fit a span.
  const referenceRow = Math.min(row, reference.rows.length - 1);
  const referencePrevious = reference.rows[referenceRow - 1][28], referenceCurrent = reference.rows[referenceRow][28];
  const expected = Math.hypot(referenceCurrent[0] - referencePrevious[0], referenceCurrent[1] - referencePrevious[1]);
  assert.ok(Math.abs(nextSpacingGap(row - 1) - expected) < 1e-10, `Profile step ${row} matches the original fold`);
  maxGapError = Math.max(maxGapError, Math.abs(actual - expected));
  assert.ok(Math.abs(actual - expected) < 1e-6, `New row ${row}: absolute ridge gap ${actual}, expected ${expected}`);
}

const model = createMotionModel(fan);
assert.deepEqual(fan.arrows.map(arrow => arrow.vertex).toSorted((a, b) => a - b), [1, 2],
  'Both annotated folds participate in the new motion');
let directionSamples = 0;
const steps = model.lineCount * 80;
for (const inverted of [false, true]) {
  const direction = model.direction * (inverted ? -1 : 1);
  for (let step = 0; step < steps; step++) {
    const fromDepth = direction > 0 ? step / 80 : (steps - step) / 80;
    const toDepth = direction > 0 ? (step + 1) / 80 : (steps - step - 1) / 80;
    const from = model.pointsAt(fromDepth), to = model.pointsAt(toDepth);
    for (const arrow of fan.arrows) {
      const velocity = to[arrow.vertex].map((value, axis) => value - from[arrow.vertex][axis]);
      const requested = arrow.to.map((value, axis) => (value - arrow.from[axis]) * (inverted ? -1 : 1));
      const dot = velocity[0] * requested[0] + velocity[1] * requested[1];
      assert.ok(dot > 0, `${arrow.id}: ${inverted ? 'inverted' : 'normal'} motion follows the requested direction at depth ${fromDepth}`);
      directionSamples++;
    }
  }
}

console.log(`Shared pattern profile passed: ${compositions.length} supplied compositions, ${fan.rows.length - 1} exact ridge gaps (max error ${maxGapError.toExponential(3)} px), ${directionSamples} forward/reverse arrow samples, reproducible Figma geometry.`);
