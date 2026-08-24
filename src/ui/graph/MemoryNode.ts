import { dia } from '@joint/core';
import {
  MEMORY_FOLD_WIDTH,
  MEMORY_FONT_SIZE,
  MEMORY_PADDING_X,
  MEMORY_TITLE_TOGGLE_WIDTH,
  MEMORY_WRAPPED_TITLE_HEIGHT,
  MemoryColumnKey,
  MemoryRowGeometry,
  MemorySegmentGeometry,
} from '../../core';
import strings from '../../strings';
import { gradient } from './StackTable';

/**
 * One memory segment, drawn as one node.
 *
 * The node is a titled box - the segment's name and the addresses it covers -
 * over a table of objects. An object is two bands: what it is written small
 * above what it is called and what it holds, with its address beside it. The
 * identifier is set in the reading font and the machine's own text - address
 * and value - in the monospace one, so that the two are told apart at a
 * glance.
 *
 * The title bar is also the segment's own fold: a click anywhere on it puts
 * the table away and leaves the bar, which still says what the segment is and
 * what it covers.
 *
 * Everything is placed by `layoutMemory`; this only turns those coordinates
 * into SVG.
 */
export const MemoryNode = dia.Element.define('plivet.MemoryNode');

const MONOSPACE = "Consolas, 'Courier New', monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const TITLE_FILL = 'var(--plivet-graph-title, #26384a)';
const TITLE_TEXT = 'var(--plivet-graph-title-text, #ffffff)';
const TITLE_ADDRESS = 'var(--plivet-graph-title-address, #a9c2da)';
const BORDER = 'var(--plivet-graph-border, #26384a)';
const GRID = 'var(--plivet-graph-grid, #cfd8e1)';
const HEADER_FILL = 'var(--plivet-graph-header, #eef2f6)';
const HEADER_TEXT = 'var(--plivet-graph-header-text, #4a5b6c)';
const CAPTION_FILL = 'var(--plivet-graph-caption, #f7f9fb)';
const CAPTION_TEXT = 'var(--plivet-graph-caption-text, #6b7b8c)';
const GROUP_FILL = 'var(--plivet-graph-group, #f5f8fb)';
const ADDRESS_FILL = 'var(--plivet-graph-address, #fbfcfd)';
const SURFACE = 'var(--plivet-graph-surface, #ffffff)';
const TEXT = 'var(--plivet-graph-ink, #111111)';
const MUTED = 'var(--plivet-graph-muted, #8494a4)';

/** The same pair the rows fold with, so one gesture reads as one gesture. */
const SEGMENT_OPEN = '▼';
const SEGMENT_CLOSED = '▲';

const COLUMN_TITLES: Record<MemoryColumnKey, string> = {
  address: strings.memoryColumnAddress,
  name: strings.memoryColumnName,
  value: strings.memoryColumnValue,
};

interface Part {
  markup: dia.MarkupJSON;
  attrs: dia.Cell.Selectors;
}

const push = (
  part: Part,
  tagName: 'rect' | 'text',
  selector: string,
  attrs: dia.attributes.SVGAttributes,
  attributes?: Record<string, string>
): void => {
  part.markup.push(
    typeof attributes === 'undefined'
      ? { tagName, selector }
      : { tagName, selector, attributes }
  );
  part.attrs[selector] = attrs;
};

/**
 * A frame heading, or the line an empty segment shows instead of rows.
 *
 * A heading is the frame's own fold, and the whole band takes the click the
 * way a segment's title bar does: the triangle says which way it will go, and
 * a reader aiming at a frame is aiming at its name.
 */
function labelRow(
  part: Part,
  segment: MemorySegmentGeometry,
  row: MemoryRowGeometry,
  index: number
): void {
  const isGroup = row.kind === 'group';
  const fold = isGroup ? row.fold : undefined;
  const marks =
    typeof fold === 'undefined'
      ? undefined
      : {
          'data-frame-target': encodeURIComponent(fold.target),
          class: 'plivet-fold-cell',
        };
  push(
    part,
    'rect',
    `row-${index}-body`,
    {
      x: 0,
      y: row.y,
      width: segment.width,
      height: row.height,
      fill: isGroup ? GROUP_FILL : SURFACE,
      stroke: GRID,
      strokeWidth: 1,
    },
    marks
  );
  if (typeof fold !== 'undefined') {
    push(part, 'text', `row-${index}-fold`, {
      x: fold.x + fold.width / 2,
      y: row.y + row.height / 2,
      text: fold.text,
      fill: HEADER_TEXT,
      fontFamily: SANS,
      fontSize: MEMORY_FONT_SIZE - 4,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      // The band under it takes the click, so the whole band is one target.
      pointerEvents: 'none',
    });
  }
  push(part, 'text', `row-${index}-label`, {
    x: isGroup
      ? MEMORY_PADDING_X +
        (typeof fold === 'undefined' ? 0 : fold.x + fold.width)
      : segment.width / 2,
    y: row.y + row.height / 2,
    text: isGroup ? `${row.label}` : strings.memoryEmptySegment,
    fill: isGroup ? HEADER_TEXT : MUTED,
    fontFamily: SANS,
    fontSize: MEMORY_FONT_SIZE - 1,
    fontWeight: isGroup ? 'bold' : 'normal',
    fontStyle: isGroup ? 'normal' : 'italic',
    textAnchor: isGroup ? 'start' : 'middle',
    dominantBaseline: 'central',
    pointerEvents: 'none',
  });
}

/** One object: its address, its caption, its identifier and its value. */
function entryRow(
  part: Part,
  segment: MemorySegmentGeometry,
  row: MemoryRowGeometry,
  index: number
): void {
  const bandY = row.y + row.bandY;
  const bandMiddle = bandY + row.bandHeight / 2;
  // The row says which object it draws, so that pointing at the variable in
  // the editor can light this row up and pointing at this row can mark the
  // declaration. The attribute is on the boxes rather than the text because
  // the text does not take pointer events.
  const marks =
    typeof row.object === 'undefined'
      ? undefined
      : {
          'data-object-key': encodeURIComponent(row.object),
          class: 'plivet-object-cell plivet-identifier',
        };

  if (typeof row.caption !== 'undefined') {
    const { caption } = row;
    push(
      part,
      'rect',
      `caption-${index}-body`,
      {
        x: caption.x,
        y: row.y,
        width: caption.width,
        height: caption.height,
        fill: CAPTION_FILL,
        stroke: GRID,
        strokeWidth: 1,
      },
      marks
    );
    push(part, 'text', `caption-${index}-text`, {
      x: caption.x + MEMORY_PADDING_X + row.indent,
      y: row.y + caption.height / 2,
      text: caption.text,
      fill: CAPTION_TEXT,
      fontFamily: MONOSPACE,
      fontSize: MEMORY_FONT_SIZE - 3,
      textAnchor: 'start',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    });
  }

  row.cells.forEach((cell, position) => {
    const column = segment.columns[position];
    const isAddress = column.key === 'address';
    const isValue = column.key === 'value';
    // An aggregate advertises its disclosure beside its name, so its complete
    // name band is the target. Requiring the pointer to land on the 16-pixel
    // triangle made ordinary clicks look ignored, especially after scaling.
    const cellMarks =
      column.key === 'name' && typeof row.fold !== 'undefined'
        ? {
            ...marks,
            'data-fold-target': encodeURIComponent(row.fold.target),
            class: `${marks?.class ?? ''} plivet-fold-cell`.trim(),
          }
        : marks;
    // The address belongs to the whole object, so its cell spans both bands.
    push(
      part,
      'rect',
      `cell-${index}-${position}-body`,
      {
        x: column.x,
        y: isAddress ? row.y : bandY,
        width: column.width,
        height: isAddress ? row.height : row.bandHeight,
        ...(typeof cell.tooltip === 'undefined' ? {} : { title: cell.tooltip }),
        fill:
          cell.colors.length === 0 && isAddress
            ? ADDRESS_FILL
            : gradient(cell.colors),
        stroke: GRID,
        strokeWidth: 1,
      },
      cellMarks
    );
    push(
      part,
      'text',
      `cell-${index}-${position}-text`,
      {
        // A name keeps a gutter for the fold triangle and one step of
        // indentation per level of nesting, so a member sits under the
        // aggregate holding it. A value ends the row, where its arrow leaves.
        x: isValue
          ? column.x + column.width - MEMORY_PADDING_X
          : column.x +
            MEMORY_PADDING_X +
            (column.key === 'name' ? row.indent + MEMORY_FOLD_WIDTH : 0),
        y: bandMiddle,
        text: cell.text,
        fill: isAddress ? HEADER_TEXT : TEXT,
        fontFamily: column.key === 'name' ? SANS : MONOSPACE,
        fontSize: MEMORY_FONT_SIZE,
        textAnchor: isValue ? 'end' : 'start',
        dominantBaseline: 'central',
        pointerEvents: 'none',
      },
      cellMarks
    );
  });

  if (typeof row.fold === 'undefined') {
    return;
  }
  const { fold } = row;
  const attributes = {
    'data-fold-target': encodeURIComponent(fold.target),
    class: 'plivet-fold-cell',
  };
  push(
    part,
    'rect',
    `fold-${index}-body`,
    {
      x: fold.x,
      y: bandY,
      width: fold.width,
      height: row.bandHeight,
      fill: SURFACE,
      fillOpacity: 0,
      stroke: 'none',
    },
    attributes
  );
  push(
    part,
    'text',
    `fold-${index}-text`,
    {
      x: fold.x + fold.width / 2,
      y: bandMiddle,
      text: fold.text,
      fill: HEADER_TEXT,
      fontFamily: SANS,
      fontSize: MEMORY_FONT_SIZE - 3,
      textAnchor: 'middle',
      dominantBaseline: 'central',
    },
    attributes
  );
}

const node = (segment: MemorySegmentGeometry, part: Part): dia.Element =>
  new MemoryNode({
    position: { x: segment.x, y: segment.y },
    size: { width: segment.width, height: segment.height },
    markup: part.markup,
    attrs: part.attrs,
    z: 1,
  });

export function memoryNodeOf(
  segment: MemorySegmentGeometry,
  options: { collapsible?: boolean; title?: boolean } = {}
): dia.Element {
  const collapsible = options.collapsible !== false;
  const titled = options.title !== false;
  if (!titled) {
    const titleHeight = segment.titleHeight;
    segment = {
      ...segment,
      height: segment.height - titleHeight,
      titleHeight: 0,
      rows: segment.rows.map((row) => ({
        ...row,
        y: row.y - titleHeight,
      })),
    };
  }
  const part: Part = { markup: [], attrs: {} };
  const wrappedTitle = segment.titleHeight >= MEMORY_WRAPPED_TITLE_HEIGHT;
  const titleTextY = wrappedTitle ? 16 : segment.titleHeight / 2;
  const titleAddressY = wrappedTitle ? 38 : segment.titleHeight / 2;

  push(part, 'rect', 'body', {
    x: 0,
    y: 0,
    width: segment.width,
    height: segment.height,
    fill: SURFACE,
    stroke: BORDER,
    strokeWidth: 1.5,
    rx: 6,
    ry: 6,
  });
  const collapse =
    collapsible && titled
      ? {
          'data-collapse-target': segment.key,
          class: 'plivet-collapse-cell',
        }
      : undefined;
  if (titled) {
    push(
      part,
      'rect',
      'titleBody',
      {
        x: 0,
        y: 0,
        width: segment.width,
        height: segment.titleHeight,
        fill: TITLE_FILL,
        stroke: 'none',
        rx: 6,
        ry: 6,
      },
      collapse
    );
    // The title bar is rounded at the top and square where the table begins; a
    // second rect squares off its lower half without a clip path. A collapsed
    // segment is nothing but the bar, so it keeps all four corners.
    if (!segment.collapsed) {
      push(
        part,
        'rect',
        'titleFoot',
        {
          x: 0,
          y: segment.titleHeight / 2,
          width: segment.width,
          height: segment.titleHeight / 2,
          fill: TITLE_FILL,
          stroke: 'none',
        },
        collapse
      );
    }
    push(part, 'text', 'titleToggle', {
      x: MEMORY_PADDING_X + 4 + MEMORY_TITLE_TOGGLE_WIDTH / 2,
      y: titleTextY,
      text: collapsible
        ? segment.collapsed
          ? SEGMENT_CLOSED
          : SEGMENT_OPEN
        : '',
      fill: TITLE_ADDRESS,
      fontFamily: SANS,
      fontSize: MEMORY_FONT_SIZE - 3,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      // The bar under it takes the click, so the whole bar is one target.
      pointerEvents: 'none',
    });
    push(part, 'text', 'titleText', {
      x: MEMORY_PADDING_X + 4 + MEMORY_TITLE_TOGGLE_WIDTH,
      y: titleTextY,
      text: segment.name,
      fill: TITLE_TEXT,
      fontFamily: SANS,
      fontSize: MEMORY_FONT_SIZE + 1,
      fontWeight: 'bold',
      textAnchor: 'start',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    });
    push(part, 'text', 'titleAddress', {
      x: segment.width - MEMORY_PADDING_X - 4,
      y: titleAddressY,
      text: segment.addressLabel,
      fill: TITLE_ADDRESS,
      fontFamily: MONOSPACE,
      fontSize: MEMORY_FONT_SIZE,
      textAnchor: 'end',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    });
  }
  if (segment.collapsed) {
    return node(segment, part);
  }

  push(part, 'rect', 'headerBody', {
    x: 0,
    y: segment.titleHeight,
    width: segment.width,
    height: segment.columnHeaderHeight,
    fill: HEADER_FILL,
    stroke: GRID,
    strokeWidth: 1,
  });

  segment.columns.forEach((column, index) => {
    push(part, 'text', `header-${index}`, {
      x: column.x + MEMORY_PADDING_X,
      y: segment.titleHeight + segment.columnHeaderHeight / 2,
      text: COLUMN_TITLES[column.key],
      fill: HEADER_TEXT,
      fontFamily: SANS,
      fontSize: MEMORY_FONT_SIZE - 2,
      fontWeight: 'bold',
      letterSpacing: 0.5,
      textAnchor: 'start',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    });
  });

  segment.rows.forEach((row, index) =>
    row.kind === 'entry'
      ? entryRow(part, segment, row, index)
      : labelRow(part, segment, row, index)
  );

  return node(segment, part);
}
