import { createMotionModel } from './motion/model.js';
import { compositions } from './compositions/registry.js';
import { createMotionPlayer } from './player.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const svg = $('#pattern'), selector = $('#composition');
const controller = new AbortController(), eventOptions = { signal: controller.signal };
let exportBusy = false;
selector.replaceChildren(...compositions.map(composition => {
  const option = document.createElement('option');
  option.value = composition.id; option.textContent = composition.title;
  return option;
}));
$('#composition-controls').hidden = compositions.length < 2;
const requestedComposition = new URLSearchParams(location.search).get('composition');
const initialComposition = compositions.find(composition => composition.id === requestedComposition) ?? compositions.at(-1);
selector.value = initialComposition.id;

function sync(state, model) {
  $('#toggle').textContent = state.paused ? 'Воспроизвести' : 'Пауза'; $('#toggle').setAttribute('aria-pressed', String(state.paused));
  $('#invert').textContent = state.inverted ? 'Инверсия: вкл.' : 'Инверсия: выкл.'; $('#invert').setAttribute('aria-pressed', String(state.inverted));
  $('#speed').value = state.speed; $('#width').value = state.width; $('#speed-value').textContent = `${Number(state.speed.toFixed(2))}×`; $('#width-value').textContent = `${state.width} px`;
  const densityPercent = Math.round(state.density * 100);
  $('#density').value = densityPercent; $('#density-value').textContent = `${densityPercent}%`; $('#density').setAttribute('aria-valuetext', `${densityPercent}%`);
  $('.caption').textContent = state.inverted ? 'ОБРАТНОЕ ДВИЖЕНИЕ' : 'ДВИЖЕНИЕ ЛИНИЙ';
  $('.stage').style.aspectRatio = `${model.width} / ${model.height}`; $('.stage').style.background = model.background;
  const direction = state.inverted ? 'Обратное движение.' : 'Исходное направление.';
  svg.setAttribute('aria-label', `${model.composition.title}. ${direction}`);
  $('#direction-note').textContent = `${model.composition.title} · ${direction}`;
  $('#motion-note').textContent = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Уменьшение движения включено в системе.' : '';
}
const player = createMotionPlayer(svg, createMotionModel(initialComposition), sync);
function message(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('error', error); }
$('#toggle').addEventListener('click', () => player.setPaused(!player.state.paused), eventOptions);
$('#invert').addEventListener('click', () => player.setInverted(!player.state.inverted), eventOptions);
$('#speed').addEventListener('input', event => player.setSpeed(Number(event.target.value)), eventOptions);
$('#width').addEventListener('input', event => player.setWidth(Number(event.target.value)), eventOptions);
$('#density').addEventListener('input', event => player.setDensity(Number(event.target.value) / 100), eventOptions);
selector.addEventListener('change', () => {
  player.setModel(createMotionModel(compositions.find(composition => composition.id === selector.value)));
  message('');
}, eventOptions);
function download(content, name, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportOptions() { const state = player.state; return { width: state.width, density: state.density, seconds: player.model.seconds / state.speed, inverted: state.inverted, phase: state.phase }; }
$('#svg-static').addEventListener('click', () => download(player.model.staticSvg(exportOptions()), `${player.model.composition.id}-strokes.svg`), eventOptions);
$('#svg-motion').addEventListener('click', () => download(player.model.animatedSvg(exportOptions()), `${player.model.composition.id}-motion.svg`), eventOptions);
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
