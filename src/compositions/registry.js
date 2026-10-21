import rostFold from './rost-fold.json' with { type: 'json' };

export const compositions = [rostFold];

export function getComposition(id) {
  const composition = compositions.find(item => item.id === id);
  if (!composition) throw new Error(`Неизвестная композиция: ${id}`);
  return structuredClone(composition);
}
