// Compatibility API for the original ROST scene; all runtime geometry is shared.
import { createMotionModel } from './motion/model.js';
import { getComposition } from './compositions/registry.js';
const model = createMotionModel(getComposition('rost-fold'));
export const WIDTH=model.width, HEIGHT=model.height, COLOR=model.color, BACKGROUND=model.background;
export const OPACITY=model.composition.style.opacity, LINE_COUNT=model.lineCount;
export const DEFAULTS=Object.freeze({width:model.strokeWidth,seconds:model.seconds});
export const sourceLines=model.composition.rows;
export const {pointsAt,pathAt,opacityAt,staticSvg,animatedSvg}=model;
