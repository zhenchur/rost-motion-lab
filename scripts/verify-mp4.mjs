import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { createMotionModel } from '../src/motion/model.js';
import { getComposition } from '../src/compositions/registry.js';
import { planVideo, phaseForFrame, svgForFrame, pngForFrame, renderMp4 } from './render-mp4.mjs';

const composition = getComposition('rost-fold');
const model = createMotionModel(composition);
const options = { fps: 12, duration: 3, density: 1.5, inverted: true };
const plan = planVideo(model, options);
assert.equal(plan.density, 1.5);
assert.equal(plan.requestedCycle, composition.motion.secondsPerStep / options.density);
assert.equal(plan.videoWidth % 2, 0);
assert.equal(plan.videoHeight % 2, 0);
assert.equal(plan.frameCount % plan.cycleFrames, 0);
assert.equal(plan.direction, -model.direction);
assert.ok(phaseForFrame(1, plan) < phaseForFrame(0, plan), 'Inversion reverses frame phase');
const hash = png => createHash('sha256').update(png).digest('hex');
assert.equal(hash(pngForFrame(model, 0, plan)), hash(pngForFrame(model, plan.frameCount, plan)), 'Source raster repeats exactly after the planned duration');
assert.notEqual(hash(pngForFrame(model, 0, plan)), hash(pngForFrame(model, plan.frameCount - 1, plan)), 'Last frame does not duplicate the first');
assert.throws(() => planVideo(model, { fps: 1000 }));
assert.throws(() => planVideo(model, { seconds: 20, duration: 30 }));
assert.throws(() => planVideo(model, { inventedOption: true }));
for (const density of [.49, 2.01, -1, NaN, Infinity, '1', null]) {
  assert.throws(() => planVideo(model, { density }), /density/, `Invalid density ${density}`);
}

const linePaths = svg => [...svg.matchAll(/<path d="([^"]+)" stroke-opacity=/g)].map(([, d]) => d);
let densityFrames = 0;
for (const density of [.5, .75, 1, 1.25, 4 / 3, 2]) {
  const denseModel = createMotionModel(composition, { density });
  const inherited = planVideo(denseModel);
  assert.equal(inherited.density, density, 'An existing model supplies the default density');
  assert.equal(inherited.requestedCycle, composition.motion.secondsPerStep / density, 'Default cadence preserves travel speed at every density');
  assert.equal(planVideo(denseModel, { density: 1 }).requestedCycle, composition.motion.secondsPerStep, 'Overriding density recalculates cadence from the original composition');
  for (const inverted of [false, true]) {
    const framePlan = planVideo(model, { density, inverted, seconds: 1, fps: 20 });
    assert.equal(framePlan.requestedCycle, 1, 'Explicit seconds is already the final cycle duration');
    const svgTracks = [...model.animatedSvg({ density, inverted, seconds: 1 }).matchAll(/<animate\b[^>]*attributeName="d"[^>]*values="([^"]+)"/g)]
      .map(([, values]) => values.split(';'));
    assert.equal(svgTracks.length, Math.ceil(model.baseLineCount * density));
    for (const frame of [0, 5, 10]) {
      const phase = phaseForFrame(frame, framePlan);
      const expected = denseModel.staticSvg({ phase, width: framePlan.strokeWidth, background: true });
      const actual = svgForFrame(model, frame, framePlan);
      assert.equal(actual, expected, 'MP4 frames match the SVG from the configured density model');
      const paths = linePaths(actual);
      assert.equal(paths.length, denseModel.lineCount);
      paths.forEach((d, row) => {
        assert.equal(d, denseModel.pathAt(row + phase), 'Frame geometry comes from the density model');
        assert.equal(d, svgTracks[row][frame * 2], 'Animated SVG and MP4 agree at matching times in either direction');
      });
      densityFrames++;
    }
  }
}
assert.notEqual(hash(pngForFrame(model, 0, plan)), hash(pngForFrame(model, 0, planVideo(model, { ...options, density: 1 }))),
  'Density changes the rendered pixels, not only export metadata');

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rost-mp4-test-'));
const output = path.join(directory, 'test.mp4');
try {
  const metadata = await renderMp4({ composition, output, options });
  assert.ok(metadata.bytes > 1000);
  assert.equal(metadata.frameCount, plan.frameCount);
  assert.equal(metadata.density, options.density);
  const buffer = await fs.readFile(output);
  assert.equal(buffer.subarray(4, 8).toString(), 'ftyp', 'Real ISO-BMFF/MP4 file');
  assert.ok(buffer.indexOf(Buffer.from('avc1')) > 0, 'AVC/H.264 sample entry');
  const moov = buffer.indexOf(Buffer.from('moov'));
  const mdat = buffer.indexOf(Buffer.from('mdat'));
  assert.ok(moov > 0 && moov < mdat, 'faststart places metadata ahead of media');
  let diagnostics = '', progress = '';
  const child = spawn(ffmpegPath, ['-hide_banner', '-i', output, '-map', '0:v:0', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { progress += chunk; });
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(diagnostics))); });
  assert.match(diagnostics, /Video: h264/);
  assert.match(diagnostics, /yuv420p/);
  assert.ok(diagnostics.includes(`${plan.videoWidth}x${plan.videoHeight}`));
  const frames = [...progress.matchAll(/^frame=(\d+)$/gm)].map(match => Number(match[1]));
  assert.equal(frames.at(-1), plan.frameCount, 'Every planned frame decodes successfully');
  assert.match(progress, /progress=end/);
  const duration = diagnostics.match(/Duration: (\d+):(\d+):([\d.]+)/);
  assert.ok(duration);
  assert.ok(Math.abs(Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) - plan.duration) < .02);
  await assert.rejects(renderMp4({ composition, output, options }), /уже существует/);
  console.log(`MP4 verified: H.264/yuv420p, ${plan.videoWidth}×${plan.videoHeight}, ${plan.fps} FPS, ${plan.frameCount} decoded frames, ${plan.duration}s, density ${plan.density}, ${metadata.bytes} bytes.`);
  console.log(`Loop raster, reverse direction, ${densityFrames} model/SVG/MP4 density frames, limits, existing-file protection, and faststart passed.`);
} finally {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('rost-mp4-test-'));
  await fs.rm(resolved, { recursive: true, force: true });
}
