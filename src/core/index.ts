/**
 * PLIVET's core: running a C program and describing what it is doing, with no
 * DOM, no React and no renderer anywhere in it.
 *
 * Nothing under this directory may import from `src/app/` or `src/ui/`.
 * That is the whole point of it: the interpreter side moves into a Worker in
 * Phase 6 and the layout survives the canvas being rewritten in Phase 8, and
 * neither move can drag the interface along with it.
 */
export { InterpreterClient } from './client';
export { Server } from './server';
export type { Request, Response } from './server';
export type {
  CONTROL_EVENT,
  DEBUG_STATE,
  RUN_EVENT,
  SyntaxErrorModel,
} from './server';
export { extractModel } from './extractModel';
export { extractVariables, formatAddress, narrowToType } from './variables';
export { layout, connectionColor } from './layout';
export {
  MEMORY_CAPTION_HEIGHT,
  MEMORY_COLUMN_HEADER_HEIGHT,
  MEMORY_ENTRY_HEIGHT,
  MEMORY_FOLD_WIDTH,
  MEMORY_FONT_SIZE,
  MEMORY_GROUP_HEIGHT,
  MEMORY_PADDING_X,
  MEMORY_ROW_HEIGHT,
  MEMORY_TITLE_HEIGHT,
  MEMORY_TITLE_TOGGLE_WIDTH,
  layoutMemory,
} from './memoryLayout';
export type {
  MemoryCaptionGeometry,
  MemoryColumnGeometry,
  MemoryColumnKey,
  MemoryFoldGeometry,
  MemoryGeometry,
  MemoryRowGeometry,
  MemoryRowKind,
  MemorySegmentGeometry,
} from './memoryLayout';
export type {
  ArrowGeometry,
  CellGeometry,
  Geometry,
  Point,
  StackGeometry,
} from './layout';
export { FoldState } from './foldState';
export { ViewOptions } from './viewOptions';
export { HISTORY_LIMIT, StepHistory } from './history';
export {
  CELL_FONT_SIZE,
  CELL_HEIGHT,
  MEMORY_ALIGNMENT,
  MEMORY_START_ADDRESSES,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
  isWithinFold,
  startsCollapsed,
  startsShown,
} from './model';
export type {
  CellKind,
  CellModel,
  CodeRangeModel,
  ExpressionModel,
  ExpressionNodeKind,
  ExpressionNodeModel,
  FunctionModel,
  MemoryGroupModel,
  MemoryRegion,
  MemorySegmentModel,
  PointerModel,
  StackModel,
  StepModel,
  VariableModel,
} from './model';
