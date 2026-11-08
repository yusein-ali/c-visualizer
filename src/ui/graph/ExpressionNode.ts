import { dia, shapes } from '@joint/core';
import strings from '../../strings';
import { expressionNodeLabel } from './expressionLabel';
import {
  CONVERSION_FONT_SIZE,
  ExpressionGeometry,
  ExpressionNodeGeometry,
} from './expressionLayout';

/** A JointJS element that keeps an expression and its current value distinct. */
export const ExpressionNode = dia.Element.define('plivet.ExpressionNode');

const MONOSPACE = "Consolas, 'Courier New', monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const TEXT = 'var(--plivet-graph-ink, #111111)';
const MUTED = 'var(--plivet-graph-expression-value-label, #5d6b78)';
const BORDER = 'var(--plivet-graph-expression-border, #202020)';
const FACT_FILL = 'var(--plivet-graph-expression-value, #ffffff)';
const FACT_BORDER = 'var(--plivet-graph-expression-value-border, #b8c4cf)';
const FACT_HEIGHT = 18;
const FACT_INSET_X = 6;
const FACT_INSET_BOTTOM = 5;
const FACT_CONTENT_INSET_X = 6;
const FACT_TEXT_GAP = 6;
const FACT_CAPTION_WIDTH = 60;
const FACT_VALUE_CHARACTER_WIDTH = 7.2;
const CONVERSION_FILL = 'var(--plivet-graph-expression-conversion, #f3edff)';
const CONVERSION_BORDER =
  'var(--plivet-graph-expression-conversion-border, #7759c2)';
/** The node a host is stepping through, as `c-expression.js` is told. */
const HIGHLIGHT = 'var(--plivet-graph-focus-line, #d9a400)';
const LINK = 'var(--plivet-graph-expression-link, #5c6773)';
/**
 * How much of a dimmed node or link is drawn: an operand C never evaluates,
 * such as the right of `&&` when the left was false, stays readable but is
 * set back from the path the evaluation took.
 */
export const DIMMED_OPACITY = 0.35;

/**
 * Keep aggregate operands readable inside the narrow current-value strip.
 *
 * Variable values arrive as display text rather than runtime objects, so find
 * the first top-level comma instead of splitting blindly. That preserves a
 * nested first element and commas inside character or string literals.
 */
export const compactExpressionValue = (value: string): string => {
  const open = value.indexOf('[');
  if (open === -1 || !value.endsWith(']')) {
    return value;
  }

  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = open + 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      return `${value.slice(0, index)}, …]`;
    }
  }
  return value;
};

/**
 * Fit a current value beside its caption in the inset strip.
 *
 * Compacting an array at its first member is not sufficient when that member
 * is itself a long address or object description. In that case keep the
 * aggregate's brackets (and an optional type prefix such as `C`) rather than
 * allowing the value to run left through the caption.
 */
export const fitExpressionValue = (value: string, width: number): string => {
  const compact = compactExpressionValue(value);
  const room = Math.max(1, Math.floor(width / FACT_VALUE_CHARACTER_WIDTH));
  if (compact.length <= room) {
    return compact;
  }

  const open = compact.indexOf('[');
  if (open !== -1 && compact.endsWith(']')) {
    const prefix = compact.slice(0, open + 1);
    if (prefix.length + 2 <= room) {
      return `${prefix}…]`;
    }
  }
  return room === 1 ? '…' : `${compact.slice(0, room - 1)}…`;
};

const fillFor = (kind: ExpressionNodeGeometry['node']['kind']): string =>
  kind === 'assignment'
    ? 'var(--plivet-graph-expression-assignment, #fff0c2)'
    : kind === 'operator'
      ? 'var(--plivet-graph-expression-operator, #dcecff)'
      : kind === 'conversion'
        ? CONVERSION_FILL
        : 'var(--plivet-graph-expression-operand, #f4f4f4)';

/** What hovering a box says: the source text and, where known, its type. */
const titleOf = (node: ExpressionNodeGeometry['node']): string =>
  typeof node.type === 'undefined'
    ? node.text
    : `${node.text}\n${strings.expressionType}: ${node.type}`;

/**
 * Turn one laid-out expression into its two-part SVG card. `highlighted`
 * outlines the one a host is stepping through; the canvas never sets it.
 */
export function expressionNodeOf(
  geometry: ExpressionNodeGeometry,
  highlighted = false
): dia.Element {
  const { node, x, y, width, height } = geometry;
  if (node.kind === 'conversion') {
    return conversionNodeOf(geometry, highlighted);
  }
  // A literal already says its own value (`0`, for example), so repeating it
  // in a Current value strip adds noise. Names and evaluated operators still
  // need the strip because their source text and runtime result differ.
  const value =
    node.kind === 'assignment' || node.value === node.text ? null : node.value;
  const valueTextWidth = Math.max(
    FACT_VALUE_CHARACTER_WIDTH,
    width -
      2 * (FACT_INSET_X + FACT_CONTENT_INSET_X) -
      FACT_CAPTION_WIDTH -
      FACT_TEXT_GAP
  );
  const visibleValue =
    value === null ? null : fitExpressionValue(value, valueTextWidth);
  const valueY = height - FACT_INSET_BOTTOM - FACT_HEIGHT;
  const labelAreaHeight = value === null ? height : valueY;
  const markup: dia.MarkupJSON = [
    { tagName: 'rect', selector: 'body' },
    { tagName: 'text', selector: 'label' },
  ];
  const attrs: dia.Cell.Selectors = {
    body: {
      x: 0,
      y: 0,
      width,
      height,
      fill: fillFor(node.kind),
      stroke: highlighted ? HIGHLIGHT : BORDER,
      strokeWidth: highlighted ? 3 : node.kind === 'operand' ? 1 : 2,
      rx: 5,
      ry: 5,
      title: titleOf(node),
    },
    label: {
      x: width / 2,
      y: labelAreaHeight / 2,
      text: expressionNodeLabel(node),
      fill: TEXT,
      fontFamily: MONOSPACE,
      fontSize: 13,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      textWrap: {
        width: width - 12,
        height: labelAreaHeight - 6,
        ellipsis: true,
      },
    },
  };

  if (value !== null) {
    markup.push(
      { tagName: 'rect', selector: 'valueBody' },
      { tagName: 'text', selector: 'valueCaption' },
      { tagName: 'text', selector: 'valueText' }
    );
    attrs.valueBody = {
      x: FACT_INSET_X,
      y: valueY,
      width: width - FACT_INSET_X * 2,
      height: FACT_HEIGHT,
      title: value,
      fill: FACT_FILL,
      stroke: FACT_BORDER,
      strokeWidth: 1,
      rx: 3,
      ry: 3,
    };
    attrs.valueCaption = {
      x: FACT_INSET_X + FACT_CONTENT_INSET_X,
      y: valueY + FACT_HEIGHT / 2,
      text: strings.expressionCurrentValue,
      fill: MUTED,
      fontFamily: SANS,
      fontSize: 9,
      fontWeight: 600,
      textAnchor: 'start',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    };
    attrs.valueText = {
      x: width - FACT_INSET_X - FACT_CONTENT_INSET_X,
      y: valueY + FACT_HEIGHT / 2,
      text: visibleValue,
      fill: TEXT,
      fontFamily: MONOSPACE,
      fontSize: 12,
      fontWeight: 'bold',
      textAnchor: 'end',
      dominantBaseline: 'central',
      pointerEvents: 'none',
      textWrap: {
        width: valueTextWidth,
        height: FACT_HEIGHT - 2,
        ellipsis: true,
      },
    };
  }

  return new ExpressionNode({
    position: { x, y },
    size: { width, height },
    markup,
    attrs,
    z: 4,
  });
}

/**
 * An implicit conversion: a pill on the edge between an operator and the
 * operand it converts, dashed because nothing in the source wrote it. The
 * types are on top and the converted value, once there is one, below them.
 */
function conversionNodeOf(
  geometry: ExpressionNodeGeometry,
  highlighted: boolean
): dia.Element {
  const { node, x, y, width, height } = geometry;
  const value = node.value;
  const inner = width - 12;
  const title =
    `${strings.expressionConversion}: ${node.text}` +
    (value === null ? '' : `\n${strings.expressionCurrentValue}: ${value}`);
  const markup: dia.MarkupJSON = [
    { tagName: 'rect', selector: 'body' },
    { tagName: 'text', selector: 'label' },
  ];
  const attrs: dia.Cell.Selectors = {
    body: {
      x: 0,
      y: 0,
      width,
      height,
      fill: CONVERSION_FILL,
      stroke: highlighted ? HIGHLIGHT : CONVERSION_BORDER,
      strokeWidth: highlighted ? 3 : 1.5,
      strokeDasharray: highlighted ? 'none' : '4 3',
      rx: 9,
      ry: 9,
      title,
    },
    label: {
      x: width / 2,
      y: value === null ? height / 2 : height / 2 - 7,
      text: node.text,
      fill: TEXT,
      fontFamily: MONOSPACE,
      fontSize: CONVERSION_FONT_SIZE,
      textAnchor: 'middle',
      dominantBaseline: 'central',
      pointerEvents: 'none',
      textWrap: { width: inner, height: 14, ellipsis: true },
    },
  };
  if (value !== null) {
    markup.push({ tagName: 'text', selector: 'valueText' });
    attrs.valueText = {
      x: width / 2,
      y: height / 2 + 8,
      text: fitExpressionValue(value, inner),
      fill: TEXT,
      fontFamily: MONOSPACE,
      fontSize: 11,
      fontWeight: 'bold',
      textAnchor: 'middle',
      dominantBaseline: 'central',
      pointerEvents: 'none',
    };
  }
  return new ExpressionNode({
    position: { x, y },
    size: { width, height },
    markup,
    attrs,
    z: 4,
  });
}

/**
 * Every cell of a laid-out tree: the boxes, the conversion pills and the
 * links between them. The canvas and `c-expression.js` both draw a tree with
 * this, so the two are drawn alike. `dimmed` holds the keys of nodes drawn
 * set back (`DIMMED_OPACITY`), and a link into one of them is dimmed with it;
 * the canvas never sets it.
 */
export function expressionCells(
  geometry: ExpressionGeometry,
  highlight: ReadonlySet<string> = new Set(),
  dimmed: ReadonlySet<string> = new Set()
): dia.Cell[] {
  const cells: dia.Cell[] = geometry.nodes.map((placed) => {
    const element = expressionNodeOf(placed, highlight.has(placed.node.key));
    if (dimmed.has(placed.node.key)) {
      element.attr('root/opacity', DIMMED_OPACITY);
    }
    return element;
  });
  for (const connected of geometry.links) {
    const link = new shapes.standard.Link({ z: 3 });
    link.source(connected.source);
    link.target(connected.target);
    if (connected.vertices.length !== 0) {
      link.vertices(connected.vertices);
    }
    link.connector('rounded', { radius: 5 });
    link.attr({
      line: {
        stroke: LINK,
        strokeWidth: 1.5,
        targetMarker: { type: 'none' },
      },
    });
    if (dimmed.has(connected.child)) {
      link.attr('root/opacity', DIMMED_OPACITY);
    }
    cells.push(link);
  }
  return cells;
}
