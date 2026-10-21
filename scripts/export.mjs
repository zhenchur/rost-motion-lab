import fs from 'node:fs';
import { createMotionModel } from '../src/motion/model.js';
import { compositions } from '../src/compositions/registry.js';
fs.mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
fs.mkdirSync(new URL('../public/compositions/', import.meta.url), { recursive: true });
for (const composition of compositions) {
  const model = createMotionModel(composition);
  fs.writeFileSync(new URL(`../public/compositions/${composition.id}-strokes.svg`, import.meta.url), model.staticSvg({ original: true }));
  fs.writeFileSync(new URL(`../public/compositions/${composition.id}-motion.svg`, import.meta.url), model.animatedSvg());
  if (composition.id === 'rost-fold') {
    fs.writeFileSync(new URL('../public/rost-strokes.svg', import.meta.url), model.staticSvg({ original: true }));
    fs.writeFileSync(new URL('../public/rost-motion.svg', import.meta.url), model.animatedSvg());
  }
}
console.log(`Exported strokes and animated SVG for ${compositions.length} compositions.`);
