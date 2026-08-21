import { dia } from '@joint/core';
import { CELL_FONT_SIZE, CELL_HEIGHT, StackGeometry } from '../../core';

const FONT = "Consolas, 'Courier New', monospace";

/** A JointJS element whose SVG markup is one complete stack/memory table. */
export const StackTable = dia.Element.define('plivet.StackTable');

/**
 * The horizontal wash that says an arrow starts or ends in this cell. Shared
 * with the memory nodes: a pointer looks the same wherever it is drawn.
 */
export const gradient = (colors: string[]): dia.SVGGradientJSON => ({
  type: 'linearGradient',
  attrs: { x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
  stops:
    colors.length === 0
      ? [
          { offset: '0%', color: '#ffffff', opacity: 0 },
          { offset: '100%', color: '#ffffff', opacity: 0 },
        ]
      : (colors.length === 1 ? [colors[0], colors[0]] : colors).map(
          (color, index, all) => ({
            offset: `${(index / (all.length - 1)) * 100}%`,
            color,
            opacity: 0.27,
          })
        ),
});

export function stackTableOf(stack: StackGeometry): dia.Element {
  const markup: dia.MarkupJSON = [
    { tagName: 'rect', selector: 'headerBody' },
    { tagName: 'text', selector: 'headerText' },
  ];
  const attrs: dia.Cell.Selectors = {
    headerBody: {
      x: 0,
      y: 0,
      width: stack.width,
      height: CELL_HEIGHT,
      fill: 'var(--plivet-graph-stack-header, #f3f5f7)',
      stroke: 'var(--plivet-graph-stack-border, #000000)',
      strokeWidth: 1,
    },
    headerText: {
      x: stack.width / 2,
      y: CELL_HEIGHT / 2,
      text: stack.name,
      fill: 'var(--plivet-graph-ink, #111111)',
      fontFamily: FONT,
      fontSize: CELL_FONT_SIZE,
      fontWeight: 'bold',
      textAnchor: 'middle',
      dominantBaseline: 'central',
    },
  };

  stack.rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const selector = `cell-${rowIndex}-${columnIndex}`;
      const body = `${selector}-body`;
      const text = `${selector}-text`;
      const x = cell.x - stack.x;
      const y = cell.y - stack.y;
      const foldAttributes =
        typeof cell.foldTarget === 'undefined'
          ? {}
          : {
              'data-fold-target': encodeURIComponent(cell.foldTarget),
              class: 'plivet-fold-cell',
            };
      markup.push(
        {
          tagName: 'rect',
          selector: body,
          attributes: foldAttributes,
        },
        {
          tagName: 'text',
          selector: text,
          attributes: foldAttributes,
        }
      );
      attrs[body] = {
        x,
        y,
        width: cell.width,
        height: cell.height,
        fill: gradient(cell.colors),
        stroke: 'var(--plivet-graph-stack-border, #000000)',
        strokeWidth: 1,
      };
      attrs[text] = {
        x:
          typeof cell.foldTarget === 'undefined'
            ? x + CELL_FONT_SIZE / 2
            : x + cell.width / 2,
        y: y + cell.height / 2,
        text: cell.text,
        fill: 'var(--plivet-graph-ink, #111111)',
        fontFamily: FONT,
        fontSize: CELL_FONT_SIZE,
        textAnchor: typeof cell.foldTarget === 'undefined' ? 'start' : 'middle',
        dominantBaseline: 'central',
        pointerEvents: typeof cell.foldTarget === 'undefined' ? 'none' : 'auto',
      };
    });
  });

  return new StackTable({
    position: { x: stack.x, y: stack.y },
    size: { width: stack.width, height: stack.height },
    markup,
    attrs,
    z: 1,
  });
}
