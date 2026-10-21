import fs from 'node:fs';
const base = new URL('../dist/', import.meta.url);
let html = fs.readFileSync(new URL('index.html', base), 'utf8');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, path) => `<script type="module">${fs.readFileSync(new URL(path.replace(/^\//, ''), base), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, (_, path) => `<style>${fs.readFileSync(new URL(path.replace(/^\//, ''), base), 'utf8')}</style>`);
fs.writeFileSync(new URL('../rost-preview.html', import.meta.url), html);
console.log('Created offline preview: rost-preview.html');
