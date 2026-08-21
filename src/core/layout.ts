import Hashids from 'hashids';
import stringHash from 'string-hash';
import { Vector } from 'vector2d';
import { FoldState } from './foldState';
import {
  CELL_FONT_SIZE,
  CELL_HEIGHT,
  CellKind,
  CellModel,
  StepModel,
  cellWidth,
} from './model';

/**
 * Where everything goes.
 *
 * This is the other half of the old `CanvasDrawer`: given a step model and the
 * folds the user has opened, it squares off each stack's columns, places the
 * cells, and routes an arrow for every pointer whose target is on screen. It
 * knows nothing about the interpreter and nothing about a renderer - the
 * result is coordinates consumed by the JointJS visualization.
 */

export interface Point {
  x: number;
  y: number;
}

export interface CellGeometry {
  key: string;
  text: string;
  /** Complete text when `text` was shortened to fit its cell. */
  tooltip?: string;
  kind: CellKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** One entry per arrow that ends or starts here; empty for most cells. */
  colors: string[];
  /** For a `fold` cell: the group a click on it shows and hides. */
  foldTarget?: string;
}

export interface StackGeometry {
  key: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Visible rows only: a folded row is absent rather than hidden. */
  rows: CellGeometry[][];
}

export interface ArrowGeometry {
  key: string;
  from: Point;
  mid: Point;
  to: Point;
  color: string;
  /**
   * Points the line must pass through, in order. The memory view sets them - a
   * pointer between two segments in the same column is drawn out into the
   * gutter beside them and run down it - and leaves the router to it
   * otherwise.
   */
  vertices?: Point[];
}

export interface Geometry {
  stacks: StackGeometry[];
  arrows: ArrowGeometry[];
}

/** The triangle on an aggregate's row, pointing at what it will do. */
const FOLD_OPEN = '▼';
const FOLD_CLOSED = '▲';

const ORIGIN_X = 50;
const ORIGIN_Y = 50;
/** Each stack is stepped right of the one above it, and spaced below it. */
const STACK_OFFSET_X = 10;
const STACK_OFFSET_Y = 10;

// Six lowercase hexadecimal digits: a colour, derived from the two keys, so
// that the same pointer keeps the same colour from one step to the next.
const hashids = new Hashids('', 6, '1234567890abcdef');

export const connectionColor = (fromKey: string, toKey: string): string =>
  `#${hashids.encode(stringHash(fromKey), stringHash(toKey)).substr(0, 6)}`;

const geometryOf = (
  model: CellModel,
  text: string,
  colors: string[] = []
): CellGeometry => {
  const geometry: CellGeometry = {
    key: model.key,
    text,
    kind: model.kind,
    x: -1,
    y: -1,
    width: model.width,
    height: CELL_HEIGHT,
    colors,
  };
  if (model.foldTarget !== undefined) {
    geometry.foldTarget = model.foldTarget;
  }
  return geometry;
};

const paddingCell = (stackKey: string, row: number, column: number) =>
  geometryOf(
    {
      key: `${stackKey}-empty-${row}-${column}`,
      text: '',
      kind: 'empty',
      width: cellWidth(''),
    },
    ''
  );

/**
 * Every row is given the same number of columns, and every column the width of
 * its widest cell, so that the values in a stack line up under one another.
 * Hidden rows count: a column may not change width because an array was
 * folded, or the stack would twitch every time one was opened.
 */
function squareOff(rows: CellGeometry[][], stackKey: string): void {
  if (rows.length < 2) {
    return;
  }
  const columns = Math.max(...rows.map((row) => row.length));
  rows.forEach((row, index) => {
    while (row.length < columns) {
      row.push(paddingCell(stackKey, index, row.length));
    }
  });
  const widths = new Array<number>(columns).fill(0);
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column], cell.width);
    });
  }
  for (const row of rows) {
    row.forEach((cell, column) => {
      cell.width = widths[column];
    });
  }
}

const rowWidth = (rows: CellGeometry[][]): number =>
  rows.length === 0 ? 0 : rows[0].reduce((sum, cell) => sum + cell.width, 0);

/**
 * A stack is at least as wide as the name written across its header, which for
 * a long function name means widening every column in proportion.
 */
function rescaleForName(rows: CellGeometry[][], name: string): void {
  if (rows.length === 0) {
    return;
  }
  const nameWidth = ((name.length + 3) * CELL_FONT_SIZE) / 2;
  while (0 < rowWidth(rows) && rowWidth(rows) < nameWidth) {
    const scale = nameWidth / rowWidth(rows);
    for (const row of rows) {
      for (const cell of row) {
        cell.width *= scale;
      }
    }
  }
}

/**
 * The arrow the canvas draws for one pointer: from the right-hand edge of the
 * cell holding the address to the left-hand edge of the cell it names, bowed
 * to one side so that two arrows between the same pair of rows stay apart.
 */
function arrowGeometry(
  fromCell: CellGeometry,
  toCell: CellGeometry,
  color: string
): ArrowGeometry {
  const start = new Vector(fromCell.x + fromCell.width, fromCell.y);
  const end = new Vector(toCell.x, toCell.y);
  const halfHeight = CELL_HEIGHT / 2;
  const from = clone(start).add(new Vector(-5, halfHeight));
  const to = clone(end).add(new Vector(5, halfHeight));
  const mid = midPoint(clone(start), clone(end));
  return {
    key: `${from.x},${from.y}-${mid.x},${mid.y}-${to.x},${to.y}`,
    from: { x: from.x, y: from.y },
    mid: { x: mid.x, y: mid.y },
    to: { x: to.x, y: to.y },
    color,
  };
}

const clone = (v: Vector) => new Vector(v.x, v.y);

// Kept as it was written, mutations and all: `add` and `subtract` modify the
// receiver, so `dir` ends up half of `to - from` rather than all of it, and the
// bow is an eighth of the distance rather than a quarter. The curve on screen
// is what this arithmetic produces, so it is copied rather than tidied.
function midPoint(from: Vector, to: Vector): Vector {
  const isDownArrow = from.y < to.y;
  const mid = from.add(to).divS(2);
  const dir = to.subtract(from);
  const length = dir.length();
  dir.normalise().rotate(isDownArrow ? 90 : -90);
  return mid.add(dir.mulS(length / 4));
}

export function layout(model: StepModel, folds: FoldState): Geometry {
  const stacks: StackGeometry[] = [];
  const visibleCells = new Map<string, CellGeometry>();
  let sumOfHeight = 0;

  model.stacks.forEach((stack, index) => {
    const rows = stack.rows.map((row) =>
      row.map((cell) =>
        geometryOf(
          cell,
          cell.kind === 'fold' && cell.foldTarget !== undefined
            ? folds.isFolded(cell.foldTarget)
              ? FOLD_CLOSED
              : FOLD_OPEN
            : cell.text
        )
      )
    );
    squareOff(rows, stack.key);
    rescaleForName(rows, stack.name);

    const x = ORIGIN_X + STACK_OFFSET_X * index;
    const y = ORIGIN_Y + sumOfHeight;
    const visible: CellGeometry[][] = [];
    stack.rows.forEach((row, rowIndex) => {
      if (folds.hides(row[0].foldGroup)) {
        return;
      }
      // The header sits on the stack's own line, so the first row starts one
      // cell below it.
      const rowY = y + CELL_HEIGHT * (visible.length + 1);
      let left = 0;
      for (const cell of rows[rowIndex]) {
        cell.x = x + left;
        cell.y = rowY;
        left += cell.width;
        visibleCells.set(cell.key, cell);
      }
      visible.push(rows[rowIndex]);
    });

    const height = (visible.length + 1) * CELL_HEIGHT;
    const width =
      rows.length === 0
        ? Math.max(cellWidth(stack.name), CELL_FONT_SIZE * 6)
        : rowWidth(rows);
    stacks.push({
      key: stack.key,
      name: stack.name,
      x,
      y,
      width,
      height,
      rows: visible,
    });
    sumOfHeight += height + STACK_OFFSET_Y;
  });

  const arrows: ArrowGeometry[] = [];
  for (const pointer of model.pointers) {
    const fromCell = visibleCells.get(pointer.from);
    const toCell = visibleCells.get(pointer.to);
    if (fromCell === undefined || toCell === undefined) {
      // One end is folded away. An arrow into a closed array would point at
      // the row that took its place.
      continue;
    }
    const color = connectionColor(pointer.from, pointer.to);
    arrows.push(arrowGeometry(fromCell, toCell, color));
    fromCell.colors.push(color);
    toCell.colors.push(color);
  }

  return { stacks, arrows };
}
