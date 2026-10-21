import assert from 'node:assert/strict';
import { gsap } from 'gsap';
import { compositions } from '../src/compositions/registry.js';
import { createMotionModel, LIMITS } from '../src/motion/model.js';
import { createMotionPlayer, wrapPhase } from '../src/player.js';

const densities = [.5, .51, .75, .99, 1, 1.01, 1.17, 1.5, 1.99, 2];
const invalid = [-1, 0, .4999, 2.0001, NaN, Infinity, -Infinity, '1', null, {}, []];
const close = (actual, expected, message, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
const equalPoints = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((point, vertex) => point.forEach((value, axis) => close(value, expected[vertex][axis], message)));
};
const tracks = svg => [...svg.matchAll(/<animate\b[^>]*attributeName="([^"]+)"[^>]*dur="([^"]+)s"[^>]*values="([^"]+)"/g)]
  .map(([, name, seconds, values]) => ({ name, seconds: Number(seconds), values: values.split(';') }));
const staticPaths = svg => [...svg.matchAll(/<path d="([^"]+)" stroke-opacity="([^"]+)"\/>/g)]
  .map(([, path, opacity]) => ({ path, opacity: Number(opacity) }));

// Invisible endpoints must not create extra visible geometry when ceil() adds a
// partial row. The margin covers the largest supported stroke/miter extension.
const outside = (points, width, height) => {
  const margin = LIMITS.maxStroke * 2;
  return points.every(p => p[0] < -margin) || points.every(p => p[0] > width + margin)
    || points.every(p => p[1] < -margin) || points.every(p => p[1] > height + margin);
};
const visibleSnapshot = (model, phase) => Array.from({ length: model.lineCount }, (_, row) => row + phase)
  .filter(depth => model.opacityAt(depth) > 1e-12 && !outside(model.pointsAt(depth), model.width, model.height))
  .map(depth => `${model.pathAt(depth)}|${model.opacityAt(depth).toFixed(10)}`).sort();

// A short fixture with visible endpoints exercises opacity-based exits as well
// as the production patterns' geometric exits; it is not a registered scene.
const field = {
  version: 1, id: 'density-contract', title: 'Density contract', viewBox: [100, 100],
  style: { stroke: '#dd192d', background: '#1a1d24', strokeWidth: 3, opacity: .6 },
  motion: { mode: 'arrow-field', secondsPerStep: 1.5, fadeIn: .5, fadeOut: 1 },
  basePath: [[10, 10], [90, 10]], lineCount: 5, perspective: 2,
  arrows: [
    { id: 'left', vertex: 0, from: [10, 10], to: [10, 90] },
    { id: 'right', vertex: 1, from: [90, 10], to: [90, 90] },
  ],
};

assert.equal(LIMITS.minDensity, .5);
assert.equal(LIMITS.maxDensity, 2);
let geometrySamples = 0, fractionalTails = 0;
for (const composition of [...compositions, field]) {
  const base = createMotionModel(composition);
  assert.equal(base.density, 1);
  assert.equal(base.baseLineCount, base.lineCount);
  assert.deepEqual(base.composition, composition, 'Density remains playback state, not a mutation of source geometry');
  for (const bad of invalid) {
    assert.throws(() => createMotionModel(composition, { density: bad }), `Reject density ${String(bad)}`);
    assert.throws(() => base.staticSvg({ density: bad }));
    assert.throws(() => base.animatedSvg({ density: bad }));
  }
  for (const density of densities) {
    const model = createMotionModel(composition, { density });
    const label = `${composition.id} at ${density}`;
    assert.equal(model.density, density);
    assert.equal(model.baseLineCount, base.lineCount);
    assert.equal(model.lineCount, Math.ceil(base.lineCount * density));
    close(model.seconds * density, base.seconds, `${label}: density does not change physical motion speed`);
    assert.deepEqual(model.composition, composition, `${label}: immutable source`);
    for (let step = 0; step <= 120; step++) {
      const depth = model.lineCount * step / 120;
      const originalDepth = Math.min(depth / density, base.lineCount);
      const points = model.pointsAt(depth);
      assert.ok(points.flat().every(Number.isFinite), `${label}: finite geometry`);
      equalPoints(points, base.pointsAt(originalDepth), `${label}: same geometric trajectory`);
      const opacity = model.opacityAt(depth);
      assert.ok(Number.isFinite(opacity) && opacity >= 0 && opacity <= composition.style.opacity);
      close(opacity, depth / density > base.lineCount ? 0 : base.opacityAt(originalDepth), `${label}: fade envelope`);
      geometrySamples++;
    }
    if (model.lineCount > base.lineCount * density) {
      const partialTail = (base.lineCount * density + model.lineCount) / 2;
      assert.equal(model.opacityAt(partialTail), 0, `${label}: ceil tail remains invisible`);
      equalPoints(model.pointsAt(partialTail), base.pointsAt(base.lineCount), `${label}: ceil tail is clamped`);
      fractionalTails++;
    }
    // Travel for the same elapsed seconds from corresponding positions. Scaling
    // geometry alone would pass the path tests but fail this velocity check.
    for (const position of [.1, .4, .75]) {
      const depth = base.lineCount * position, elapsed = .02;
      equalPoints(model.pointsAt(depth * density + elapsed / model.seconds),
        base.pointsAt(depth + elapsed / base.seconds), `${label}: elapsed-time displacement`);
    }
    for (const reverse of [false, true]) {
      assert.deepEqual(visibleSnapshot(model, reverse ? 1 : 0), visibleSnapshot(model, reverse ? 0 : 1),
        `${label}: visible seam in ${reverse ? 'reverse' : 'forward'} playback`);
    }
    const still = model.staticSvg({ phase: .37 });
    const stillRows = staticPaths(still);
    assert.equal(stillRows.length, model.lineCount);
    stillRows.forEach((row, index) => {
      assert.equal(row.path, model.pathAt(index + .37));
      close(row.opacity, model.opacityAt(index + .37), `${label}: static opacity`, 1e-5);
    });
    assert.deepEqual(staticPaths(base.staticSvg({ density, phase: .37 })), stillRows,
      `${label}: static density override uses the same model`);
    const forward = tracks(model.animatedSvg({ inverted: model.direction < 0 }));
    const reverse = tracks(model.animatedSvg({ inverted: model.direction > 0 }));
    assert.equal(forward.length, model.lineCount * 2);
    assert.equal(reverse.length, forward.length);
    assert.deepEqual(tracks(base.animatedSvg({ density, inverted: model.direction < 0 })), forward,
      `${label}: animated density override uses the same duration and geometry`);
    for (let track = 0; track < forward.length; track++) {
      close(forward[track].seconds, model.seconds, `${label}: exported duration`);
      assert.deepEqual(reverse[track].values, forward[track].values.toReversed(), `${label}: export reverses all tracks`);
    }
    for (let row = 0; row < model.lineCount - 1; row++) {
      assert.equal(forward[row * 2].values.at(-1), forward[(row + 1) * 2].values[0], `${label}: adjacent geometry seam`);
      assert.equal(forward[row * 2 + 1].values.at(-1), forward[(row + 1) * 2 + 1].values[0], `${label}: adjacent opacity seam`);
    }
  }
}
assert.ok(fractionalTails > 0, 'Exercise fractional row counts explicitly');

// All valid composition tempos must remain exportable at the player's extreme
// speed and density settings, even though MP4 has separate frame-rate limits.
for (const [secondsPerStep, density, speed] of [[.1, 2, 2], [60, .5, .25]]) {
  const model = createMotionModel({ ...field, motion: { ...field.motion, secondsPerStep } }, { density });
  const seconds = model.seconds / speed;
  assert.ok(tracks(model.animatedSvg({ seconds })).every(track => track.seconds === seconds));
}

// This is a unit harness for the player, not a browser or visual substitute.
// Real GSAP is advanced deterministically; only the SVG mutation sink is stubbed.
class Element {
  constructor() { this.attributes = new Map(); this.children = []; this.style = {}; this.classList = { add() {} }; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  append(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { this.children.forEach(child => { child.parent = null; }); this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
}
const eventTarget = () => {
  const listeners = new Map();
  return { listeners, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); } };
};
const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const savedMatchMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
const documentStub = { ...eventTarget(), hidden: false, createElementNS: () => new Element() };
const mediaStub = { ...eventTarget(), matches: false };
Object.defineProperty(globalThis, 'document', { configurable: true, value: documentStub });
Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => mediaStub });
let player;
try {
  const previousTweens = new Set(gsap.globalTimeline.getChildren());
  const svg = new Element();
  player = createMotionPlayer(svg, createMotionModel(compositions[0]));
  const tween = gsap.globalTimeline.getChildren().find(item => !previousTweens.has(item));
  assert.ok(tween, 'Use the actual player tween');
  player.setPaused(true); player.setInverted(true); player.setSpeed(1.4); player.setWidth(5.25); player.seek(.37);
  for (const density of [1.37, .5, 2]) {
    const before = player.state;
    player.setDensity(density);
    const after = player.state;
    for (const key of ['paused', 'inverted', 'speed', 'width', 'phase']) assert.equal(after[key], before[key], `Density preserves player ${key}`);
    assert.equal(after.density, density);
    assert.equal(player.model.density, density);
    assert.equal(svg.children[0].children.length, player.model.lineCount);
    close(tween.duration(), player.model.seconds, 'Player duration follows density', 1e-7); // GSAP rounds duration to 7 decimal places.
    close(tween.timeScale(), before.speed, 'Player speed remains applied');
    assert.equal(tween.paused(), true);
    // Advancing the actual tween catches a phase offset that looks correct in
    // state immediately after setDensity but jumps on the following update.
    const phase = after.phase, dt = .025;
    tween.totalTime(tween.totalTime() + dt);
    close(player.state.phase, wrapPhase(phase - dt / player.model.seconds), 'Next animation update has no density reset', 2e-6);
  }
  player.setPaused(false); player.seek(.63);
  player.setDensity(1.23);
  assert.equal(player.state.paused, false, 'Density preserves playing state');
  assert.equal(tween.paused(), false, 'Density does not stop an active player');
  close(player.state.phase, .63, 'Active player preserves phase');
  documentStub.hidden = true; documentStub.listeners.get('visibilitychange')();
  player.setDensity(.75);
  assert.equal(player.state.paused, false, 'Hidden-tab suspension does not change the user pause state');
  assert.equal(tween.paused(), true, 'Density does not resume animation while the tab is hidden');
  documentStub.hidden = false; documentStub.listeners.get('visibilitychange')();
  assert.equal(tween.paused(), false);
  player.setPaused(true);
  const preservedDensity = player.state.density;
  player.setModel(createMotionModel(compositions.at(-1)));
  assert.equal(player.state.density, preservedDensity, 'Composition switching preserves density');
  assert.equal(player.model.density, preservedDensity);
  assert.equal(player.model.baseLineCount, compositions.at(-1).rows.length);
  const beforeInvalid = player.state;
  for (const bad of invalid) assert.throws(() => player.setDensity(bad));
  assert.deepEqual(player.state, beforeInvalid, 'Rejected density does not partially change player state');
  player.destroy(); player = null;
  assert.equal(svg.children.length, 0);
  assert.equal(documentStub.listeners.size, 0);
  assert.equal(mediaStub.listeners.size, 0);
} finally {
  player?.destroy();
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
  if (savedMatchMedia) Object.defineProperty(globalThis, 'matchMedia', savedMatchMedia); else delete globalThis.matchMedia;
  gsap.ticker.sleep();
}
console.log(`Density passed: ${densities.length} settings across ${compositions.length} real patterns and an internal fixture, ${geometrySamples} trajectory samples, ${fractionalTails} fractional tails, SVG seams/overrides, physical speed and player state continuity.`);
