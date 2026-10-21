import reference from '../compositions/rost-fold.json' with { type: 'json' };

// The first approved composition is the source of all visual defaults.
export const ROST_STYLE = Object.freeze({ ...reference.style });
export const ROST_MOTION = Object.freeze({ ...reference.motion });

// Distances between successive rows along the original left fold, in viewBox
// units. Reuse the actual values instead of fitting or scaling a new curve.
const referenceFold = reference.rows.map(row => row[28]);
export const ROST_SPACING = Object.freeze(referenceFold.reduce((distances, point, index) => {
  distances.push(index === 0 ? 0 : distances[index - 1]
    + Math.hypot(point[0] - referenceFold[index - 1][0], point[1] - referenceFold[index - 1][1]));
  return distances;
}, []));

export function nextSpacingGap(index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('Spacing index must be a non-negative integer.');
  const end = Math.min(index + 1, ROST_SPACING.length - 1);
  return ROST_SPACING[end] - ROST_SPACING[end - 1];
}
