import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Resvg } from '@resvg/resvg-js';
import ffmpegPath from 'ffmpeg-static';
import { createMotionModel } from '../src/motion/model.js';

export const VIDEO_LIMITS = Object.freeze({ maxWidth: 1920, maxHeight: 1080, maxDuration: 30, maxFrames: 1800, timeoutMs: 300_000 });
const numeric = (value, name, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: ожидается число от ${min} до ${max}`);
  return value;
};

/** Deterministic frame plan. The last frame precedes the seam, never duplicates it. */
export function planVideo(model, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('options: ожидается объект');
  const allowed = ['width', 'seconds', 'inverted', 'fps', 'duration'];
  for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error(`options.${key}: неизвестная настройка`);
  const fps = numeric(options.fps ?? 30, 'fps', 12, 60);
  if (!Number.isInteger(fps)) throw new Error('fps: ожидается целое число');
  const requestedCycle = numeric(options.seconds ?? model.seconds, 'seconds', .05, VIDEO_LIMITS.maxDuration);
  const requestedDuration = numeric(options.duration ?? 6, 'duration', .05, VIDEO_LIMITS.maxDuration);
  const strokeWidth = numeric(options.width ?? model.strokeWidth, 'width', .25, 24);
  const inverted = options.inverted ?? false;
  if (typeof inverted !== 'boolean') throw new Error('inverted: ожидается true или false');
  const cycleFrames = Math.round(requestedCycle * fps);
  if (cycleFrames < 2) throw new Error('На один цикл приходится меньше двух кадров. Увеличьте FPS или уменьшите скорость движения.');
  const cycleSeconds = cycleFrames / fps;
  const cycles = Math.max(1, Math.ceil((requestedDuration - 1e-8) / cycleSeconds));
  const frameCount = cycleFrames * cycles;
  if (frameCount > VIDEO_LIMITS.maxFrames || frameCount / fps > VIDEO_LIMITS.maxDuration + 1e-8) {
    throw new Error('Для целого числа циклов требуется больше 30 секунд. Уменьшите длительность или время одного шага.');
  }
  const scale = Math.min(1, VIDEO_LIMITS.maxWidth / model.width, VIDEO_LIMITS.maxHeight / model.height);
  const rasterWidth = Math.max(2, Math.floor(model.width * scale));
  const rasterHeight = Math.max(2, Math.floor(model.height * scale));
  return Object.freeze({ fps, requestedCycle, cycleFrames, cycleSeconds, cycles, frameCount,
    duration: frameCount / fps, rasterWidth, rasterHeight,
    videoWidth: rasterWidth + rasterWidth % 2, videoHeight: rasterHeight + rasterHeight % 2,
    strokeWidth, inverted, direction: model.direction * (inverted ? -1 : 1) });
}

export function phaseForFrame(frame, plan) {
  const phase = ((frame % plan.cycleFrames) + plan.cycleFrames) % plan.cycleFrames / plan.cycleFrames;
  return plan.direction < 0 ? 1 - phase : phase;
}

export function svgForFrame(model, frame, plan) {
  return model.staticSvg({ phase: phaseForFrame(frame, plan), width: plan.strokeWidth, background: true })
    .replace(`width="${model.width}" height="${model.height}"`, `width="${plan.rasterWidth}" height="${plan.rasterHeight}"`);
}

export function pngForFrame(model, frame, plan) {
  const renderer = new Resvg(svgForFrame(model, frame, plan), { font: { loadSystemFonts: false } });
  try { return renderer.render().asPng(); } finally { renderer.free?.(); }
}

/** Render to a unique temporary file and move it into place only on success. */
export async function renderMp4({ composition, output, options = {}, overwrite = false, onProgress = () => {}, signal } = {}) {
  if (typeof output !== 'string' || !output.toLowerCase().endsWith('.mp4')) throw new Error('output: укажите путь к файлу .mp4');
  const model = createMotionModel(composition);
  const plan = planVideo(model, options);
  if (!ffmpegPath) throw new Error('Для этой платформы нет готового ffmpeg-static. См. docs/MP4.md.');
  await fs.access(ffmpegPath);
  const destination = path.resolve(output);
  try {
    const existing = await fs.stat(destination);
    if (!overwrite || !existing.isFile()) throw new Error(`Файл уже существует: ${destination}. Для замены используйте --overwrite.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.part.mp4`;
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-vcodec', 'png', '-i', 'pipe:0',
    '-an', '-frames:v', String(plan.frameCount), '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=${model.background}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', '-f', 'mp4', temporary];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', processError;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
  child.stdin.on('error', error => { processError = error; });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg завершился с кодом ${code}`)));
  });
  completion.catch(() => {}); // Awaited below; keep early spawn failures handled.
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, VIDEO_LIMITS.timeoutMs);
  timer.unref();
  try {
    for (let frame = 0; frame < plan.frameCount; frame++) {
      if (signal?.aborted) throw new Error('Экспорт отменён.');
      if (processError || child.exitCode !== null || child.killed) throw processError ?? new Error(stderr || 'FFmpeg остановлен.');
      const png = pngForFrame(model, frame, plan);
      await new Promise((resolve, reject) => child.stdin.write(png, error => error ? reject(error) : resolve()));
      onProgress((frame + 1) / plan.frameCount * .95);
      await nextTurn(); // Keep local HTTP status requests responsive during rasterization.
    }
    child.stdin.end();
    await completion;
    if (signal?.aborted) throw new Error('Экспорт отменён.');
    if (overwrite) await fs.rm(destination, { force: true });
    await fs.rename(temporary, destination);
    const { size } = await fs.stat(destination);
    onProgress(1);
    return { path: destination, bytes: size, compositionId: composition.id, codec: 'h264', pixelFormat: 'yuv420p', container: 'mp4', ...plan };
  } catch (error) {
    abort();
    await completion.catch(() => {});
    await fs.rm(temporary, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function cli() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node scripts/render-mp4.mjs --composition rost-fold [--output artifacts/rost-fold.mp4] [--duration 6] [--fps 30] [--seconds 1.5] [--width 3] [--inverted] [--overwrite]\n--composition принимает ID из реестра или путь к JSON.');
    return;
  }
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--inverted' || key === '--overwrite') { args[key.slice(2)] = true; continue; }
    if (!['--composition', '--output', '--duration', '--fps', '--seconds', '--width'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Неизвестный или неполный аргумент: ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  let composition;
  const name = args.composition ?? 'rost-fold';
  if (name.endsWith('.json')) {
    const info = await fs.stat(name);
    if (info.size > 1_048_576) throw new Error('JSON превышает 1 MiB.');
    composition = JSON.parse(await fs.readFile(name, 'utf8'));
  } else {
    const { getComposition } = await import('../src/compositions/registry.js');
    composition = getComposition(name);
    if (!composition) throw new Error(`Не найдена композиция ${name}`);
  }
  const options = { inverted: !!args.inverted };
  for (const name of ['duration', 'fps', 'seconds', 'width']) if (args[name] !== undefined) options[name] = Number(args[name]);
  let reported = -1;
  const result = await renderMp4({ composition, options, output: args.output ?? `artifacts/${composition.id}.mp4`, overwrite: !!args.overwrite,
    onProgress(value) { const percent = Math.floor(value * 10) * 10; if (percent !== reported) { reported = percent; console.log(`MP4: ${percent}%`); } } });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
