import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMotionModel, LIMITS } from '../src/motion/model.js';
import { ROST_STYLE, ROST_MOTION, ROST_SPACING, nextSpacingGap } from '../src/motion/pattern-profile.js';

const sourceUrl = new URL('../assets/figma-pattern-2179-1529.svg', import.meta.url);
const outputUrl = new URL('../src/compositions/rost-fan.json', import.meta.url);
const arrows = [
  { id: 'left-fold-flow', vertex: 2, from: [1025, 25], to: [330, 740] },
  { id: 'valley-flow', vertex: 1, from: [1248, 646], to: [1218, 774] },
];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = value => Number(value.toFixed(8));

function parseRows(svg) {
  const rows = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(([, d]) => {
    if (/[^ML\d\s.,+eE-]/.test(d)) throw new Error('Source must contain open M/L paths.');
    const values = d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite)) throw new Error('Invalid source coordinates.');
    return Array.from({ length: values.length / 2 }, (_, i) => values.slice(i * 2, i * 2 + 2));
  });
  if (rows.length !== 51) throw new Error('Expected 51 source paths from Figma 2179:1529.');
  return rows;
}

/** Four homologous vertices per source row, ordered far-right / valley / ridge / left-end. */
export function sourceRows(svgText = fs.readFileSync(sourceUrl, 'utf8')) {
  const paths = parseRows(svgText);
  // Fit the ridge track only to complete, reliable source rows 22–45.
  const ridges = paths.slice(21, 45).map(row => {
    if (row.length !== 4) throw new Error('Unexpected complete source topology.');
    return row[2];
  });
  const mean = [0, 1].map(axis => ridges.reduce((sum, point) => sum + point[axis], 0) / ridges.length);
  const slope = ridges.reduce((sum, p) => sum + (p[0] - mean[0]) * (p[1] - mean[1]), 0)
    / ridges.reduce((sum, p) => sum + (p[0] - mean[0]) ** 2, 0);
  const intercept = mean[1] - slope * mean[0];
  const lastComplete = paths[45];
  if (lastComplete.length !== 4) throw new Error('Expected four vertices in source row 46.');
  const hiddenArm = lastComplete[3].map((value, axis) => value - lastComplete[2][axis]);
  const complete = paths.slice(18).map((row, index) => {
    const sourceNumber = index + 19;
    if (sourceNumber < 47) {
      if (row.length !== 4) throw new Error(`Unexpected topology in source row ${sourceNumber}.`);
      return row.map(point => [...point]);
    }
    if (row.length !== 3) throw new Error(`Expected truncated source row ${sourceNumber}.`);
    const [right, valley, end] = row;
    const delta = end.map((value, axis) => value - valley[axis]);
    // Extend the existing segment along its own ray, preserving every visible pixel.
    const t = (slope * valley[0] + intercept - valley[1]) / (delta[1] - slope * delta[0]);
    if (!Number.isFinite(t) || t < 1) throw new Error('Restored ridge must extend the truncated ray.');
    const ridge = valley.map((value, axis) => value + t * delta[axis]);
    const left = ridge.map((value, axis) => value + hiddenArm[axis]);
    if (ridge[1] >= -LIMITS.maxStroke * 2 || left[1] >= -LIMITS.maxStroke * 2) {
      throw new Error('Restored source arm would enter the visible viewport.');
    }
    return [[...right], [...valley], ridge, left];
  });
  // The annotated direction is down-left: source row 51 travels towards row 19.
  return complete.reverse();
}

function composition(rows, id = 'rost-fan') {
  return {
    version: 1,
    id,
    title: 'Р.О.С.Т. / диагональный паттерн',
    source: 'Figma RnBHxdFLuCb2eIb6NTBCap, node 2179:1529; spacing matched to rost-fold vertex 28',
    viewBox: [1920, 793],
    style: { ...ROST_STYLE },
    motion: { ...ROST_MOTION, mode: 'sampled-rows' },
    rows,
    arrows: structuredClone(arrows),
  };
}

/** Rebuild data without writing files. Target gaps are absolute; no span fitting. */
export function buildRostFan(svgText = fs.readFileSync(sourceUrl, 'utf8')) {
  const canonical = sourceRows(svgText);
  const source = createMotionModel(composition(canonical, 'rost-fan-source'));
  const finalIndex = canonical.length - 1;
  const final = canonical[finalIndex], before = canonical[finalIndex - 1];
  const evaluate = depth => depth <= finalIndex ? source.pointsAt(depth)
    : final.map((point, vertex) => point.map((value, axis) => value
      + (depth - finalIndex) * (value - before[vertex][axis])));
  const rows = [evaluate(0)];
  let depth = 0;
  const belowViewport = row => row.every(point => point[1] > 793 + LIMITS.maxStroke * 2);
  while (!belowViewport(rows.at(-1))) {
    if (rows.length >= LIMITS.maxLines) throw new Error('Spacing profile exceeds the composition row limit.');
    const previous = rows.at(-1)[2], gap = nextSpacingGap(rows.length - 1);
    let low = depth, high = depth + 1;
    while (distance(evaluate(high)[2], previous) < gap) {
      high = depth + (high - depth) * 2;
      if (high > 1024) throw new Error('Cannot advance along the source ridge.');
    }
    // The source ridge is monotone. Solve the chord, not accumulated arc length,
    // so every neighbouring pair has the exact spacing of the approved pattern.
    for (let iteration = 0; iteration < 64; iteration++) {
      const middle = (low + high) / 2;
      if (distance(evaluate(middle)[2], previous) < gap) low = middle;
      else high = middle;
    }
    depth = (low + high) / 2;
    rows.push(evaluate(depth));
  }
  const result = composition(rows.map(row => row.map(point => point.map(round))));
  createMotionModel(result); // Validate direction, topology and the off-screen exit.
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = buildRostFan();
  fs.writeFileSync(outputUrl, `${JSON.stringify(result, null, 2)}\n`);
  const maximumGapError = Math.max(...result.rows.slice(1).map((row, index) =>
    Math.abs(distance(row[2], result.rows[index][2]) - nextSpacingGap(index))));
  console.log(`Built rost-fan: ${result.rows.length} rows × 4 vertices; ${ROST_SPACING.length - 1} original gap steps, then the final gap repeated.`);
  console.log(`Maximum gap error: ${maximumGapError.toExponential(3)} px; exit min Y: ${Math.min(...result.rows.at(-1).map(point => point[1])).toFixed(3)} px.`);
}
