import { createMotionModel } from './motion/model.js';
import { compositions } from './compositions/registry.js';
import { createMotionPlayer } from './player.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const ns = 'http://www.w3.org/2000/svg', svg = $('#pattern'), selector = $('#composition');
const catalog = compositions.map(comp => structuredClone(comp));
let showArrows = false, player, exportBusy = false;
let arrowDrag = null;
const controller = new AbortController(), eventOptions = { signal: controller.signal };
function option(comp) { const node = document.createElement('option'); node.value = comp.id; node.textContent = comp.title; return node; }
selector.replaceChildren(...catalog.map(option));
const overlay = document.createElementNS(ns, 'g'); overlay.classList.add('direction-arrows'); overlay.setAttribute('aria-hidden', 'true'); svg.append(overlay);

function drawArrows(model, inverted) {
  overlay.replaceChildren(); overlay.style.display = showArrows ? '' : 'none';
  const interactive = showArrows && model.composition.motion.mode === 'arrow-field';
  overlay.setAttribute('aria-hidden', String(!interactive)); svg.setAttribute('role', interactive ? 'group' : 'img');
  if (!showArrows) return;
  const defs = document.createElementNS(ns, 'defs'), marker = document.createElementNS(ns, 'marker');
  Object.entries({ id: 'direction-tip', viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }).forEach(([k, v]) => marker.setAttribute(k, v));
  const tip = document.createElementNS(ns, 'path'); tip.setAttribute('d', 'M2 2L10 6L2 10'); tip.setAttribute('fill', 'none'); tip.setAttribute('stroke', '#fff'); tip.setAttribute('stroke-width', '2');
  marker.append(tip); defs.append(marker); overlay.append(defs);
  for (const [index, arrow] of model.composition.arrows.entries()) {
    const dx = arrow.to[0] - arrow.from[0], dy = arrow.to[1] - arrow.from[1], length = Math.hypot(dx, dy);
    // Preview arrows show direction at a readable size; JSON retains the full vectors.
    const editable = model.composition.motion.mode === 'arrow-field';
    const scale = editable ? 1 : Math.min(1, Math.min(model.width, model.height) * .22 / length);
    const from = arrow.from, to = [from[0] + dx * scale, from[1] + dy * scale];
    const line = document.createElementNS(ns, 'path'); line.setAttribute('d', `M${from.join(' ')}L${to.join(' ')}`);
    line.setAttribute('aria-hidden', 'true');
    line.setAttribute('stroke', '#fff'); line.setAttribute('stroke-width', '4'); line.setAttribute('fill', 'none');
    line.setAttribute(inverted ? 'marker-start' : 'marker-end', 'url(#direction-tip)'); overlay.append(line);
    if (editable) {
      const handle = document.createElementNS(ns, 'circle');
      Object.entries({ cx: to[0], cy: to[1], r: 9, fill: '#fff', stroke: model.background, 'stroke-width': 3, tabindex: 0, role: 'button', 'aria-label': `Конец стрелки ${index + 1}. Перетащите или используйте клавиши стрелок.`, 'data-arrow-index': index }).forEach(([k, v]) => handle.setAttribute(k, v));
      handle.classList.add('arrow-handle'); overlay.append(handle);
    }
  }
}
function sync(state, model) {
  $('#toggle').textContent = state.paused ? 'Воспроизвести' : 'Пауза'; $('#toggle').setAttribute('aria-pressed', String(state.paused));
  $('#invert').textContent = state.inverted ? 'Инверсия: вкл.' : 'Инверсия: выкл.'; $('#invert').setAttribute('aria-pressed', String(state.inverted));
  $('#speed').value = state.speed; $('#width').value = state.width; $('#speed-value').textContent = `${Number(state.speed.toFixed(2))}×`; $('#width-value').textContent = `${state.width} px`;
  $('.caption').textContent = state.inverted ? 'ПРОТИВ СТРЕЛОК' : 'ПО СТРЕЛКАМ'; $('.stage').style.aspectRatio = `${model.width} / ${model.height}`; $('.stage').style.background = model.background;
  svg.setAttribute('aria-label', `${model.composition.title}. Движение ${state.inverted ? 'против стрелок' : 'по стрелкам'}.`);
  $('#direction-note').textContent = `${model.composition.title} · ${state.inverted ? 'Движение против стрелок.' : 'Движение по стрелкам.'}${showArrows && model.composition.motion.mode === 'arrow-field' ? ' Перетащите концы стрелок, чтобы изменить траектории.' : ''}`;
  $('#motion-note').textContent = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Уменьшение движения включено в системе.' : '';
  drawArrows(model, state.inverted);
}
player = createMotionPlayer(svg, createMotionModel(catalog[0]), sync);
function message(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
$('#toggle').addEventListener('click', () => player.setPaused(!player.state.paused), eventOptions);
$('#invert').addEventListener('click', () => player.setInverted(!player.state.inverted), eventOptions);
$('#speed').addEventListener('input', e => player.setSpeed(Number(e.target.value)), eventOptions);
$('#width').addEventListener('input', e => player.setWidth(Number(e.target.value)), eventOptions);
$('#arrows').addEventListener('click', () => {
  showArrows = !showArrows; $('#arrows').setAttribute('aria-pressed', String(showArrows)); $('#arrows').textContent = showArrows ? 'Скрыть стрелки' : 'Показать стрелки'; sync(player.state, player.model);
}, eventOptions);
function applyArrowDraft(draft) {
  try {
    const next = createMotionModel(draft);
    player.setModel(next, { preserve: true });
    catalog[catalog.findIndex(comp => comp.id === draft.id)] = draft;
    message('Траектория обновлена. Сохраните композицию, чтобы перенести изменения.');
  } catch (error) { drawArrows(player.model, player.state.inverted); message(error.message, true); }
}
svg.addEventListener('pointerdown', event => {
  const index = event.target.dataset?.arrowIndex;
  if (index === undefined || event.button !== 0) return;
  arrowDrag = { index: Number(index), draft: structuredClone(player.model.composition), pointerId: event.pointerId };
  svg.setPointerCapture(event.pointerId); event.preventDefault();
}, eventOptions);
svg.addEventListener('pointermove', event => {
  if (!arrowDrag || event.pointerId !== arrowDrag.pointerId) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  arrowDrag.draft.arrows[arrowDrag.index].to = [Math.round(point.x), Math.round(point.y)];
  drawArrows({ ...player.model, composition: arrowDrag.draft }, player.state.inverted);
}, eventOptions);
svg.addEventListener('pointerup', event => {
  if (!arrowDrag || event.pointerId !== arrowDrag.pointerId) return;
  const draft = arrowDrag.draft; arrowDrag = null; svg.releasePointerCapture(event.pointerId); applyArrowDraft(draft);
}, eventOptions);
svg.addEventListener('pointercancel', () => { arrowDrag = null; drawArrows(player.model, player.state.inverted); }, eventOptions);
svg.addEventListener('keydown', event => {
  const index = event.target.dataset?.arrowIndex;
  const delta = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
  if (index === undefined || !delta) return;
  event.preventDefault(); const draft = structuredClone(player.model.composition);
  draft.arrows[Number(index)].to = draft.arrows[Number(index)].to.map((value, axis) => value + delta[axis]);
  applyArrowDraft(draft); overlay.querySelector(`[data-arrow-index="${index}"]`)?.focus();
}, eventOptions);
selector.addEventListener('change', () => { player.setModel(createMotionModel(catalog.find(comp => comp.id === selector.value))); message(''); }, eventOptions);
function download(content, name, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportOptions() { const state = player.state; return { width: state.width, seconds: player.model.seconds / state.speed, inverted: state.inverted, phase: state.phase }; }
$('#svg-static').addEventListener('click', () => download(player.model.staticSvg(exportOptions()), `${player.model.composition.id}-strokes.svg`), eventOptions);
$('#svg-motion').addEventListener('click', () => download(player.model.animatedSvg(exportOptions()), `${player.model.composition.id}-motion.svg`), eventOptions);
$('#json-export').addEventListener('click', () => download(JSON.stringify(player.model.composition, null, 2), `${player.model.composition.id}.json`, 'application/json'), eventOptions);
$('#json-import').addEventListener('click', () => $('#composition-file').click(), eventOptions);
$('#composition-file').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('Размер JSON должен быть меньше 1 МБ.');
    const comp = JSON.parse(await file.text()), model = createMotionModel(comp); const index = catalog.findIndex(item => item.id === comp.id);
    if (index >= 0) catalog[index] = comp; else catalog.push(comp);
    selector.replaceChildren(...catalog.map(option)); selector.value = comp.id; player.setModel(model); message(`Композиция «${comp.title}» загружена.`);
  } catch (error) { message(`Не удалось загрузить композицию: ${error.message}`, true); }
  e.target.value = '';
}, eventOptions);
$('#mp4-export').addEventListener('click', async () => {
  if (exportBusy) return;
  if (location.protocol === 'file:') { message('Для MP4 запустите проект командой npm run dev и откройте локальный адрес. SVG можно скачать прямо здесь.', true); return; }
  exportBusy = true; $('#mp4-export').disabled = true; message('Подготовка MP4…');
  try {
    const { phase: _phase, ...videoOptions } = exportOptions();
    const composition = player.model.composition;
    const response = await fetch('/api/exports/mp4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ composition, options: { ...videoOptions, fps: 30, duration: 6 } }), signal: controller.signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Экспорт MP4 доступен при запуске npm run dev или npm run preview.');
    const job = await response.json(); if (!response.ok) throw new Error(job.error || 'Не удалось начать экспорт.');
    for (;;) {
      const result = await fetch(job.statusUrl, { signal: controller.signal }), status = await result.json();
      if (!result.ok || status.status === 'failed') throw new Error(status.error || 'Ошибка экспорта MP4.');
      if (status.status === 'complete') {
        const a = document.createElement('a'); a.href = status.downloadUrl || job.downloadUrl; a.download = `${composition.id}.mp4`; a.click(); message('MP4 готов. Скачивание началось.'); break;
      }
      message(`Экспорт MP4${Number.isFinite(status.progress) ? ` · ${Math.round(status.progress * 100)}%` : '…'}`);
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  } catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
  finally { exportBusy = false; $('#mp4-export').disabled = false; }
}, eventOptions);
const setClean = clean => { document.body.classList.toggle('clean', clean); $('#exit-clean').hidden = !clean; };
$('#clean').addEventListener('click', () => setClean(true), eventOptions); $('#exit-clean').addEventListener('click', () => setClean(false), eventOptions);
document.addEventListener('keydown', event => { if (event.key === 'Escape') setClean(false); }, eventOptions);
window.rostPattern = player;
if (import.meta.hot) import.meta.hot.dispose(() => { controller.abort(); player.destroy(); });
