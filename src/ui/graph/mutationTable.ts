import { dia, shapes } from '@joint/core';
import { FoldState, MutationModel } from '../../core';
import strings from '../../strings';

/** The fixed columns used by the write-history table. */
const GROUP_HEIGHT = 30;
const DETAIL_HEIGHT = 30;
const DETAIL_GAP = 4;
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

const rootOf = (target: string): string =>
  /^([A-Za-z_][A-Za-z0-9_]*)/.exec(target)?.[1] ?? target;

/** Draw write history as vertical, collapsible object groups. */
export function mutationTableCells(
  mutations: MutationModel[],
  originX: number,
  originY: number,
  tableWidth: number,
  folds: FoldState
): { cells: dia.Cell[]; height: number; width: number } {
  const cells: dia.Cell[] = [];
  const groups = new Map<string, MutationModel[]>();
  for (const mutation of mutations.slice().reverse()) {
    const root = rootOf(mutation.target);
    const group = groups.get(root) ?? [];
    group.push(mutation);
    groups.set(root, group);
  }
  let y = originY;
  if (groups.size === 0) {
    cells.push(
      cell(
        strings.viewNothingWritten,
        originX,
        y,
        tableWidth,
        DETAIL_HEIGHT,
        false,
        false
      )
    );
    y += DETAIL_HEIGHT;
  } else {
    for (const [root, entries] of groups) {
      const key = `mutation-${root}`;
      const folded = folds.isFolded(key);
      const heading = cell(
        `${folded ? '▶' : '▼'}  ${root}`,
        originX,
        y,
        tableWidth,
        GROUP_HEIGHT,
        true,
        false
      );
      heading.attr({
        body: {
          'data-fold-target': encodeURIComponent(key),
          class: 'plivet-fold-cell',
        },
        label: {
          'data-fold-target': encodeURIComponent(key),
          class: 'plivet-fold-cell',
        },
      });
      cells.push(heading);
      y += GROUP_HEIGHT;
      if (folded) {
        continue;
      }
      for (const mutation of entries) {
        const detail = cell(
          `${mutation.target}   ${mutation.before} → ${mutation.after}   ` +
            `${mutation.frame} · line ${mutation.line}`,
          originX + 18,
          y,
          tableWidth - 18,
          DETAIL_HEIGHT,
          false,
          true
        );
        detail.attr({
          body: {
            'data-object-key': encodeURIComponent(root),
            class: 'plivet-object-cell plivet-variable-cell plivet-identifier',
          },
        });
        cells.push(detail);
        y += DETAIL_HEIGHT + DETAIL_GAP;
      }
    }
  }

  return {
    cells,
    height: y - originY,
    width: tableWidth,
  };
}
