import assert from 'node:assert/strict';
import { createMotionModel, validateComposition } from '../src/motion/model.js';
import { compositions, getComposition } from '../src/compositions/registry.js';
import * as legacy from './fixtures/rost-v1-geometry.js';

const clone = value => structuredClone(value);
const tracks = svg => [...svg.matchAll(/<animate\b[^>]*attributeName="([^"]+)"[^>]*values="([^"]+)"/g)]
  .map(([, name, values]) => ({ name, values: values.split(';') }));
const initialPaths = svg => [...svg.matchAll(/<path d="([^"]+)" stroke-opacity="([^"]+)"><animate/g)]
  .map(([, path, opacity]) => ({ path, opacity: Number(opacity) }));
let geometrySamples = 0;

for (const composition of compositions) {
  const model = createMotionModel(composition);
  assert.equal(model.direction, 1);
  assert.equal(model.opacityAt(0), 0);
  for (let step = 0; step <= model.lineCount * 80; step++) {
    const depth = step / 80;
    assert.ok(model.pointsAt(depth).flat().every(Number.isFinite));
    assert.ok(model.opacityAt(depth) >= 0 && model.opacityAt(depth) <= composition.style.opacity);
    geometrySamples++;
  }
  if (composition.motion.mode === 'arrow-field') {
    assert.deepEqual(model.pointsAt(0), composition.basePath, 'Each trajectory starts at its arrow tail');
    assert.deepEqual(model.pointsAt(model.lineCount), composition.arrows.map(arrow => arrow.to), 'Each trajectory ends at its arrow head');
    assert.equal(model.opacityAt(model.lineCount), 0, 'The end of an in-frame trajectory is invisible');
    const start = model.pointsAt(1), next = model.pointsAt(2);
    for (const arrow of composition.arrows) {
      const velocity = next[arrow.vertex].map((value, axis) => value - start[arrow.vertex][axis]);
      const vector = arrow.to.map((value, axis) => value - arrow.from[axis]);
      assert.ok(velocity[0] * vector[0] + velocity[1] * vector[1] > 0, 'The actual motion follows every arrow');
      assert.ok(Math.abs(velocity[0] * vector[1] - velocity[1] * vector[0]) < 1e-7, 'Trajectory is collinear with its arrow');
    }
  }
  const forward = tracks(model.animatedSvg());
  const reverse = tracks(model.animatedSvg({ inverted: true }));
  assert.equal(forward.length, model.lineCount * 2);
  assert.equal(reverse.length, forward.length);
  for (let i = 0; i < forward.length; i++) {
    assert.deepEqual(reverse[i].values, forward[i].values.toReversed(), 'Export reverses geometry and opacity together');
  }
  for (let row = 0; row < model.lineCount - 1; row++) {
    assert.equal(forward[row * 2].values.at(-1), forward[(row + 1) * 2].values[0]);
    assert.equal(forward[row * 2 + 1].values.at(-1), forward[(row + 1) * 2 + 1].values[0]);
    assert.equal(reverse[(row + 1) * 2].values.at(-1), reverse[row * 2].values[0]);
    assert.equal(reverse[(row + 1) * 2 + 1].values.at(-1), reverse[row * 2 + 1].values[0]);
  }
  for (const inverted of [false, true]) {
    const svg = model.animatedSvg({ inverted });
    const values = tracks(svg);
    initialPaths(svg).forEach((initial, row) => {
      assert.equal(initial.path, values[row * 2].values[0], 'Initial state matches the first animation sample');
      assert.ok(Math.abs(initial.opacity - Number(values[row * 2 + 1].values[0])) < 1e-5);
    });
    assert.ok(!svg.includes('<script') && !svg.includes('<image') && !svg.includes('<marker'), 'Exports contain no code, external images, or instruction arrows');
  }
}

const source = createMotionModel(getComposition('rost-fold'));
for (let step = 0; step <= 2600; step++) {
  const depth = step / 100;
  assert.deepEqual(source.pointsAt(depth), legacy.pointsAt(depth), `Original ROST geometry at ${depth}`);
  assert.equal(source.pathAt(depth), legacy.pathAt(depth));
  assert.ok(Math.abs(source.opacityAt(depth) - legacy.opacityAt(depth)) < 1e-14, 'Original opacity within floating-point roundoff');
}
assert.equal(source.seconds, 1.5);
const reversedSource = getComposition('rost-fold');
reversedSource.arrows.forEach(arrow => { [arrow.from, arrow.to] = [arrow.to, arrow.from]; });
const reversed = createMotionModel(reversedSource);
assert.equal(reversed.direction, -1, 'Reversing all sampled arrows changes playback direction');
assert.deepEqual(tracks(reversed.animatedSvg()), tracks(source.animatedSvg({ inverted: true })));

function rejects(id, mutate, pattern) {
  const candidate = getComposition(id);
  mutate(candidate);
  assert.throws(() => validateComposition(candidate), pattern);
}
rejects('rost-fold', c => { [c.arrows[0].from, c.arrows[0].to] = [c.arrows[0].to, c.arrows[0].from]; }, /противоположные/);
rejects('rost-fold', c => { c.arrows[0].to = [...c.arrows[0].from]; }, /длина/);
rejects('rost-fold', c => { c.rows[0][0][0] = NaN; }, /число/);
rejects('rost-fold', c => { c.rows[0].pop(); }, /одинаковое/);
rejects('chevron', c => { c.arrows.pop(); }, /каждой/);
rejects('chevron', c => { c.arrows[0].from[0] += 1; }, /начало стрелки/);
rejects('chevron', c => { c.arrows[1].vertex = 0; }, /уникальны/);
rejects('chevron', c => { c.motion.fadeOut = 0; }, /последняя линия/);
rejects('chevron', c => { c.perspective = 0; }, /perspective/);
rejects('chevron', c => { c.lineCount = 100000; }, /lineCount/);
rejects('chevron', c => { c.style.stroke = 'red" onclick="alert(1)'; }, /#RRGGBB/);
rejects('chevron', c => { c.version = 2; }, /версия 1/);
rejects('chevron', c => { c.callback = 'eval'; }, /неизвестное/);
assert.throws(() => source.animatedSvg({ seconds: NaN }), /число/);
assert.throws(() => source.staticSvg({ width: '3" onload="alert(1)' }), /число/);

const maliciousTitle = getComposition('chevron');
maliciousTitle.title = '<script>alert("test")</script>';
const escaped = createMotionModel(maliciousTitle).staticSvg();
assert.ok(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;'));
const input = getComposition('chevron');
const snapshot = createMotionModel(input);
const first = snapshot.pathAt(1);
input.arrows[0].to[0] = 999;
assert.equal(snapshot.pathAt(1), first, 'External object edits cannot mutate the running model');
assert.notDeepEqual(clone(input), snapshot.composition);
console.log(`Composition models passed: ${compositions.length} compositions, ${geometrySamples} finite geometry samples, 2601 original-fidelity samples, forward/reverse seams, arrows, export escaping and invalid inputs.`);
