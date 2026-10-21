import source from '../../src/source-lines.json' with { type: 'json' };

export const WIDTH = 1920;
export const HEIGHT = 793;
export const COLOR = '#dd192d';
export const BACKGROUND = '#1a1d24';
export const OPACITY = .6;
export const LINE_COUNT = source.length;
export const DEFAULTS = Object.freeze({ width: 3, seconds: 1.5 });
export const sourceLines = source;

// Shape-preserving cubic interpolation through the actual Figma rows.
// The increasing spacing in the source supplies the perspective acceleration.
const tangents = source.map((row, i) => row.map((point, j) => point.map((value, axis) => {
  if (i === 0) return source[1][j][axis] - value;
  if (i === LINE_COUNT - 1) return value - source[i - 1][j][axis];
  const before = value - source[i - 1][j][axis];
  const after = source[i + 1][j][axis] - value;
  return before * after <= 0 ? 0 : 2 * before * after / (before + after);
})));

export function pointsAt(depth) {
  const last = LINE_COUNT - 1;
  if (depth >= last) return source[last].map((p, j) => p.map((v, a) => v + (depth - last) * tangents[last][j][a]));
  const i = Math.max(0, Math.floor(depth));
  const t = Math.max(0, depth - i), t2 = t * t, t3 = t2 * t;
  return source[i].map((p, j) => p.map((v, a) =>
    (2 * t3 - 3 * t2 + 1) * v + (t3 - 2 * t2 + t) * tangents[i][j][a]
    + (-2 * t3 + 3 * t2) * source[i + 1][j][a] + (t3 - t2) * tangents[i + 1][j][a]
  ));
}

export function pathAt(depth) {
  return pointsAt(depth).map((p, i) => `${i ? 'L' : 'M'}${p.map(v => v.toFixed(3)).join(' ')}`).join('');
}

export function opacityAt(depth) {
  const t = Math.max(0, Math.min(1, depth / .65));
  return OPACITY * t * t * (3 - 2 * t);
}

const svgStart = (title, background) => `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none"><title>${title}</title>${background ? `<path fill="${BACKGROUND}" d="M0 0H${WIDTH}V${HEIGHT}H0Z"/>` : ''}`;

export function staticSvg({ width = DEFAULTS.width, phase = 0, background = false, original = false } = {}) {
  return svgStart('Р.О.С.Т. — линии со stroke', background)
    + `<g fill="none" stroke="${COLOR}" stroke-width="${width}" stroke-linejoin="miter" stroke-linecap="butt">`
    + source.map((_, i) => `<path d="${pathAt(i + phase)}" stroke-opacity="${original ? OPACITY : opacityAt(i + phase).toFixed(5)}"/>`).join('')
    + '</g></svg>';
}

// Standalone SMIL SVG: no scripts, runtime dependencies, or external assets.
// At each repeat, the visible path set is exactly the same, with indices shifted.
export function animatedSvg({ width = DEFAULTS.width, seconds = DEFAULTS.seconds, background = true, inverted = false } = {}) {
  const steps = 40;
  const times = Array.from({ length: steps + 1 }, (_, k) => k / steps);
  const keyTimes = times.join(';');
  const phases = times.map(t => inverted ? 1 - t : t);
  return svgStart(`Р.О.С.Т. — бесшовное движение линий ${inverted ? 'от камеры' : 'к камере'}`, background)
    + '<style>.still{display:none}@media(prefers-reduced-motion:reduce){.motion{display:none}.still{display:inline}}</style>'
    + `<g class="motion" fill="none" stroke="${COLOR}" stroke-width="${width}" stroke-linejoin="miter">`
    + source.map((_, i) => `<path d="${pathAt(i + phases[0])}" stroke-opacity="${opacityAt(i + phases[0])}"><animate attributeName="d" dur="${seconds}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${phases.map(t => pathAt(i + t)).join(';')}"/><animate attributeName="stroke-opacity" dur="${seconds}s" repeatCount="indefinite" calcMode="linear" keyTimes="${keyTimes}" values="${phases.map(t => opacityAt(i + t).toFixed(5)).join(';')}"/></path>`).join('')
    + `</g><g class="still" fill="none" stroke="${COLOR}" stroke-width="${width}" stroke-opacity="${OPACITY}">${source.map((_, i) => `<path d="${pathAt(i)}"/>`).join('')}</g></svg>`;
}
