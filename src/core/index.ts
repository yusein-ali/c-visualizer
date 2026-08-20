/**
 * PLIVET's core: running a C program and describing what it is doing, with no
 * DOM, no React and no renderer anywhere in it.
 *
 * Nothing under this directory may import from `src/components/` or `src/ui/`.
 * That is the whole point of it: the interpreter side moves into a Worker in
 * Phase 6 and the layout survives the canvas being rewritten in Phase 8, and
 * neither move can drag the interface along with it.
 */
export { server, Server, Request, Response } from './server';
export type { CONTROL_EVENT, DEBUG_STATE, RUN_EVENT } from './server';
export { extractModel } from './extractModel';
export { layout, connectionColor } from './layout';
export type {
  ArrowGeometry,
  CellGeometry,
  Geometry,
  Point,
  StackGeometry,
} from './layout';
export { FoldState } from './foldState';
export { HISTORY_LIMIT, StepHistory } from './history';
export {
  CELL_FONT_SIZE,
  CELL_HEIGHT,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
  isWithinFold,
} from './model';
export type {
  CellKind,
  CellModel,
  CodeRangeModel,
  PointerModel,
  StackModel,
  StepModel,
} from './model';
