import { dia, shapes } from '@joint/core';
import { MutationModel } from '../../core';
import strings from '../../strings';

/** The fixed columns used by the write-history table. */
const COLUMN_WIDTHS = [220, 220, 220, 220, 104] as const;
const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 28;
const FONT = 'system-ui, sans-serif';
const CODE_FONT = "Consolas, 'Courier New', monospace";

const leftLabel = (height: number) => ({
  x: 10,
  y: height / 2,
  textAnchor: 'start' as const,
  textVerticalAnchor: 'middle' as const,
});

const cell = (
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  header: boolean,
  code: boolean
): dia.Element => {
  const element = new shapes.standard.Rectangle({ z: 4 });
  element.position(x, y);
  element.resize(width, height);
  element.attr({
    body: {
      fill: header
        ? 'var(--plivet-graph-header, #eef2f6)'
        : 'var(--plivet-graph-surface, #ffffff)',
      stroke: 'var(--plivet-graph-grid, #cfd8e1)',
    },
    label: {
      text,
      fill: header
        ? 'var(--plivet-graph-header-text, #4a5b6c)'
        : 'var(--plivet-graph-ink, #26384a)',
      fontFamily: code ? CODE_FONT : FONT,
      fontSize: 12,
      fontWeight: header ? 'bold' : 'normal',
      ...leftLabel(height),
      textWrap: { width: -20, height: -8 },
    },
  });
  return element;
};

/** Draw the write history as the same JointJS table style as Variables. */
export function mutationTableCells(
  mutations: MutationModel[],
  originX: number,
  originY: number,
  tableWidth: number = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)
): { cells: dia.Cell[]; height: number; width: number } {
  const baseWidth = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
  const widths = COLUMN_WIDTHS.map((width) => (width / baseWidth) * tableWidth);
  const headings = [
    strings.viewColumnFrame,
    strings.viewColumnObject,
    strings.viewColumnBefore,
    strings.viewColumnAfter,
    strings.viewColumnLine,
  ];
  const cells: dia.Cell[] = [];
  let x = originX;
  headings.forEach((heading, index) => {
    const width = widths[index];
    cells.push(cell(heading, x, originY, width, HEADER_HEIGHT, true, false));
    x += width;
  });

  const rows = mutations.slice().reverse();
  if (rows.length === 0) {
    cells.push(
      cell(
        strings.viewNothingWritten,
        originX,
        originY + HEADER_HEIGHT,
        tableWidth,
        ROW_HEIGHT,
        false,
        false
      )
    );
  } else {
    rows.forEach((mutation, rowIndex) => {
      const values = [
        mutation.frame,
        mutation.target,
        mutation.before,
        mutation.after,
        String(mutation.line),
      ];
      let rowX = originX;
      values.forEach((value, index) => {
        const width = widths[index];
        cells.push(
          cell(
            value,
            rowX,
            originY + HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
            width,
            ROW_HEIGHT,
            false,
            index > 0
          )
        );
        rowX += width;
      });
    });
  }

  return {
    cells,
    height: HEADER_HEIGHT + Math.max(1, rows.length) * ROW_HEIGHT,
    width: tableWidth,
  };
}
