import { gsap } from 'gsap';
import { LIMITS } from './motion/model.js';

const ns = 'http://www.w3.org/2000/svg';
export const wrapPhase = value => ((value % 1) + 1) % 1;

/** One isolated player per SVG. Geometry and exports come from the same model. */
export function createMotionPlayer(svg, initialModel, onChange = () => {}) {
  let model = initialModel, phaseOffset = 0, userChosePlayback = false, destroyed = false;
  const clock = { phase: 0 };
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { phase: 0, speed: 1, width: model.strokeWidth, paused: media.matches, inverted: false };
  const group = document.createElementNS(ns, 'g');
  group.classList.add('motion-lines');
  group.setAttribute('fill', 'none'); group.setAttribute('stroke-linejoin', 'miter'); svg.prepend(group);
  let paths = [];
  const direction = () => model.direction * (state.inverted ? -1 : 1);
  const render = () => {
    for (let i = 0; i < paths.length; i++) {
      paths[i].setAttribute('d', model.pathAt(i + state.phase));
      paths[i].setAttribute('stroke-opacity', model.opacityAt(i + state.phase).toFixed(5));
    }
  };
  const mount = () => {
    svg.setAttribute('viewBox', `0 0 ${model.width} ${model.height}`); svg.style.background = model.background;
    group.setAttribute('stroke', model.color); group.setAttribute('stroke-width', state.width); group.replaceChildren();
    paths = Array.from({ length: model.lineCount }, () => { const path = document.createElementNS(ns, 'path'); group.append(path); return path; });
    render();
  };
  mount();
  const tween = gsap.to(clock, {
    phase: 1, duration: model.seconds, ease: 'none', repeat: -1,
    onUpdate() { state.phase = wrapPhase(phaseOffset + direction() * clock.phase); render(); },
  });
  const changed = () => onChange({ ...state }, model);
  const syncPlayback = () => { tween.paused(state.paused || document.hidden); changed(); };
  const handleMotionPreference = () => { if (!userChosePlayback) state.paused = media.matches; syncPlayback(); };
  document.addEventListener('visibilitychange', syncPlayback); media.addEventListener('change', handleMotionPreference); syncPlayback();
  return {
    get state() { return { ...state }; }, get model() { return model; }, get reducedMotion() { return media.matches; },
    setModel(next, { preserve = false } = {}) {
      model = next;
      if (!preserve) { state.phase = 0; state.inverted = false; }
      const clockPhase = clock.phase;
      tween.pause().duration(model.seconds).totalTime(clockPhase * model.seconds, true);
      phaseOffset = state.phase - direction() * clockPhase; mount(); syncPlayback();
    },
    setPaused(paused) { userChosePlayback = true; state.paused = Boolean(paused); syncPlayback(); },
    setInverted(inverted) { state.inverted = Boolean(inverted); phaseOffset = state.phase - direction() * clock.phase; changed(); },
    setSpeed(speed) {
      if (!Number.isFinite(speed) || speed < .25 || speed > 2) throw new Error('Скорость должна быть от 0,25 до 2.');
      state.speed = speed; tween.timeScale(speed); changed();
    },
    setWidth(width) {
      if (!Number.isFinite(width) || width < .25 || width > LIMITS.maxStroke) throw new Error(`Толщина должна быть от 0,25 до ${LIMITS.maxStroke}.`);
      state.width = width; group.setAttribute('stroke-width', width); changed();
    },
    seek(phase) { if (!Number.isFinite(phase)) throw new Error('Некорректная фаза.'); state.phase = wrapPhase(phase); phaseOffset = state.phase - direction() * clock.phase; render(); },
    destroy() { if (destroyed) return; destroyed = true; tween.kill(); group.remove(); document.removeEventListener('visibilitychange', syncPlayback); media.removeEventListener('change', handleMotionPreference); },
  };
}
