import rostFold from './rost-fold.json' with { type: 'json' };
import corridor from './corridor.json' with { type: 'json' };
import chevron from './chevron.json' with { type: 'json' };

export const compositions = [rostFold, corridor, chevron];

export function getComposition(id) {
  const composition = compositions.find(item => item.id === id);
  if (!composition) throw new Error(`Неизвестная композиция: ${id}`);
  return structuredClone(composition);
}
