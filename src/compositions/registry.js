import rostFold from './rost-fold.json' with { type: 'json' };
import rostFan from './rost-fan.json' with { type: 'json' };
import { ROST_STYLE } from '../motion/pattern-profile.js';

export const compositions = [rostFold, rostFan].map(composition => ({ ...composition, style: ROST_STYLE }));

export function getComposition(id) {
  const composition = compositions.find(item => item.id === id);
  if (!composition) throw new Error(`Неизвестная композиция: ${id}`);
  return structuredClone(composition);
}
