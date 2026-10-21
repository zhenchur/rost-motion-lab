import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMotionModel } from '../src/motion/model.js';
import { planVideo, renderMp4 } from './render-mp4.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const API = '/api/exports/mp4';
const BODY_LIMIT = 1_048_576;
const TTL = 30 * 60_000;
const localhost = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

function localRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  let host;
  try { host = new URL(`http://${req.headers.host}`); } catch { return false; }
  if (!localhost(host.hostname)) return false;
  if (req.headers.origin) {
    try { const origin = new URL(req.headers.origin); if (origin.host !== host.host || origin.protocol !== 'http:') return false; } catch { return false; }
  }
  return true;
}

async function body(req) {
  if (String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !== 'application/json') throw Object.assign(new Error('Ожидается application/json.'), { status: 415 });
  if (Number(req.headers['content-length']) > BODY_LIMIT) throw Object.assign(new Error('JSON превышает 1 MiB.'), { status: 413 });
  const chunks = []; let size = 0;
  const timer = setTimeout(() => req.destroy(new Error('Превышено время получения JSON.')), 15_000);
  timer.unref();
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > BODY_LIMIT) throw Object.assign(new Error('JSON превышает 1 MiB.'), { status: 413 });
      chunks.push(chunk);
    }
  } finally { clearTimeout(timer); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createMp4Api() {
  const jobs = new Map();
  const controllers = new Set();
  const directory = path.join(ROOT, '.exports', `session-${randomUUID()}`);
  let active = false;
  const clean = async () => {
    for (const [id, job] of jobs) if (job.finishedAt && Date.now() - job.finishedAt > TTL) {
      await fs.rm(job.output, { force: true }); jobs.delete(id);
    }
  };
  const interval = setInterval(() => { clean().catch(() => {}); }, 60_000);
  interval.unref();
  const publicJob = job => ({ jobId: job.id, status: job.status, progress: job.progress,
    statusUrl: `${API}/${job.id}`, downloadUrl: `${API}/${job.id}/download`,
    ...(job.metadata ? { metadata: job.metadata } : {}), ...(job.error ? { error: job.error } : {}) });
  async function handler(req, res, next) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!(pathname === API || pathname.startsWith(`${API}/`))) return next();
    if (!localRequest(req)) return json(res, 403, { error: 'Экспорт доступен только из локального предпросмотра.' });
    try {
      if (pathname === API && req.method === 'POST') {
        if (active) return json(res, 409, { error: 'Один экспорт уже выполняется. Дождитесь его завершения.' });
        active = true; // Reserve before awaiting the body, so parallel requests cannot bypass the limit.
        let payload, job;
        try {
          payload = await body(req);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !['composition', 'options'].includes(key))) throw new Error('Ожидаются composition и options.');
          const model = createMotionModel(payload.composition);
          planVideo(model, payload.options);
          const id = randomUUID();
          job = { id, status: 'queued', progress: 0, output: path.join(directory, `${id}.mp4`) };
          jobs.set(id, job);
        } catch (error) { active = false; throw error; }
        json(res, 202, publicJob(job));
        const controller = new AbortController(); controllers.add(controller);
        job.status = 'rendering';
        renderMp4({ composition: payload.composition, options: payload.options, output: job.output, signal: controller.signal,
          onProgress(progress) { job.progress = progress; },
        }).then(result => {
          const { path: _path, ...metadata } = result;
          job.status = 'complete'; job.metadata = metadata; job.progress = 1;
        }).catch(error => { job.status = 'failed'; job.error = error.message; })
          .finally(() => { job.finishedAt = Date.now(); active = false; controllers.delete(controller); });
        return;
      }
      const match = pathname.match(/^\/api\/exports\/mp4\/([0-9a-f-]{36})(\/download)?$/);
      if (!match || req.method !== 'GET') return json(res, 404, { error: 'Маршрут экспорта не найден.' });
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { error: 'Экспорт не найден или срок хранения истёк.' });
      if (!match[2]) return json(res, 200, publicJob(job));
      if (job.status !== 'complete') return json(res, 409, { error: 'Файл ещё не готов.' });
      const stat = await fs.stat(job.output);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${job.metadata.compositionId}.mp4"`, 'Cache-Control': 'no-store' });
      const stream = createReadStream(job.output);
      stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 400, { error: error instanceof SyntaxError ? 'Не удалось прочитать JSON.' : error.message });
      else res.destroy();
    }
  }
  const close = () => {
    clearInterval(interval);
    for (const controller of controllers) controller.abort();
    // Remove only this API instance's UUID-named directory, never a user-provided path.
    const cleanup = () => {
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(ROOT, '.exports') || !/^session-[0-9a-f-]{36}$/.test(path.basename(resolved))) throw new Error('Unexpected export cleanup path');
      return fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
    };
    if (!controllers.size) void cleanup();
    else { const timer = setTimeout(cleanup, 1500); timer.unref(); }
  };
  return { handler, close };
}

export function mp4ExportPlugin() {
  const install = server => {
    const api = createMp4Api();
    server.middlewares.use(api.handler);
    server.httpServer?.once('close', api.close);
  };
  return { name: 'rost-local-mp4-export', configureServer: install, configurePreviewServer: install };
}
