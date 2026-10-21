import fs from 'node:fs';

// Figma 2170:669, relative to 2170:664. Source SVG retains outlined ribbons.
const transform = [[-.7385364174842834, .6742136478424072, 1312.4140625], [.6742136478424072, .7385364174842834, -1234.6591796875]];
const svg = fs.readFileSync(new URL('../assets/figma-pattern.svg', import.meta.url), 'utf8');
const rows = [...svg.matchAll(/<path[^>]*d="([^"]+)"/g)].map((match) => {
  const numbers = match[1].match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
  const points = [];
  for (let i = 0; i < numbers.length; i += 2) points.push(numbers.slice(i, i + 2));
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < .01) points.pop();
  if (points.length !== 72) throw new Error('Unexpected outline topology');
  return points.slice(0, 36).map((point, i) => {
    const opposite = points[71 - i];
    const x = (point[0] + opposite[0]) / 2;
    const y = (point[1] + opposite[1]) / 2;
    return transform.map(([a, b, c]) => +(a * x + b * y + c).toFixed(5));
  });
});
fs.writeFileSync(new URL('../src/source-lines.json', import.meta.url), JSON.stringify(rows));
console.log(`Extracted ${rows.length} open centerlines, 36 points each.`);
