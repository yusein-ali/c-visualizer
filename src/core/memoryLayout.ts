import { FoldState } from './foldState';
import { ArrowGeometry, CellGeometry, Point, connectionColor } from './layout';
import {
  CELL_HEIGHT,
  CellModel,
  MemoryGroupModel,
  MemoryRegion,
  MemorySegmentModel,
  StepModel,
  startsCollapsed,
} from './model';
import { formatAddress } from './variables';

/**
 * Where the process memory goes.
 *
 * The stack layout next door places one table per call frame and steps each
 * table right of the one above it, which is the right picture for frames and
 * the wrong one for memory: seven segments cascading down the canvas read as
 * seven unrelated objects rather than one address space. This lays them out
 * as a memory map instead - a column of segment nodes from the highest
 * addresses to the lowest, all the same width, with one shared set of columns
 * so that an address in the heap sits directly above an address in the text
 * segment.
 *
 * An object is a two-band row: what it is, written small, above what it is
 * called and what it holds. The address column spans both bands and its upper
 * half is left blank, which is where a pointer's arrow is put down: the head
 * lands inside the address cell of whatever the pointer names, whole and over
 * white, rather than stopping at the border of the node.
 *
 * Like `layout`, this knows nothing about the interpreter and nothing about a
 * renderer. It produces coordinates and text; JointJS draws them.
 */

/** The type size inside a memory node. Smaller than a stack table's. */
export const MEMORY_FONT_SIZE = 14;
/** A monospace character at that size, near enough for column widths. */
const CHARACTER_WIDTH = MEMORY_FONT_SIZE * 0.6;

/** The segment's name and address range. */
export const MEMORY_TITLE_HEIGHT = 32;
/** A title whose range cannot share its line with the segment name. */
export const MEMORY_WRAPPED_TITLE_HEIGHT = 50;
/** The row naming the columns below it. */
export const MEMORY_COLUMN_HEADER_HEIGHT = 24;
/** The row naming a stack frame within the stack segment. */
export const MEMORY_GROUP_HEIGHT = 22;
/** The band above an object holding its type and its size. */
export const MEMORY_CAPTION_HEIGHT = 17;
/** The band holding the object itself, at the stack table's row height. */
export const MEMORY_ROW_HEIGHT = CELL_HEIGHT;
/** Both bands together: one object. */
export const MEMORY_ENTRY_HEIGHT = MEMORY_CAPTION_HEIGHT + MEMORY_ROW_HEIGHT;

const ORIGIN_X = 24;
const ORIGIN_Y = 24;
const SEGMENT_GAP_Y = 20;
/** Text never touches a cell edge. */
export const MEMORY_PADDING_X = 8;
/** One level of nesting inside an aggregate. */
const INDENT_WIDTH = 14;
/**
 * The gutter the fold triangle sits in, reserved on every row so that the
 * names of folding and non-folding rows line up.
 */
export const MEMORY_FOLD_WIDTH = 16;
/**
 * The gutter the segment's own chevron sits in, at the left of its title bar.
 */
export const MEMORY_TITLE_TOGGLE_WIDTH = 16;
const MIN_COLUMN_WIDTH = 86;
const MAX_COLUMN_WIDTH = 340;

/** The triangle on an aggregate's row, pointing at what it will do. */
const FOLD_OPEN = '▼';
const FOLD_CLOSED = '▲';

/**
 * Two columns. What the running function is working with - the registers and
 * the stack it pushes frames onto - is what a reader watches step by step, so
 * it leads on the left; the rest of the address space stands beside it in
 * descending order, heap down to the text the program was loaded from.
 */
const LEFT_COLUMN: MemoryRegion[] = ['registers', 'stack'];
const RIGHT_COLUMN: MemoryRegion[] = [
  'heap',
  'bss',
  'data',
  'readOnly',
  'text',
];
const SEGMENT_ORDER: MemoryRegion[] = [...LEFT_COLUMN, ...RIGHT_COLUMN];

/** Which of the two columns a region is drawn in. */
const sideOf = (region: MemoryRegion): number =>
  LEFT_COLUMN.indexOf(region) === -1 ? 1 : 0;

/** Between the two columns of segments. */
const COLUMN_GAP_X = 28;
/** How far outside a column an arrow between two of its segments is drawn. */
const GUTTER_X = 16;
/** Successive arrows in the same gutter are held apart by this much. */
const GUTTER_LANE_X = 12;
/** Room left beyond the outermost lane, so that no arrow meets the edge. */
const GUTTER_EDGE_X = 10;

/** A pointer is four bytes wide, so an address is eight digits wide. */
const ADDRESS_BYTES = 4;
const HEX = /^0x[0-9A-F]+$/;

/**
 * Addresses are written to the width they occupy rather than to the width of
 * the number that happens to be in them, so that a column of them reads as a
 * column of addresses.
 */
const padHex = (text: string, bytes: number): string =>
  HEX.test(text) ? `0x${text.slice(2).padStart(bytes * 2, '0')}` : text;

export type MemoryColumnKey = 'address' | 'name' | 'value';

const COLUMN_ORDER: MemoryColumnKey[] = ['address', 'name', 'value'];

export interface MemoryColumnGeometry {
  key: MemoryColumnKey;
  /** Offset from the segment node's left edge. */
  x: number;
  width: number;
}

/** The clickable triangle in the name column of an aggregate's row. */
export interface MemoryFoldGeometry {
  key: string;
  /** The fold group a click shows and hides. */
  target: string;
  text: string;
  /** Offset from the segment node's left edge, like the columns. */
  x: number;
  width: number;
}

/** The type and size written above an object. */
export interface MemoryCaptionGeometry {
  text: string;
  x: number;
  width: number;
  height: number;
}

export type MemoryRowKind = 'entry' | 'group' | 'empty';

export interface MemoryRowGeometry {
  kind: MemoryRowKind;
  key: string;
  /** Offset from the segment node's top edge. */
  y: number;
  height: number;
  /** Where the object's own band starts, below the caption. */
  bandY: number;
  bandHeight: number;
  /** For a `group` row: the frame it names. Entry rows carry cells instead. */
  label?: string;
  /** For a `group` row: whether the frame's own rows are put away. */
  collapsed?: boolean;
  /**
   * The object the row draws, where it draws one. It is the same key the
   * editor's tooltip carries, so pointing at a variable on one side can light
   * up the row on the other without either side knowing how the other builds
   * its picture.
   */
  object?: string;
  /** How far into the name column this row's name is pushed, in pixels. */
  indent: number;
  caption?: MemoryCaptionGeometry;
  /** One per column, in `COLUMN_ORDER`; absent columns are blank cells. */
  cells: CellGeometry[];
  fold?: MemoryFoldGeometry;
}

export interface MemorySegmentGeometry {
  key: MemoryRegion;
  name: string;
  /** The addresses the segment covers, already spelled out. */
  addressLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  titleHeight: number;
  /** Zero for a collapsed segment: there are no columns to name. */
  columnHeaderHeight: number;
  /** Drawn as its title bar alone, with its table put away. */
  collapsed: boolean;
  columns: MemoryColumnGeometry[];
  /** Visible rows only: a folded row is absent rather than hidden, and a
   * collapsed segment has none at all. */
  rows: MemoryRowGeometry[];
}

export interface MemoryGeometry {
  segments: MemorySegmentGeometry[];
  arrows: ArrowGeometry[];
  /** The extent of the whole map, for sizing the paper. */
  width: number;
  height: number;
}

/** One model row, read by cell kind rather than by position. */
interface RowParts {
  indent: number;
  type?: CellModel;
  fold?: CellModel;
  foldGroup?: string;
  cells: Map<MemoryColumnKey, CellModel>;
}

const isColumn = (kind: CellModel['kind']): kind is MemoryColumnKey =>
  kind === 'address' || kind === 'name' || kind === 'value';

const partsOf = (row: CellModel[]): RowParts => {
  const parts: RowParts = { indent: 0, cells: new Map() };
  for (const cell of row) {
    if (cell.kind === 'indent') {
      parts.indent += 1;
    } else if (cell.kind === 'fold') {
      parts.fold = cell;
    } else if (cell.kind === 'type') {
      parts.type = cell;
    } else if (isColumn(cell.kind)) {
      parts.cells.set(cell.kind, cell);
    }
  }
  parts.foldGroup = row.length === 0 ? undefined : row[0].foldGroup;
  return parts;
};

/**
 * What a cell says in the memory view. The address column is the one place
 * the two views disagree: a stack table writes `&x(0x1F4) ` because the row is
 * about the variable, and a memory table writes the address on its own because
 * the row is about the address. A register has no address to write, so its
 * slot name stands.
 */
const textOf = (column: MemoryColumnKey, cell: CellModel): string =>
  column === 'address' && typeof cell.address === 'number'
    ? padHex(formatAddress(cell.address), ADDRESS_BYTES)
    : padHex(cell.text, ADDRESS_BYTES);

/** `int · 4 B`: what the object is, and how much of the segment it takes. */
const captionOf = (type: CellModel | undefined): string => {
  if (typeof type === 'undefined') {
    return '';
  }
  const text = type.text.trim();
  return typeof type.size === 'number' ? `${text} · ${type.size} B` : text;
};

const measure = (text: string): number =>
  text.length * CHARACTER_WIDTH + 2 * MEMORY_PADDING_X;

const clamp = (width: number): number =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.ceil(width)));

/** Cuts text that would run past its column rather than let it overlap. */
const ellipsize = (text: string, width: number): string => {
  const room = Math.floor((width - 2 * MEMORY_PADDING_X) / CHARACTER_WIDTH);
  return text.length <= room
    ? text
    : room <= 1
      ? '…'
      : `${text.slice(0, room - 1)}…`;
};

/**
 * The columns are shared by every segment, so that the map reads down as well
 * as across. Hidden rows are measured too: a column may not change width
 * because an aggregate was folded, or the whole map would twitch on a click.
 */
const titleWidth = (name: string, addressLabel: string): number =>
  // The name is set in the interface font and the addresses in the monospace
  // one; both are approximations, and both err wide.
  name.length * (MEMORY_FONT_SIZE + 1) * 0.6 +
  addressLabel.length * CHARACTER_WIDTH +
  4 * MEMORY_PADDING_X +
  MEMORY_TITLE_TOGGLE_WIDTH;

/**
 * The title is rendered in a bold interface font, so use a deliberately
 * generous estimate for the name. The range gets its own line before the two
 * labels can collide; widening the table is not always possible because the
 * memory map may have been given two fixed columns.
 */
const titleFitsOnOneLine = (
  name: string,
  addressLabel: string,
  width: number
): boolean =>
  name.length * (MEMORY_FONT_SIZE + 1) +
    addressLabel.length * CHARACTER_WIDTH +
    4 * MEMORY_PADDING_X +
    MEMORY_TITLE_TOGGLE_WIDTH <=
    width;

function columnWidths(
  segments: MemorySegmentModel[],
  maxNodeWidth?: number
): Map<MemoryColumnKey, number> {
  const widths = new Map<MemoryColumnKey, number>(
    COLUMN_ORDER.map((key) => [key, MIN_COLUMN_WIDTH])
  );
  let caption = 0;
  for (const segment of segments) {
    for (const row of segment.rows) {
      const parts = partsOf(row);
      const gutter = parts.indent * INDENT_WIDTH + MEMORY_FOLD_WIDTH;
      caption = Math.max(caption, measure(captionOf(parts.type)) + gutter);
      for (const column of COLUMN_ORDER) {
        const cell = parts.cells.get(column);
        if (typeof cell === 'undefined') {
          continue;
        }
        widths.set(
          column,
          Math.max(
            widths.get(column) as number,
            Math.min(
              cell.maxWidth ?? Number.POSITIVE_INFINITY,
              measure(textOf(column, cell))
            ) + (column === 'name' ? gutter : 0)
          )
        );
      }
    }
  }
  for (const [column, width] of widths) {
    widths.set(column, clamp(width));
  }
  // The caption runs across the object's own two columns; if it is longer than
  // both together, the value column takes up the slack.
  const objectWidth =
    (widths.get('name') as number) + (widths.get('value') as number);
  if (objectWidth < caption) {
    widths.set(
      'value',
      (widths.get('value') as number) + Math.ceil(caption - objectWidth)
    );
  }
  // A node is at least as wide as its own title bar: the name of a segment and
  // the addresses it covers are written on one line, and `Zero-initialized
  // data (BSS)` is a long name.
  const title = segments.reduce(
    (widest, segment) =>
      Math.max(widest, titleWidth(segment.name, addressLabelOf(segment))),
    0
  );
  const nodeWidth = COLUMN_ORDER.reduce(
    (sum, column) => sum + (widths.get(column) as number),
    0
  );
  if (nodeWidth < title) {
    // Spread the slack rather than leave one gaping column: the table is
    // being widened for the sake of its heading, not its contents.
    const slack = Math.ceil((title - nodeWidth) / COLUMN_ORDER.length);
    for (const column of COLUMN_ORDER) {
      widths.set(column, (widths.get(column) as number) + slack);
    }
  }
  if (typeof maxNodeWidth === 'number' && nodeWidth > maxNodeWidth) {
    const scale = maxNodeWidth / nodeWidth;
    for (const column of COLUMN_ORDER) {
      widths.set(column, (widths.get(column) as number) * scale);
    }
  }
  return widths;
}

/** Where the rows of each group start, so a frame is announced once. */
function groupStarts(
  segment: MemorySegmentModel
): Map<number, MemoryGroupModel> {
  const starts = new Map<number, MemoryGroupModel>();
  let index = 0;
  for (const group of segment.groups) {
    if (group.rows > 0) {
      starts.set(index, group);
      index += group.rows;
    }
  }
  return starts;
}

/**
 * The addresses a segment covers. An empty segment still says where it would
 * begin: the point of a memory map is that the parts holding nothing yet are
 * drawn too.
 */
function addressLabelOf(segment: MemorySegmentModel): string {
  if (segment.key === 'registers') {
    return segment.rows.length === 0 ? '—' : `R0 – R${segment.rows.length - 1}`;
  }
  const addresses: number[] = [];
  let endAddress: number | null = null;
  for (const row of segment.rows) {
    let rowAddress: number | null = null;
    let rowSize = 1;
    for (const cell of row) {
      if (cell.kind === 'address' && typeof cell.address === 'number') {
        addresses.push(cell.address);
        rowAddress = cell.address;
      }
      if (cell.kind === 'type' && typeof cell.size === 'number') {
        rowSize = cell.size;
      }
    }
    if (segment.key === 'text' && rowAddress !== null) {
      endAddress = Math.max(endAddress ?? rowAddress, rowAddress + rowSize - 1);
    }
  }
  if (addresses.length === 0) {
    return `${formatAddress(segment.startAddress)} –`;
  }
  return `${formatAddress(Math.min(...addresses))} – ${formatAddress(
    endAddress ?? Math.max(...addresses)
  )}`;
}

const cellGeometry = (
  key: string,
  kind: CellModel['kind'],
  text: string,
  x: number,
  width: number,
  tooltip?: string
): CellGeometry => ({
  key,
  text,
  ...(typeof tooltip === 'undefined' ? {} : { tooltip }),
  kind,
  x,
  // Filled in once the row's place in the node is settled.
  y: 0,
  width,
  height: MEMORY_ROW_HEIGHT,
  colors: [],
});

type Side = 'left' | 'right';

/**
 * Where a cell's own row meets the edges of the segment it is in. A pointer is
 * one object naming another, and the address it holds is written in its row
 * already - so the line is drawn from row to row rather than threaded through
 * the table, and it is the edges of the nodes that say where it runs. The ends
 * themselves are placed by `endpointOf`, a little inside the node where the
 * address column is.
 */
interface Anchor {
  /** Which column of segments the row is in. */
  side: number;
  left: number;
  right: number;
}

/** Just outside the node, so that an outgoing line clears its value cell. */
const CLEARANCE = 3;

/**
 * How far inside the address column an arrow that meets a node on that side is
 * taken. Far enough that the whole head is over the cell rather than half of
 * it over the border the cell is drawn with.
 */
const ADDRESS_INSET_X = 12;

/**
 * Which way out of a column its own arrows go: away from the middle of the
 * map, so that a pointer between two segments of one column never shares
 * ground with the pointers crossing between the columns.
 */
const OUTER_SIDE: Side[] = ['left', 'right'];

/** The room a column needs beside it to hold that many lanes of arrows. */
const gutterWidth = (lanes: number): number =>
  lanes === 0 ? 0 : GUTTER_X + (lanes - 1) * GUTTER_LANE_X + GUTTER_EDGE_X;

/**
 * The room between the two columns. A pointer crossing between them runs down
 * here, in a lane of its own, so the gap holds whatever the crossings need -
 * and the plain gap between two nodes when there are none.
 */
const crossingGap = (crossings: number): number =>
  Math.max(
    COLUMN_GAP_X,
    crossings === 0 ? 0 : 2 * GUTTER_EDGE_X + (crossings - 1) * GUTTER_LANE_X
  );

/** One pointer whose two ends are both on the map this step draws. */
interface Routed {
  fromCell: CellGeometry;
  toCell: CellGeometry;
  fromAnchor: Anchor;
  toAnchor: Anchor;
  /** The exact target row is put away, so the region title stands in for it. */
  toHeading: boolean;
  color: string;
}

interface LaneAllocation {
  /** One lane per route, or -1 when that route was not part of this group. */
  laneOf: number[];
  /** How many lanes the overlapping vertical spans actually require. */
  count: number;
}

/**
 * Packs arrows into the first gutter lane whose previous vertical run has
 * ended. Two arrows at different heights can share the same x coordinate;
 * only arrows whose vertical spans overlap need separate lanes.
 */
const allocateLanes = (
  routes: Routed[],
  accepts: (route: Routed) => boolean
): LaneAllocation => {
  const laneOf = new Array<number>(routes.length).fill(-1);
  const requests = routes
    .map((route, index) => ({
      index,
      start: Math.min(route.fromCell.y, route.toCell.y),
      end: Math.max(route.fromCell.y, route.toCell.y),
    }))
    .filter(({ index }) => accepts(routes[index]))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const laneEnds: number[] = [];

  for (const request of requests) {
    let lane = laneEnds.findIndex((end) => end < request.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(request.end);
    } else {
      laneEnds[lane] = request.end;
    }
    laneOf[request.index] = lane;
  }

  return { laneOf, count: laneEnds.length };
};

const middleOf = (cell: CellGeometry): number => cell.y + MEMORY_ROW_HEIGHT / 2;

/**
 * The blank upper half of a row's address cell. The address is written in the
 * object's own band, but its cell spans the caption above it as well - the
 * address belongs to the whole object - and nothing is written in that half:
 * the caption starts at the name column, beside it. It is the one part of a
 * row an arrow can be put down on without covering something.
 */
const addressBandOf = (cell: CellGeometry): number =>
  cell.y - MEMORY_CAPTION_HEIGHT / 2;

/**
 * Where an arrow meets a row. The address column is the node's left-hand one,
 * so a line meeting a node on that side is taken inside and put down in the
 * top of the address cell, where it is drawn whole and over white. On the
 * right, an outgoing line starts just outside the value cell, but an incoming
 * arrow is taken inside the blank end of the caption band. Leaving its head
 * outside made right-column pointers look detached from the row they named.
 */
const endpointOf = (
  cell: CellGeometry,
  anchor: Anchor,
  side: Side,
  incoming: boolean
): Point =>
  side === 'left'
    ? { x: anchor.left + ADDRESS_INSET_X, y: addressBandOf(cell) }
    : incoming
      ? { x: anchor.right - ADDRESS_INSET_X, y: addressBandOf(cell) }
      : { x: anchor.right + CLEARANCE, y: middleOf(cell) };

/**
 * One pointer, from the row of the object holding the address to the row of
 * the object at it. Which side of each row it touches is the caller's
 * decision: what is on the left of the map should not be reached by crossing
 * everything to its right. What that side means for the end itself - inside
 * the address cell, or just outside the value's - is `endpointOf`'s.
 */
function pointerArrow(
  fromCell: CellGeometry,
  fromAnchor: Anchor,
  toCell: CellGeometry,
  toAnchor: Anchor,
  color: string,
  fromSide: Side,
  toSide: Side,
  laneX?: number,
  toHeading = false
): ArrowGeometry {
  const from = endpointOf(fromCell, fromAnchor, fromSide, false);
  const to = toHeading
    ? {
        x:
          toSide === 'left'
            ? toAnchor.left + ADDRESS_INSET_X
            : toAnchor.right - ADDRESS_INSET_X,
        y: toCell.y,
      }
    : endpointOf(toCell, toAnchor, toSide, true);
  const arrow: ArrowGeometry = {
    key: `${fromCell.key}-${toCell.key}`,
    from,
    mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    to,
    color,
  };
  if (typeof laneX !== 'undefined') {
    // Out of the row, down the lane, and back in at the row it names: two
    // corners, and a straight run between them that shares no ground with the
    // segments or with the other arrows in the gutter.
    arrow.vertices = [
      { x: laneX, y: from.y },
      { x: laneX, y: to.y },
    ];
    arrow.mid = { x: laneX, y: (from.y + to.y) / 2 };
  }
  return arrow;
}

export function layoutMemory(
  model: StepModel,
  folds: FoldState,
  availableWidth?: number
): MemoryGeometry {
  const byKey = new Map(model.memory.map((segment) => [segment.key, segment]));
  const ordered = SEGMENT_ORDER.map((key) => byKey.get(key)).filter(
    (segment): segment is MemorySegmentModel => typeof segment !== 'undefined'
  );

  const maxNodeWidth =
    typeof availableWidth === 'number'
      ? Math.max(1, (availableWidth - COLUMN_GAP_X) / 2)
      : undefined;
  const widths = columnWidths(ordered, maxNodeWidth);
  let left = 0;
  const columns: MemoryColumnGeometry[] = COLUMN_ORDER.map((key) => {
    const width = widths.get(key) as number;
    const column = { key, x: left, width };
    left += width;
    return column;
  });
  const nameColumn = columns[COLUMN_ORDER.indexOf('name')];
  const valueColumn = columns[COLUMN_ORDER.indexOf('value')];
  const nodeWidth = left;

  const visibleCells = new Map<string, CellGeometry>();
  /** Address cells represented by their region heading while it is collapsed. */
  const collapsedTargets = new Map<string, CellGeometry>();
  /** Where each cell's row meets its node's edges, for routing its arrows. */
  const cellAnchor = new Map<string, Anchor>();
  const segments: MemorySegmentGeometry[] = [];
  // One cursor per column: `[left, right]`.
  const columnX = [ORIGIN_X, ORIGIN_X + nodeWidth + COLUMN_GAP_X];
  const tops = [ORIGIN_Y, ORIGIN_Y];
  const bottoms = [ORIGIN_Y, ORIGIN_Y];

  for (const segment of ordered) {
    const side = sideOf(segment.key);
    const segmentTop = tops[side];
    // A segment holding nothing starts as its title bar, and so do the code
    // and the constants, which hold the same thing at every step: the map
    // still says that the segment is there and where it begins, without
    // spending a table on what nobody is reading. Either opens on a click
    // like any other, and stays open once the user has asked for it.
    const collapsed = folds.isCollapsed(
      segment.key,
      startsCollapsed(segment.key, segment.rows.length === 0)
    );
    const starts = groupStarts(segment);
    const rows: MemoryRowGeometry[] = [];

    // A collapsed segment builds no rows at all. Its address cells still get
    // a temporary anchor near the clear top edge of its title bar, so a
    // visible pointer can say which closed region contains its destination.
    // Sources remain absent: a pointer value that is put away cannot emit a
    // line until its own region is reopened.
    if (collapsed) {
      for (const row of segment.rows) {
        for (const cell of row) {
          if (cell.kind !== 'address') {
            continue;
          }
          const target = cellGeometry(cell.key, cell.kind, '', 0, 0);
          target.y = segmentTop + 6;
          collapsedTargets.set(cell.key, target);
          cellAnchor.set(cell.key, {
            side,
            left: columnX[side],
            right: columnX[side] + nodeWidth,
          });
        }
      }
    }
    const modelRows = collapsed ? [] : segment.rows;
    /** The model row a folded frame's own rows run up to, exclusive. */
    let framedUntil = -1;
    modelRows.forEach((row, index) => {
      const parts = partsOf(row);
      const frame = starts.get(index);
      if (typeof frame !== 'undefined') {
        // A frame nobody has clicked is drawn open only while it is the one
        // running: the calls underneath it are what the reader came from
        // rather than what they are stepping through, and the map is a lot
        // shorter for saying so.
        const frameFolded = folds.isFrameFolded(frame.key, !frame.current);
        framedUntil = frameFolded ? index + frame.rows : -1;
        rows.push({
          kind: 'group',
          key: `${segment.key}-group-${index}`,
          y: 0,
          height: MEMORY_GROUP_HEIGHT,
          bandY: 0,
          bandHeight: MEMORY_GROUP_HEIGHT,
          label: frame.name,
          collapsed: frameFolded,
          indent: 0,
          cells: [],
          fold: {
            key: `${segment.key}-group-${index}-fold`,
            target: frame.key,
            text: frameFolded ? FOLD_CLOSED : FOLD_OPEN,
            x: MEMORY_PADDING_X,
            width: MEMORY_FOLD_WIDTH,
          },
        });
      }
      if (index < framedUntil || folds.hides(parts.foldGroup)) {
        return;
      }

      const indent = parts.indent * INDENT_WIDTH;
      const gutter = indent + MEMORY_FOLD_WIDTH;
      const cells = columns.map((column) => {
        const cellModel = parts.cells.get(column.key);
        if (typeof cellModel === 'undefined') {
          return cellGeometry(
            `${segment.key}-${index}-${column.key}-blank`,
            'empty',
            '',
            column.x,
            column.width
          );
        }
        const room = column.width - (column.key === 'name' ? gutter : 0);
        const fullText = textOf(column.key, cellModel);
        const shown = ellipsize(fullText, room);
        const cell = cellGeometry(
          cellModel.key,
          cellModel.kind,
          shown,
          column.x,
          column.width,
          shown === fullText ? undefined : fullText
        );
        visibleCells.set(cell.key, cell);
        cellAnchor.set(cell.key, {
          side,
          left: columnX[side],
          right: columnX[side] + nodeWidth,
        });
        return cell;
      });

      const object = parts.cells.get('name')?.object;
      const geometry: MemoryRowGeometry = {
        kind: 'entry',
        key: `${segment.key}-row-${index}`,
        ...(typeof object === 'undefined' ? {} : { object }),
        y: 0,
        height: MEMORY_ENTRY_HEIGHT,
        bandY: MEMORY_CAPTION_HEIGHT,
        bandHeight: MEMORY_ROW_HEIGHT,
        indent,
        caption: {
          text: ellipsize(
            captionOf(parts.type),
            nameColumn.width + valueColumn.width - gutter
          ),
          x: nameColumn.x,
          width: nameColumn.width + valueColumn.width,
          height: MEMORY_CAPTION_HEIGHT,
        },
        cells,
      };
      if (
        typeof parts.fold !== 'undefined' &&
        typeof parts.fold.foldTarget === 'string'
      ) {
        geometry.fold = {
          key: parts.fold.key,
          target: parts.fold.foldTarget,
          text: folds.isFolded(parts.fold.foldTarget) ? FOLD_CLOSED : FOLD_OPEN,
          x: nameColumn.x + MEMORY_PADDING_X + indent,
          width: MEMORY_FOLD_WIDTH,
        };
      }
      rows.push(geometry);
    });

    // A group whose every row is folded away announces a frame that is not
    // there; drop it rather than leave a heading over nothing. A frame the
    // reader folded is the exception - the heading is the only thing left to
    // click to get it back.
    const kept = rows.filter(
      (row, index) =>
        row.kind !== 'group' ||
        row.collapsed === true ||
        (index + 1 < rows.length && rows[index + 1].kind === 'entry')
    );
    const columnHeaderHeight = collapsed ? 0 : MEMORY_COLUMN_HEADER_HEIGHT;
    const addressLabel = addressLabelOf(segment);
    const titleHeight = titleFitsOnOneLine(
      segment.name,
      addressLabel,
      nodeWidth
    )
      ? MEMORY_TITLE_HEIGHT
      : MEMORY_WRAPPED_TITLE_HEIGHT;
    let y = titleHeight + columnHeaderHeight;
    for (const row of kept) {
      row.y = y;
      for (const cell of row.cells) {
        // Arrows are anchored on the object's own band, not on its caption.
        cell.y = segmentTop + y + row.bandY;
      }
      y += row.height;
    }
    if (kept.length === 0 && !collapsed) {
      kept.push({
        kind: 'empty',
        key: `${segment.key}-empty`,
        y,
        height: MEMORY_ROW_HEIGHT,
        bandY: 0,
        bandHeight: MEMORY_ROW_HEIGHT,
        indent: 0,
        cells: [],
      });
      y += MEMORY_ROW_HEIGHT;
    }

    segments.push({
      key: segment.key,
      name: segment.name,
      addressLabel,
      x: columnX[side],
      y: segmentTop,
      width: nodeWidth,
      height: y,
      titleHeight,
      columnHeaderHeight,
      collapsed,
      columns,
      rows: kept,
    });
    bottoms[side] = segmentTop + y;
    tops[side] = segmentTop + y + SEGMENT_GAP_Y;
  }

  // A pointer between two segments in the same column is drawn out beyond
  // that column and run down beside it, so both columns need room on their
  // outer edge: as many lanes as the pointers this step actually shows.
  const routed = model.pointers
    .map((pointer) => {
      const fromCell = visibleCells.get(pointer.from);
      const visibleTarget = visibleCells.get(pointer.to);
      const toCell = visibleTarget ?? collapsedTargets.get(pointer.to);
      if (fromCell === undefined || toCell === undefined) {
        // The source is put away, the target is folded within an open region,
        // or one end is in a region this step does not show at all.
        return null;
      }
      return {
        fromCell,
        toCell,
        fromAnchor: cellAnchor.get(pointer.from) as Anchor,
        toAnchor: cellAnchor.get(pointer.to) as Anchor,
        toHeading: visibleTarget === undefined,
        color: connectionColor(pointer.from, pointer.to),
      };
    })
    .filter((one): one is Routed => one !== null);

  // Every arrow is given a lane before any of them is drawn: one down the
  // outside of its own column when both ends are in it, and one down the space
  // between the columns when it crosses. Lanes are reused once an arrow's
  // vertical run has ended, so adding an unrelated pointer further down the
  // table does not make the whole canvas wider.
  const leftLanes = allocateLanes(
    routed,
    (one) => one.fromAnchor.side === 0 && one.toAnchor.side === 0
  );
  const rightLanes = allocateLanes(
    routed,
    (one) => one.fromAnchor.side === 1 && one.toAnchor.side === 1
  );
  const crossing = allocateLanes(
    routed,
    (one) => one.fromAnchor.side !== one.toAnchor.side
  );
  const lanes = [leftLanes.count, rightLanes.count];
  const laneOf = routed.map((one, index) =>
    one.fromAnchor.side === 0
      ? leftLanes.laneOf[index]
      : rightLanes.laneOf[index]
  );
  const crossingLaneOf = crossing.laneOf;
  const crossings = crossing.count;
  // The left column's gutter is taken out of the margin the map starts at, so
  // the whole map moves right by whatever the margin does not already cover.
  const shift = Math.max(0, gutterWidth(lanes[0]) - ORIGIN_X);
  // The crossings need more room between the columns than two nodes do, and
  // only the right-hand column moves to give it to them.
  const widen = crossingGap(crossings) - COLUMN_GAP_X;
  const shiftOf = [shift, shift + widen];
  columnX[0] += shiftOf[0];
  columnX[1] += shiftOf[1];
  for (const segment of segments) {
    segment.x += shiftOf[sideOf(segment.key)];
    for (const row of segment.rows) {
      for (const cell of row.cells) {
        // Cell coordinates are absolute, so that an arrow can be routed
        // between two segments; the offsets they were built from are not.
        cell.x += segment.x;
      }
    }
  }
  for (const anchor of cellAnchor.values()) {
    anchor.left += shiftOf[anchor.side];
    anchor.right += shiftOf[anchor.side];
  }
  /** Where the crossing in this lane runs, between the two columns. */
  const crossingX = (lane: number): number =>
    columnX[0] + nodeWidth + GUTTER_EDGE_X + lane * GUTTER_LANE_X;

  const arrows = routed.map((one, index) => {
    const { fromCell, toCell, fromAnchor, toAnchor, toHeading, color } = one;
    fromCell.colors.push(color);
    toCell.colors.push(color);
    const lane = laneOf[index];
    if (lane === -1) {
      // The two columns face each other, so the line leaves and arrives on the
      // sides that do, and runs down the space between them on the way - the
      // same three strokes as a pointer within one column, laid in the gap
      // rather than in the gutter. A pointer that goes right to left is the
      // one this matters to: read as a straight line it would be drawn back
      // through the node it started in.
      const rightwards = fromAnchor.side < toAnchor.side;
      return pointerArrow(
        fromCell,
        fromAnchor,
        toCell,
        toAnchor,
        color,
        rightwards ? 'right' : 'left',
        rightwards ? 'left' : 'right',
        crossingX(crossingLaneOf[index]),
        toHeading
      );
    }
    // Down the outside of its own column, where the pointers crossing between
    // the columns are not, and one lane further out for each arrow already
    // there.
    const side = OUTER_SIDE[fromAnchor.side];
    const reach = GUTTER_X + lane * GUTTER_LANE_X;
    return pointerArrow(
      fromCell,
      fromAnchor,
      toCell,
      toAnchor,
      color,
      side,
      side,
      side === 'left' ? fromAnchor.left - reach : fromAnchor.right + reach,
      toHeading
    );
  });

  return {
    segments,
    arrows,
    width: columnX[1] + nodeWidth + Math.max(ORIGIN_X, gutterWidth(lanes[1])),
    height: Math.max(bottoms[0], bottoms[1]) + ORIGIN_Y,
  };
}
