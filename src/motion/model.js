/** Versioned, renderer-independent geometry. Units are SVG viewBox units. */
export const LIMITS = Object.freeze({ maxLines: 80, maxPoints: 128, maxTotalPoints: 8192, maxCoordinate: 1e6, maxStroke: 24 });
const MODES = ['sampled-rows', 'arrow-field'];
const COLOR = /^#[\da-f]{6}$/i;
const own = (value, field) => Object.hasOwn(value, field);
const fail = (field, message) => { throw new Error(`Композиция: ${field} — ${message}`); };
const object = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'ожидается объект');
};
const number = (value, field, low, high) => {
  if (!Number.isFinite(value) || value < low || value > high) fail(field, `ожидается число от ${low} до ${high}`);
};
const integer = (value, field, low, high) => {
  number(value, field, low, high);
  if (!Number.isInteger(value)) fail(field, 'ожидается целое число');
};
const text = (value, field, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(field, `ожидается непустой текст до ${max} символов`);
};
const keys = (value, allowed, field) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${field}.${key}`, 'неизвестное поле версии 1');
};
function point(value, field) {
  if (!Array.isArray(value) || value.length !== 2) fail(field, 'ожидается точка [x, y]');
  value.forEach((coordinate, axis) => number(coordinate, `${field}[${axis}]`, -LIMITS.maxCoordinate, LIMITS.maxCoordinate));
}
function path(value, field) {
  if (!Array.isArray(value) || value.length < 2 || value.length > LIMITS.maxPoints) fail(field, `нужно 2–${LIMITS.maxPoints} точек`);
  value.forEach((p, i) => point(p, `${field}[${i}]`));
}
const smoothstep = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

function sampledPoints(rows) {
  const last = rows.length - 1;
  const tangents = rows.map((row, i) => row.map((p, j) => p.map((value, axis) => {
    if (i === 0) return rows[1][j][axis] - value;
    if (i === last) return value - rows[i - 1][j][axis];
    const before = value - rows[i - 1][j][axis];
    const after = rows[i + 1][j][axis] - value;
    return before * after <= 0 ? 0 : 2 * before * after / (before + after);
  })));
  return depth => {
    if (depth >= last) return rows[last].map((p, j) => p.map((v, a) => v + (depth - last) * tangents[last][j][a]));
    const i = Math.floor(depth), t = depth - i, t2 = t * t, t3 = t2 * t;
    return rows[i].map((p, j) => p.map((value, axis) =>
      (2 * t3 - 3 * t2 + 1) * value + (t3 - 2 * t2 + t) * tangents[i][j][axis]
      + (-2 * t3 + 3 * t2) * rows[i + 1][j][axis] + (t3 - t2) * tangents[i + 1][j][axis]));
  };
}

function geometryFor(composition) {
  if (composition.motion.mode === 'sampled-rows') return sampledPoints(composition.rows);
  const arrows = new Map(composition.arrows.map(arrow => [arrow.vertex, arrow]));
  return depth => {
    const p = depth / composition.lineCount;
    const q = p / (composition.perspective - (composition.perspective - 1) * p);
    return composition.basePath.map((from, vertex) => from.map((coordinate, axis) => coordinate + (arrows.get(vertex).to[axis] - coordinate) * q));
  };
}

// A common separating half-plane ensures even segments between outside points
// cannot cross the viewport. Include the largest supported stroke's miter reach.
function outside(points, width, height) {
  const margin = LIMITS.maxStroke * 2;
  return points.every(p => p[0] < -margin) || points.every(p => p[0] > width + margin)
    || points.every(p => p[1] < -margin) || points.every(p => p[1] > height + margin);
}

function arrowDirection(composition) {
  if (composition.motion.mode === 'arrow-field') return 1;
  const first = composition.rows[0], last = composition.rows.at(-1);
  const directions = composition.arrows.map((arrow, i) => {
    const trajectory = last[arrow.vertex].map((value, axis) => value - first[arrow.vertex][axis]);
    const vector = arrow.to.map((value, axis) => value - arrow.from[axis]);
    const cosine = (trajectory[0] * vector[0] + trajectory[1] * vector[1]) / (Math.hypot(...trajectory) * Math.hypot(...vector));
    if (!Number.isFinite(cosine) || Math.abs(cosine) < .35) fail(`arrows[${i}]`, 'направление не согласуется с траекторией этой вершины');
    return Math.sign(cosine);
  });
  if (!directions.every(direction => direction === directions[0])) fail('arrows', 'стрелки задают противоположные направления движения');
  return directions[0];
}

/** Validates, does not mutate. Returns the same input for convenient pipelines. */
export function validateComposition(composition) {
  object(composition, 'root');
  keys(composition, ['version', 'id', 'title', 'source', 'viewBox', 'style', 'motion', 'rows', 'basePath', 'lineCount', 'perspective', 'arrows'], 'root');
  if (composition.version !== 1) fail('version', 'поддерживается версия 1');
  text(composition.id, 'id', 64);
  if (!/^[a-z][a-z0-9-]*$/.test(composition.id)) fail('id', 'используйте латиницу, цифры и дефис; первый символ — буква');
  text(composition.title, 'title', 120);
  if (own(composition, 'source')) text(composition.source, 'source', 1000);
  if (!Array.isArray(composition.viewBox) || composition.viewBox.length !== 2) fail('viewBox', 'ожидается [width, height]');
  composition.viewBox.forEach((value, i) => number(value, `viewBox[${i}]`, 1, 16384));
  object(composition.style, 'style');
  keys(composition.style, ['stroke', 'background', 'strokeWidth', 'opacity'], 'style');
  for (const name of ['stroke', 'background']) if (!COLOR.test(composition.style[name])) fail(`style.${name}`, 'ожидается цвет #RRGGBB');
  number(composition.style.strokeWidth, 'style.strokeWidth', .25, LIMITS.maxStroke);
  number(composition.style.opacity, 'style.opacity', 0, 1);
  object(composition.motion, 'motion');
  keys(composition.motion, ['mode', 'secondsPerStep', 'fadeIn', 'fadeOut'], 'motion');
  if (!MODES.includes(composition.motion.mode)) fail('motion.mode', 'ожидается sampled-rows или arrow-field');
  number(composition.motion.secondsPerStep, 'motion.secondsPerStep', .1, 60);
  number(composition.motion.fadeIn, 'motion.fadeIn', .05, 4);
  if (own(composition.motion, 'fadeOut')) number(composition.motion.fadeOut, 'motion.fadeOut', 0, 4);
  let pointCount, lineCount;
  if (composition.motion.mode === 'sampled-rows') {
    if (own(composition, 'basePath') || own(composition, 'lineCount') || own(composition, 'perspective')) fail('rows', 'sampled-rows использует только rows; удалите basePath, lineCount и perspective');
    if (!Array.isArray(composition.rows) || composition.rows.length < 2 || composition.rows.length > LIMITS.maxLines) fail('rows', `нужно 2–${LIMITS.maxLines} рядов`);
    composition.rows.forEach((row, i) => path(row, `rows[${i}]`));
    pointCount = composition.rows[0].length;
    lineCount = composition.rows.length;
    if (!composition.rows.every(row => row.length === pointCount)) fail('rows', 'все ряды должны иметь одинаковое число и порядок вершин');
  } else {
    if (own(composition, 'rows')) fail('rows', 'arrow-field использует basePath, а не rows');
    path(composition.basePath, 'basePath');
    integer(composition.lineCount, 'lineCount', 2, LIMITS.maxLines);
    number(composition.perspective, 'perspective', 1, 12);
    pointCount = composition.basePath.length;
    lineCount = composition.lineCount;
  }
  if (pointCount * lineCount > LIMITS.maxTotalPoints) fail('rows', `не более ${LIMITS.maxTotalPoints} точек во всех рядах`);
  if (composition.motion.fadeIn + (composition.motion.fadeOut ?? (composition.motion.mode === 'arrow-field' ? 1 : 0)) > lineCount) fail('motion', 'зоны появления и исчезновения не должны перекрывать весь путь');
  if (!Array.isArray(composition.arrows) || composition.arrows.length < 1 || composition.arrows.length > pointCount) fail('arrows', 'нужна хотя бы одна стрелка, не более одной на вершину');
  const ids = new Set(), vertices = new Set();
  composition.arrows.forEach((arrow, i) => {
    const field = `arrows[${i}]`;
    object(arrow, field);
    keys(arrow, ['id', 'vertex', 'from', 'to'], field);
    text(arrow.id, `${field}.id`, 64);
    integer(arrow.vertex, `${field}.vertex`, 0, pointCount - 1);
    point(arrow.from, `${field}.from`);
    point(arrow.to, `${field}.to`);
    if (Math.hypot(arrow.to[0] - arrow.from[0], arrow.to[1] - arrow.from[1]) < 1) fail(field, 'длина стрелки должна быть не меньше 1');
    if (ids.has(arrow.id) || vertices.has(arrow.vertex)) fail(field, 'id и vertex должны быть уникальны');
    ids.add(arrow.id); vertices.add(arrow.vertex);
    if (composition.motion.mode === 'arrow-field' && arrow.from.some((v, axis) => Math.abs(v - composition.basePath[arrow.vertex][axis]) > 1e-6)) fail(`${field}.from`, 'начало стрелки должно совпадать с basePath[vertex]');
  });
  if (composition.motion.mode === 'arrow-field' && vertices.size !== pointCount) fail('arrows', 'для arrow-field нужна стрелка для каждой вершины basePath');
  arrowDirection(composition);
  const fadeOut = composition.motion.fadeOut ?? (composition.motion.mode === 'arrow-field' ? 1 : 0);
  if (fadeOut === 0) {
    const pointsAt = geometryFor(composition);
    if (!outside(pointsAt(lineCount), ...composition.viewBox)) fail('motion.fadeOut', 'последняя линия ещё видна; задайте fadeOut > 0 или продолжите траекторию за границу кадра');
    if (composition.motion.mode === 'sampled-rows' && !outside(pointsAt(lineCount - 1), ...composition.viewBox)) fail('rows', 'последний исходный ряд должен полностью выйти за кадр, либо задайте fadeOut > 0');
  }
  return composition;
}

export function createMotionModel(input) {
  validateComposition(input);
  // Snapshot external JSON: editing an input object cannot change a running model.
  const composition = structuredClone(input);
  const [width, height] = composition.viewBox;
  const lineCount = composition.motion.mode === 'sampled-rows' ? composition.rows.length : composition.lineCount;
  const color = composition.style.stroke;
  const background = composition.style.background;
  const strokeWidth = composition.style.strokeWidth;
  const seconds = composition.motion.secondsPerStep;
  const direction = arrowDirection(composition);
  const fadeOut = composition.motion.fadeOut ?? (composition.motion.mode === 'arrow-field' ? 1 : 0);
  const evaluate = geometryFor(composition);
  function pointsAt(depth) {
    number(depth, 'depth', 0, lineCount);
    return evaluate(depth);
  }
  const pathAt = depth => pointsAt(depth).map((p, i) => `${i ? 'L' : 'M'}${p.map(value => value.toFixed(3)).join(' ')}`).join('');
  const opacityAt = depth => {
    number(depth, 'depth', 0, lineCount);
    return composition.style.opacity * smoothstep(depth / composition.motion.fadeIn)
      * (fadeOut ? smoothstep((lineCount - depth) / fadeOut) : 1);
  };
  const svgStart = (title, showBackground) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><title>${escapeXml(title)}</title>${showBackground ? `<path fill="${background}" d="M0 0H${width}V${height}H0Z"/>` : ''}`;
  function staticSvg({ width: weight = strokeWidth, phase = 0, background: showBackground = false, original = false } = {}) {
    number(weight, 'strokeWidth', .25, LIMITS.maxStroke); number(phase, 'phase', 0, 1);
    return svgStart(`${composition.title} — stroke`, showBackground)
      + `<g fill="none" stroke="${color}" stroke-width="${weight}" stroke-linejoin="miter" stroke-linecap="butt">`
      + Array.from({ length: lineCount }, (_, i) => `<path d="${pathAt(i + phase)}" stroke-opacity="${original ? composition.style.opacity : opacityAt(i + phase).toFixed(5)}"/>`).join('') + '</g></svg>';
  }
  function animatedSvg({ width: weight = strokeWidth, seconds: duration = seconds, background: showBackground = true, inverted = false } = {}) {
    number(weight, 'strokeWidth', .25, LIMITS.maxStroke); number(duration, 'seconds', .05, 240);
    if (typeof inverted !== 'boolean') fail('inverted', 'ожидается true или false');
    const times = Array.from({ length: 41 }, (_, i) => i / 40);
    const reverse = direction * (inverted ? -1 : 1) < 0;
    const phases = times.map(t => reverse ? 1 - t : t);
    const keyTimes = times.join(';');
    const paths = Array.from({ length: lineCount }, (_, i) => `<path d="${pathAt(i + phases[0])}" stroke-opacity="${opacityAt(i + phases[0])}"><animate attributeName="d" dur="${duration}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${phases.map(t => pathAt(i + t)).join(';')}"/><animate attributeName="stroke-opacity" dur="${duration}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${phases.map(t => opacityAt(i + t).toFixed(5)).join(';')}"/></path>`).join('');
    const still = Array.from({ length: lineCount }, (_, i) => `<path d="${pathAt(i)}" stroke-opacity="${opacityAt(i)}"/>`).join('');
    return svgStart(`${composition.title} — ${reverse ? 'обратное движение' : 'движение по стрелкам'}`, showBackground)
      + '<style>.still{display:none}@media(prefers-reduced-motion:reduce){.motion{display:none}.still{display:inline}}</style>'
      + `<g class="motion" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linejoin="miter">${paths}</g>`
      + `<g class="still" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linejoin="miter">${still}</g></svg>`;
  }
  return { composition, width, height, lineCount, color, background, strokeWidth, seconds, direction, pointsAt, pathAt, opacityAt, staticSvg, animatedSvg };
}
