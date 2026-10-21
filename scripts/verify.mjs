import assert from 'node:assert/strict';
import {
  HEIGHT, LINE_COUNT, OPACITY, sourceLines,
  pointsAt, pathAt, opacityAt, staticSvg, animatedSvg,
} from '../src/geometry.js';

const MAX_STROKE = 8;
const MITER_LIMIT = 4; // SVG default; include joins in the offscreen margin.
const SVG_STEPS = 40;
const MAX_EXPORT_ERROR = .02; // ViewBox pixels, including 0.001 px serialization.
const counts = { geometrySamples: 0, exportSamples: 0 };

function readPoints(path) {
  const numbers = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  assert.equal(numbers.length, sourceLines[0].length * 2, 'Every exported row retains all source points');
  return Array.from({ length: numbers.length / 2 }, (_, i) => numbers.slice(i * 2, i * 2 + 2));
}

function maxDistance(a, b) {
  return Math.max(...a.map((point, j) => Math.hypot(point[0] - b[j][0], point[1] - b[j][1])));
}

assert.equal(LINE_COUNT, 26, 'All 26 Figma rows are present');
assert.ok(sourceLines.every(row => row.length === 36), 'Each source row retains its 36 centerline points');
for (let row = 0; row < LINE_COUNT; row++) {
  assert.deepEqual(pointsAt(row), sourceLines[row], `Integer depth ${row} reproduces the source exactly`);
}

let previous = pointsAt(0);
let minimumVerticalStep = Infinity;
let minimumExitY = Infinity;
let previousOpacity = opacityAt(0);
for (let step = 0; step <= LINE_COUNT * 160; step++) {
  const depth = step / 160;
  const points = pointsAt(depth);
  const opacity = opacityAt(depth);
  assert.ok(Number.isFinite(opacity) && opacity >= 0 && opacity <= OPACITY, `Valid opacity at ${depth}`);
  assert.ok(opacity >= previousOpacity - 1e-12, `No opacity reversal at ${depth}`);
  points.forEach((point, j) => {
    assert.ok(point.every(Number.isFinite), `Finite point ${j} at depth ${depth}`);
    if (step) {
      const dy = point[1] - previous[j][1];
      minimumVerticalStep = Math.min(minimumVerticalStep, dy);
      assert.ok(dy > 0, `Point ${j} continues toward the viewer at depth ${depth}`);
    }
    if (depth >= LINE_COUNT - 1) {
      minimumExitY = Math.min(minimumExitY, point[1]);
      assert.ok(point[1] > HEIGHT + MAX_STROKE / 2 * MITER_LIMIT,
        `Recycled row stays below the viewport, including 8 px miter joins: ${depth}`);
    }
  });
  previous = points;
  previousOpacity = opacity;
  counts.geometrySamples++;
}

// One-sided velocities meet at every source row, including extrapolation.
// This also covers the temporal seam: a row ending at q becomes its neighbour.
const epsilon = 1e-4;
let maximumVelocityDifference = 0;
for (let depth = 1; depth < LINE_COUNT; depth++) {
  const before = pointsAt(depth - epsilon);
  const at = pointsAt(depth);
  const after = pointsAt(depth + epsilon);
  for (let j = 0; j < at.length; j++) {
    for (let axis = 0; axis < 2; axis++) {
      const leftVelocity = (at[j][axis] - before[j][axis]) / epsilon;
      const rightVelocity = (after[j][axis] - at[j][axis]) / epsilon;
      const difference = Math.abs(rightVelocity - leftVelocity);
      maximumVelocityDifference = Math.max(maximumVelocityDifference, difference);
      assert.ok(difference < .02, `Continuous velocity at depth ${depth}, point ${j}, axis ${axis}`);
    }
  }
}
assert.equal(opacityAt(0), 0, 'The incoming path is invisible at the loop seam');
assert.ok(opacityAt(epsilon) / epsilon < .01, 'The incoming opacity starts with zero velocity');
assert.ok((opacityAt(.65) - opacityAt(.65 - epsilon)) / epsilon < .01,
  'The incoming opacity meets full opacity smoothly');

const svg = animatedSvg({ width: MAX_STROKE });
const animatedPaths = [...svg.matchAll(/<path d="([^"]+)" stroke-opacity="([^"]+)">([\s\S]*?)<\/path>/g)];
assert.equal(animatedPaths.length, LINE_COUNT, 'Export contains every animated row');
const frames = animatedPaths.map(([, initialPath, initialOpacity, content], row) => {
  const tracks = [...content.matchAll(/<animate\b([^>]+)\/>/g)].map(([, attributes]) =>
    Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
  const shape = tracks.find(track => track.attributeName === 'd');
  const opacity = tracks.find(track => track.attributeName === 'stroke-opacity');
  assert.ok(shape && opacity, `Shape and opacity tracks exist for row ${row}`);
  assert.equal(shape.repeatCount, 'indefinite');
  assert.equal(opacity.repeatCount, 'indefinite');
  assert.equal(shape.dur, opacity.dur, 'Geometry and opacity share the same clock');
  assert.equal(shape.calcMode, 'linear');
  const paths = shape.values.split(';');
  const times = shape.keyTimes.split(';').map(Number);
  const opacities = opacity.values.split(';').map(Number);
  assert.equal(paths.length, SVG_STEPS + 1, 'Export has 40 interpolation intervals');
  assert.equal(opacities.length, paths.length);
  assert.equal(opacity.keyTimes, shape.keyTimes);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 1);
  assert.ok(times.every((time, i) => time === i / SVG_STEPS));
  assert.equal(initialPath, paths[0]);
  assert.ok(Math.abs(Number(initialOpacity) - opacities[0]) < 1e-5);
  return { paths, points: paths.map(readPoints), opacities };
});

let maximumExportError = 0;
let maximumOpacityError = 0;
for (let row = 0; row < LINE_COUNT; row++) {
  const frame = frames[row];
  if (row < LINE_COUNT - 1) {
    assert.equal(frame.paths.at(-1), frames[row + 1].paths[0], `Exact geometric loop permutation for row ${row}`);
    assert.equal(frame.opacities.at(-1), frames[row + 1].opacities[0], `Exact opacity loop permutation for row ${row}`);
  }
  for (let interval = 0; interval < SVG_STEPS; interval++) {
    for (let sample = 0; sample <= 10; sample++) {
      const mix = sample / 10;
      const depth = row + (interval + mix) / SVG_STEPS;
      const interpolated = frame.points[interval].map((point, j) => point.map((value, axis) =>
        value + (frame.points[interval + 1][j][axis] - value) * mix));
      const error = maxDistance(interpolated, pointsAt(depth));
      maximumExportError = Math.max(maximumExportError, error);
      assert.ok(error <= MAX_EXPORT_ERROR, `SMIL interpolation error ${error} px at depth ${depth}`);
      const interpolatedOpacity = frame.opacities[interval]
        + (frame.opacities[interval + 1] - frame.opacities[interval]) * mix;
      maximumOpacityError = Math.max(maximumOpacityError, Math.abs(interpolatedOpacity - opacityAt(depth)));
      counts.exportSamples++;
    }
  }
}
assert.ok(maximumOpacityError < .001, 'SMIL opacity sampling remains within 0.001');
assert.equal(frames[0].opacities[0], 0, 'SVG hides the new first row at the seam');
assert.equal(frames.at(-1).paths.at(-1), pathAt(LINE_COUNT));

// Static export remains editable open stroked paths, with no closed filled outlines.
const still = staticSvg({ original: true });
assert.equal((still.match(/<path\b/g) ?? []).length, LINE_COUNT);
assert.ok(still.includes('fill="none"') && still.includes('stroke-width="3"'));
assert.ok([...still.matchAll(/<path d="([^"]+)"/g)].every(([, path]) => !/[Zz]/.test(path)));

console.log(`Passed: ${LINE_COUNT} source rows × 36 points; ${counts.geometrySamples} motion samples; ${counts.exportSamples} SVG samples.`);
console.log(`Loop: exact geometry/opacity permutation; exit clearance ${(minimumExitY - HEIGHT).toFixed(3)} px at max stroke ${MAX_STROKE} px.`);
console.log(`Maximum SVG position error: ${maximumExportError.toFixed(6)} px; opacity error: ${maximumOpacityError.toFixed(6)}.`);
console.log(`Minimum downward step: ${minimumVerticalStep.toFixed(6)} px; maximum one-sided velocity difference: ${maximumVelocityDifference.toFixed(6)} px/depth.`);
