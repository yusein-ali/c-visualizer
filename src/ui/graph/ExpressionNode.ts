import { dia } from '@joint/core';
import strings from '../../strings';
import { expressionNodeLabel } from './expressionLabel';
import { ExpressionNodeGeometry } from './expressionLayout';

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
      : 'var(--plivet-graph-expression-operand, #f4f4f4)';

/** Turn one laid-out expression into its two-part SVG card. */
export function expressionNodeOf(
  geometry: ExpressionNodeGeometry
): dia.Element {
  const { node, x, y, width, height } = geometry;
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
      stroke: BORDER,
      strokeWidth: node.kind === 'operand' ? 1 : 2,
      rx: 5,
      ry: 5,
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
