import { dia, shapes } from '@joint/core';
import {
  ArrowGeometry,
  CallExpansionModel,
  Geometry,
  MemoryGeometry,
  MemoryRegion,
  ExpressionModel,
  FoldState,
  Point,
  StepModel,
  ViewOptions,
  ViewSelection,
  emptyStepModel,
} from '../../core';
import strings from '../../strings';
import { IconName, iconFor } from '../controls/icons';
import { MutationView } from '../views';
import { graphGeometry, memoryGeometry } from './geometry';
import { expressionGeometry } from './expressionLayout';
import { expressionNodeOf } from './ExpressionNode';
import { ViewPanelHandle, viewPanel } from './ViewPanel';
import { callStackRows } from './callStack';
import { callHeading } from './callSection';
import { variableContextLabel, variableTableRows } from './variableTable';
import { emptyStatementExplanation, StatementExplanation } from '../records';
import { MemoryNode, memoryNodeOf } from './MemoryNode';
import { StackTable, stackTableOf } from './StackTable';
import {
  statementCard,
  StatementCardModel,
  StatementCardRow,
} from './statementCard';
import './graph.css';

export interface PlivetGraphOptions {
  model?: StepModel;
  explanation?: StatementExplanation;
  dark?: boolean;
  /**
   * What the canvas opens with drawn, for a caller with an opinion: a page
   * teaching the stack can arrive without the expression tree in the way. It
   * is the state the View panel writes, so the reader can still switch back
   * anything the page switched off.
   */
  views?: ViewSelection;
  /**
   * The object the pointer is over, and null when it leaves. The canvas says
   * which object rather than which cell: a row is what a reader points at,
   * and what the editor can mark the declaration of.
   */
  onFocus?: (object: string | null) => void;
  /** Follow a variable or memory row back to its source declaration. */
  onNavigate?: (target: MemoryNavigationTarget) => void;
}

/** What a double-clicked variable or memory row names in the source. */
export type MemoryNavigationTarget =
  | { kind: 'object'; key: string }
  | { kind: 'function'; name: string };

/** Functions share the row-key mechanism with objects, but name definitions. */
export const memoryNavigationTarget = (
  model: StepModel,
  key: string
): MemoryNavigationTarget => {
  const fn = model.functions.find(
    (candidate) => `text-${candidate.name}` === key
  );
  return typeof fn === 'undefined'
    ? { kind: 'object', key }
    : { kind: 'function', name: fn.name };
};

/** The class the focused object's boxes are painted through. */
const FOCUS_CLASS = 'plivet-object--focus';

/**
 * The canvas is read from cause to state. Statement and Call stack share its
 * first row; Expression expansion spans both columns beneath them, Variables
 * bridges the source expression and the complete Memory map, and the write
 * history is the final DOM section under the paper. Each major section has one
 * disclosure heading and one switch in the shared View panel.
 */
const HEADING_HEIGHT = 26;
/** The room between a heading and the section it names. */
const HEADING_GAP = 10;
const CARD_TITLE_HEIGHT = 38;
const CARD_CONTEXT_HEIGHT = 28;
const CARD_DESCRIPTION_HEIGHT = 58;
const CARD_ROW_HEIGHT = 38;
const CARD_SECTION_HEIGHT = 28;
const CARD_LABEL_WIDTH = 164;
/** The room between successive canvas sections. */
const SECTION_GAP = 36;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = 480;
const TWO_COLUMN_WIDTH = COLUMN_WIDTH * 2 + COLUMN_GAP;
/** Where the drawing starts, which is where `layoutMemory` puts the map. */
const ORIGIN_X = 24;
const ORIGIN_Y = 24;
/** What the map has to come down by to leave its own heading room. */
const MEMORY_DROP = HEADING_HEIGHT + HEADING_GAP;
const CALL_ROW_GAP = 5;
const VARIABLE_CONTEXT_HEIGHT = 30;
const VARIABLE_HEADER_HEIGHT = 28;
const VARIABLE_ROW_HEIGHT = 34;
const VARIABLE_COLUMN_WIDTHS = [220, 250, 90, 300, 124] as const;

/** JointJS rectangles center labels unless both axes are overridden. */
export const leftAlignedLabel = (x: number, height: number) => ({
  x,
  y: height / 2,
  textAnchor: 'start' as const,
  textVerticalAnchor: 'middle' as const,
});

/** Height for wrapped text, respecting lines that carry separate facts. */
export const wrappedTextHeight = (
  text: string,
  width: number,
  minimum: number
): number => {
  const characters = Math.max(1, Math.floor((width - 20) / 7.2));
  const renderedLines = text
    .split('\n')
    .reduce(
      (count, line) => count + Math.max(1, Math.ceil(line.length / characters)),
      0
    );
  return Math.max(minimum, renderedLines * 18 + 12);
};

/** An unavailable expression has no empty-state body to disclose. */
export const expressionSectionIsCollapsed = (
  expression: ExpressionModel | null,
  manuallyCollapsed: boolean
): boolean => expression === null || manuallyCollapsed;

/**
 * The disclosure bands on the canvas. The five fixed ones are the layout; the
 * `call:` keys are one per call expanded at the current step, and they carry
 * the call site's own key so a reader who collapses one keeps it collapsed
 * while the program runs rather than having it reopen under them every time
 * the step changes.
 */
type CanvasSection =
  | 'statement'
  | 'callStack'
  | 'expression'
  | 'variables'
  | 'memory'
  | `call:${string}`;

const isCanvasSection = (value: string): value is CanvasSection =>
  value === 'statement' ||
  value === 'callStack' ||
  value === 'expression' ||
  value === 'variables' ||
  value === 'memory' ||
  value.startsWith('call:');

const lowered = (point: Point, dy: number): Point => ({
  x: point.x,
  y: point.y + dy,
});

/**
 * The same drawing, further down the page.
 *
 * `layoutMemory` starts the map at a fixed origin and knows nothing about
 * headings, which is right: where a section's name goes is the canvas's
 * business. Rows and cells are placed against their own node, so only the
 * nodes and the arrows between them have to move.
 */
const loweredArrow = (arrow: ArrowGeometry, dy: number): ArrowGeometry => ({
  ...arrow,
  from: lowered(arrow.from, dy),
  mid: lowered(arrow.mid, dy),
  to: lowered(arrow.to, dy),
  vertices: arrow.vertices?.map((vertex) => lowered(vertex, dy)),
});

const loweredMemory = (memory: MemoryGeometry, dy: number): MemoryGeometry => ({
  ...memory,
  height: memory.height + dy,
  segments: memory.segments.map((segment) => ({
    ...segment,
    y: segment.y + dy,
  })),
  arrows: memory.arrows.map((arrow) => loweredArrow(arrow, dy)),
});

const loweredFrames = (frames: Geometry, dy: number): Geometry => ({
  stacks: frames.stacks.map((stack) => ({ ...stack, y: stack.y + dy })),
  arrows: frames.arrows.map((arrow) => loweredArrow(arrow, dy)),
});

const cellNamespace = {
  ...shapes,
  plivet: { MemoryNode, StackTable },
};

/** One isolated JointJS graph and paper for one PLIVET visualization. */
export class PlivetGraph {
  private readonly graph: dia.Graph;
  private readonly paper: dia.Paper;
  private readonly folds = new FoldState();
  private readonly view = new ViewOptions();
  private readonly panel: ViewPanelHandle;
  private readonly mutations: MutationView;
  private readonly collapsed = new Set<CanvasSection>();
  /** The window the drawing scrolls inside, below the bar. */
  private readonly viewport: HTMLDivElement;
  private readonly paperHost: HTMLDivElement;
  /** What the toolbar says the drawing is scaled to. */
  private readonly zoomLabel: HTMLSpanElement;
  private readonly resizeObserver: ResizeObserver | null;
  private model: StepModel;
  /**
   * What the statement under the marker is doing, in the records the tooltip
   * reads. It is kept beside the model for the same reason the model is: a
   * fold or a switch redraws the scene without a new step.
   */
  private explanation: StatementExplanation;
  /** The map as it is drawn now, so a click can act on what it sees. */
  private memory: MemoryGeometry = {
    segments: [],
    arrows: [],
    width: 0,
    height: 0,
  };
  private scale = 1;
  private contentWidth = 0;
  private contentHeight = 0;
  /**
   * The object lit up at the moment, if any. It is kept rather than only
   * painted, because every step rebuilds the scene: a reader holding the
   * pointer over a row while the program steps is still pointing at it.
   */
  private focused: string | null = null;
  /** The last object reported out, so one hover is one call. */
  private reported: string | null = null;
  private readonly onFocus?: (object: string | null) => void;
  private readonly onNavigate?: (target: MemoryNavigationTarget) => void;

  constructor(
    private readonly container: HTMLElement,
    options: PlivetGraphOptions = {}
  ) {
    this.model = options.model || emptyStepModel();
    this.explanation = options.explanation ?? emptyStatementExplanation();
    this.onFocus = options.onFocus;
    this.onNavigate = options.onNavigate;
    if (typeof options.views !== 'undefined') {
      this.view.apply(options.views);
    }
    // The switches read the map back, so the panel is built before the toolbar
    // that carries it and refreshed by every render.
    this.panel = viewPanel(
      this.view,
      () => this.render(this.model),
      (region: MemoryRegion) =>
        this.memory.segments.some((segment) => segment.key === region)
    );
    // The zoom buttons are three magnifiers, so the percentage they are
    // moving is written beside them. It is a live region for the same reason
    // the step counter is: pressing one of them changes nothing else that a
    // reader who is not watching the drawing would notice.
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'plivet-graph__status';
    this.zoomLabel.setAttribute('role', 'status');
    this.container.classList.add('plivet-graph');
    this.container.classList.toggle(
      'plivet-graph--dark',
      options.dark ?? false
    );
    this.container.appendChild(this.toolbar());
    // The bar is the frame of the window rather than something floating in
    // it: the paper scrolls inside the box below it, so the bar - and the
    // panel hanging off its right-hand end - is always over the view, at
    // whatever the reader has scrolled the drawing to.
    this.viewport = document.createElement('div');
    this.viewport.className = 'plivet-graph__view';
    this.paperHost = document.createElement('div');
    this.paperHost.className = 'plivet-graph__paper';
    this.viewport.appendChild(this.paperHost);
    this.container.appendChild(this.viewport);
    // The history belongs to the same workspace and View panel, but remains
    // ordinary DOM: a bounded table is clearer and cheaper than hundreds of
    // SVG cells. It follows the paper, so it is literally under the canvas.
    this.mutations = new MutationView(this.container);

    this.graph = new dia.Graph({}, { cellNamespace });
    this.paper = new dia.Paper({
      el: this.paperHost,
      model: this.graph,
      cellViewNamespace: cellNamespace,
      width: '100%',
      height: 900,
      async: true,
      frozen: true,
      sorting: dia.Paper.sorting.EXACT,
      interactive: false,
      background: {
        color: 'var(--plivet-graph-canvas, #ffffff)',
      },
    });
    this.paper.on('element:pointerclick', (_view, event) => {
      const target = event.target as Element | null;
      // Aggregate rows, memory segments and whole canvas sections all fold in
      // the place where the reader sees them.
      const hit =
        target === null
          ? null
          : target.closest(
              '[data-section-target], [data-fold-target], [data-frame-target], [data-collapse-target]'
            );
      if (hit === null) {
        return;
      }
      const group = hit.getAttribute('data-fold-target');
      const frame = hit.getAttribute('data-frame-target');
      const segment = hit.getAttribute('data-collapse-target');
      const section = hit.getAttribute('data-section-target');
      if (section !== null && isCanvasSection(section)) {
        this.toggleSection(section);
      } else if (group !== null) {
        this.folds.toggle(decodeURIComponent(group));
      } else if (frame !== null) {
        // Like a segment, and for the same reason: a frame nobody has clicked
        // is drawn from where the program is rather than from a stored
        // answer, so the click flips what the reader can see.
        const key = decodeURIComponent(frame);
        this.folds.toggleFrame(key, this.frameIsFolded(key));
      } else if (segment !== null) {
        // What the click flips is what the user is looking at: a segment
        // nobody has clicked is drawn collapsed when it is empty, and the
        // geometry is where that decision was made.
        const drawn = this.memory.segments.find((one) => one.key === segment);
        this.folds.toggleSegment(
          segment,
          typeof drawn !== 'undefined' && drawn.collapsed
        );
      } else {
        return;
      }
      this.render(this.model);
    });

    // Hover is read off the DOM rather than through the paper's own element
    // events: what the reader is pointing at is one row of a segment node,
    // and the paper would report the node.
    this.paperHost.addEventListener('mouseover', (event: MouseEvent) =>
      this.pointedAt(event)
    );
    this.paperHost.addEventListener('mouseleave', () => this.report(null));
    this.paperHost.addEventListener('dblclick', (event: MouseEvent) =>
      this.navigateFromMemory(event)
    );

    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.resize());
    if (this.resizeObserver !== null) {
      this.resizeObserver.observe(this.container);
    }
    this.render(this.model);
  }

  /** How the frame with this key is drawn at the moment, folded or not. */
  private frameIsFolded(key: string): boolean {
    for (const segment of this.memory.segments) {
      for (const row of segment.rows) {
        if (row.kind === 'group' && row.fold?.target === key) {
          return row.collapsed === true;
        }
      }
    }
    return false;
  }

  render(model: StepModel, explanation?: StatementExplanation): void {
    this.model = model;
    if (typeof explanation !== 'undefined') {
      this.explanation = explanation;
    }
    this.contentWidth = 0;
    this.contentHeight = 0;
    const cells: dia.Cell[] = [];
    let nextY = ORIGIN_Y;

    // Statement and Call stack are peers: the first names the operation and
    // the second the activation whose state that operation is changing.
    let hasTopRow = false;
    if (this.view.isStatementShown()) {
      cells.push(...this.statementCells(model, ORIGIN_X, nextY));
      hasTopRow = true;
    }
    if (this.view.isCallStackShown()) {
      cells.push(
        ...this.callStackCells(
          model,
          this.view.isStatementShown()
            ? ORIGIN_X + COLUMN_WIDTH + COLUMN_GAP
            : ORIGIN_X,
          nextY
        )
      );
      hasTopRow = true;
    }
    if (hasTopRow) {
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    }

    // The tree is a view of its own and gets the whole width below the two
    // textual state views, so wider expressions do not squeeze either one.
    if (this.view.isExpressionShown()) {
      cells.push(...this.expressionSectionCells(model, ORIGIN_X, nextY));
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;

      // One band per call, holding that call's arguments together. These
      // follow the Expression switch rather than carrying one each: a View
      // menu that grew an entry per call would change length with the step.
      // They do not follow the tree's own fold, because collapsing the
      // statement tree to read a call alone is the reason a reader would
      // collapse it.
      for (const call of model.callExpansions) {
        cells.push(...this.callSectionCells(call, ORIGIN_X, nextY));
        nextY =
          Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
      }
    }

    // The compact current-scope table bridges the source-level expression and
    // the complete implementation memory map below it.
    if (this.view.areVariablesShown()) {
      cells.push(...this.variableTableCells(model, ORIGIN_X, nextY));
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    }

    const baseMemory = memoryGeometry(model, this.folds, this.view);
    if (this.view.isMemoryShown()) {
      const memoryDrop = nextY + MEMORY_DROP - ORIGIN_Y;
      const memory = loweredMemory(baseMemory, memoryDrop);
      this.memory = memory;
      cells.push(
        this.sectionHeading(
          strings.graphMemoryHeading,
          ORIGIN_X,
          nextY,
          'memory',
          TWO_COLUMN_WIDTH
        )
      );
      if (!this.collapsed.has('memory')) {
        // A hand-built model with stacks and no process segments keeps the
        // old frame tables; ordinary execution uses the memory map.
        const frames =
          model.memory.length === 0
            ? loweredFrames(graphGeometry(model, this.folds), memoryDrop)
            : { stacks: [], arrows: [] };
        this.contentWidth = frames.stacks.reduce(
          (maximum, stack) => Math.max(maximum, stack.x + stack.width),
          Math.max(this.contentWidth, memory.width)
        );
        this.contentHeight = frames.stacks.reduce(
          (maximum, stack) => Math.max(maximum, stack.y + stack.height),
          Math.max(this.contentHeight, memory.height)
        );
        cells.push(
          ...memory.segments.map(memoryNodeOf),
          ...frames.stacks.map(stackTableOf),
          ...[...memory.arrows, ...frames.arrows].map((arrow) =>
            this.pointerLink(arrow)
          )
        );
      }
    } else {
      // Region switches still report their configured/dynamic state while the
      // enclosing memory section is switched off.
      this.memory = baseMemory;
    }

    this.mutations.setShown(this.view.areMutationsShown());
    this.mutations.setMutations(
      this.view.areMutationsShown() ? model.mutations : []
    );
    this.panel.refresh();
    this.paper.freeze();
    this.graph.resetCells(cells);
    this.resize();
    this.paper.unfreeze();
    // The scene was rebuilt under whatever the reader was pointing at, so the
    // mark goes back on. `async` paper draws after this returns, which is why
    // it is put back on the next frame rather than now.
    this.repaintFocus();
  }

  /**
   * Light up one object, or none. This is the other half of the editor's
   * tooltip: the two panels stop being separate pictures of the same program
   * at the moment that pointing at one of them marks the other.
   */
  setFocus(object: string | null): void {
    if (object === this.focused) {
      return;
    }
    this.focused = object;
    this.repaintFocus();
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.4, Math.min(2, scale));
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    this.paper.scale(this.scale, this.scale);
    this.resize();
  }

  setDark(dark: boolean): void {
    this.container.classList.toggle('plivet-graph--dark', dark);
    // Cells inherit the palette through CSS variables. Redrawing the paper
    // background makes the switch immediate in browsers that cache it.
    this.paper.drawBackground({
      color: 'var(--plivet-graph-canvas, #ffffff)',
    });
  }

  destroy(): void {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
    }
    this.paper.remove();
    this.graph.clear();
    this.mutations.destroy();
    this.container.replaceChildren();
    this.container.classList.remove('plivet-graph');
    this.container.classList.remove('plivet-graph--dark');
  }

  /** Which object the pointer is over, from the row it is inside. */
  private pointedAt(event: MouseEvent): void {
    const target = event.target as Element | null;
    const hit = target === null ? null : target.closest('[data-object-key]');
    const object = hit === null ? null : hit.getAttribute('data-object-key');
    this.report(object === null ? null : decodeURIComponent(object));
  }

  /** Follow any box in a variable or memory row; other cells carry no key. */
  private navigateFromMemory(event: MouseEvent): void {
    if (event.button !== 0 || typeof this.onNavigate === 'undefined') {
      return;
    }
    const target = event.target as Element | null;
    const hit = target === null ? null : target.closest('[data-object-key]');
    const encoded = hit?.getAttribute('data-object-key');
    if (encoded === null || typeof encoded === 'undefined') {
      return;
    }
    event.preventDefault();
    this.onNavigate(
      memoryNavigationTarget(this.model, decodeURIComponent(encoded))
    );
  }

  private report(object: string | null): void {
    if (object === this.reported) {
      return;
    }
    this.reported = object;
    if (typeof this.onFocus !== 'undefined') {
      this.onFocus(object);
    }
  }

  private toggleSection(section: CanvasSection): void {
    // The unavailable-expression heading is an automatic collapsed state, not
    // a user preference. Ignore clicks on it so the next real expression can
    // open normally instead of inheriting a click made on an empty section.
    if (section === 'expression' && this.model.expression === null) {
      return;
    }
    if (this.collapsed.has(section)) {
      this.collapsed.delete(section);
    } else {
      this.collapsed.add(section);
    }
    this.render(this.model);
  }

  /**
   * Puts the mark on every box of the focused object and takes it off the
   * rest. The paint is a class rather than an attribute: JointJS writes fill
   * and stroke as presentation attributes, which a stylesheet outranks, so
   * the highlight needs no second copy of the palette.
   */
  private repaintFocus(): void {
    const marked = this.paperHost.querySelectorAll(`.${FOCUS_CLASS}`);
    marked.forEach((element: Element) => element.classList.remove(FOCUS_CLASS));
    if (this.focused === null) {
      return;
    }
    const key = encodeURIComponent(this.focused);
    const boxes = this.paperHost.querySelectorAll(`[data-object-key="${key}"]`);
    boxes.forEach((element: Element) => element.classList.add(FOCUS_CLASS));
  }

  private pointerLink(arrow: ArrowGeometry): shapes.standard.Link {
    const link = new shapes.standard.Link({ z: 2 });
    link.source(arrow.from);
    link.target(arrow.to);
    if (typeof arrow.vertices !== 'undefined') {
      // The layout has decided where this one goes; routing it again would
      // only send it back through the segments it was drawn around.
      link.vertices(arrow.vertices);
      link.router('normal');
    } else {
      link.router('manhattan', { step: 10, padding: 8 });
    }
    link.connector('rounded', { radius: 8 });
    link.attr({
      line: {
        stroke: arrow.color,
        strokeWidth: 2,
        targetMarker: {
          type: 'path',
          d: 'M 10 -5 0 0 10 5 z',
          fill: arrow.color,
          stroke: arrow.color,
        },
      },
    });
    return link;
  }

  /**
   * A section's name, in the same slate disclosure band wherever it stands.
   *
   * A one-column section takes one column and a spanning section takes two;
   * neither changes width with the content at the current step.
   */
  private sectionHeading(
    text: string,
    x: number,
    y: number,
    section: CanvasSection,
    width: number,
    collapsed: boolean = this.collapsed.has(section)
  ): dia.Element {
    const heading = new shapes.standard.Rectangle({ z: 4 });
    heading.position(x, y);
    heading.resize(width, HEADING_HEIGHT);
    heading.attr({
      body: {
        fill: 'var(--plivet-graph-title, #26384a)',
        stroke: 'var(--plivet-graph-title, #26384a)',
        rx: 4,
        ry: 4,
        class: 'plivet-section-heading',
        'data-section-target': section,
      },
      label: {
        text: `${collapsed ? '▶' : '▼'}  ${text}`,
        fill: 'var(--plivet-graph-title-text, #ffffff)',
        class: 'plivet-section-heading__label',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 'bold',
        pointerEvents: 'none',
      },
    });
    this.contentWidth = Math.max(this.contentWidth, x + width + ORIGIN_X);
    this.contentHeight = Math.max(this.contentHeight, y + HEADING_HEIGHT);
    return heading;
  }

  /**
   * The first section: what the statement under the step marker is doing.
   *
   * Its heading is always drawn, whatever the step is. A section that appeared
   * and vanished as the program moved from one kind of statement to the next
   * moved the call stack and memory map with it, and a reader following a run
   * cannot read a page that will not hold still.
   *
   * What goes under the heading names the construct the step is inside and
   * what it is doing - the same records the tooltip reads, so the two never
   * disagree. Its expression is the full-width section below the top row.
   */
  private statementCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    // Statement visibility is independent of the expansion below it.
    if (!this.view.isStatementShown()) {
      return [];
    }
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.graphStatementHeading,
        originX,
        originY,
        'statement',
        COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('statement')) {
      return cells;
    }
    const headingBottom = originY + HEADING_HEIGHT + HEADING_GAP;
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, headingBottom);
    // Preserve the explanation's title/fact structure. Flattening these into
    // one string made a clause, a runtime result and a language note look like
    // equally important fragments of prose.
    const includeValues =
      model.expression === null ||
      !this.view.isExpressionShown() ||
      this.collapsed.has('expression');
    cells.push(
      ...this.statementCardCells(
        statementCard(model, this.explanation, includeValues),
        originX,
        headingBottom
      )
    );
    return cells;
  }

  /** The active calls beside the statement whose state they define. */
  private callStackCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.viewCallStack,
        originX,
        originY,
        'callStack',
        COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('callStack')) {
      return cells;
    }

    const rows = callStackRows(model.frames);
    const shown =
      rows.length === 0
        ? [
            {
              name: strings.viewNothingRunning,
              where: '',
              arguments: '',
              timesEntered: '',
              current: false,
            },
          ]
        : rows;
    let y = originY + HEADING_HEIGHT + HEADING_GAP;
    for (const row of shown) {
      const details = [row.where, row.arguments, row.timesEntered].filter(
        (part) => part !== ''
      );
      const text = [row.name, details.join(' · ')].filter(Boolean).join('\n');
      const height = details.length === 0 ? 34 : 48;
      const cell = new shapes.standard.Rectangle({ z: 4 });
      cell.position(originX, y);
      cell.resize(COLUMN_WIDTH, height);
      cell.attr({
        body: {
          fill: row.current
            ? 'var(--plivet-graph-current, #e8f2ff)'
            : 'var(--plivet-graph-surface, #ffffff)',
          stroke: row.current
            ? 'var(--plivet-graph-current-line, #4f81bd)'
            : 'var(--plivet-graph-grid, #cfd8e1)',
          strokeWidth: row.current ? 2 : 1,
          rx: 3,
          ry: 3,
        },
        label: {
          text,
          fill: 'var(--plivet-graph-ink, #26384a)',
          fontFamily: "Consolas, 'Courier New', monospace",
          fontSize: 13,
          ...leftAlignedLabel(10, height),
        },
      });
      cells.push(cell);
      y += height + CALL_ROW_GAP;
    }
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  /** The expression tree below, spanning both top-row columns. */
  private expressionSectionCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const collapsed = expressionSectionIsCollapsed(
      model.expression,
      this.collapsed.has('expression')
    );
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.graphExpressionHeading,
        originX,
        originY,
        'expression',
        TWO_COLUMN_WIDTH,
        collapsed
      ),
    ];
    if (collapsed || model.expression === null) {
      return cells;
    }
    const bodyY = originY + HEADING_HEIGHT + HEADING_GAP;
    cells.push(...this.expressionCells(model.expression, originX, bodyY));
    return cells;
  }

  /**
   * One call with its arguments, below the statement that makes it.
   *
   * The tree is rooted at the call operator, so the arguments stay under the
   * thing that binds them; the heading carries the signature, so the reader
   * can pair them left to right with the parameters they fill.
   */
  private callSectionCells(
    call: CallExpansionModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const section: CanvasSection = `call:${call.key}`;
    const cells: dia.Cell[] = [
      this.sectionHeading(
        callHeading(call),
        originX,
        originY,
        section,
        TWO_COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has(section)) {
      return cells;
    }
    cells.push(
      ...this.expressionCells(
        call.expression,
        originX,
        originY + HEADING_HEIGHT + HEADING_GAP
      )
    );
    return cells;
  }

  /** A conventional debugger table for names visible in the current frame. */
  private variableTableCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.viewVariables,
        originX,
        originY,
        'variables',
        TWO_COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('variables')) {
      return cells;
    }

    let y = originY + HEADING_HEIGHT + HEADING_GAP;
    cells.push(
      this.cardCell(
        variableContextLabel(model),
        originX,
        y,
        TWO_COLUMN_WIDTH,
        VARIABLE_CONTEXT_HEIGHT,
        {
          fill: 'var(--plivet-graph-caption, #f7f9fb)',
          stroke: 'var(--plivet-graph-grid, #cfd8e1)',
          color: 'var(--plivet-graph-context-text, #5d6b78)',
          fontSize: 12,
        }
      )
    );
    y += VARIABLE_CONTEXT_HEIGHT;

    const headings = [
      strings.memoryColumnName,
      strings.memoryColumnValue,
      strings.variableColumnSize,
      strings.variableColumnSegment,
      strings.memoryColumnAddress,
    ];
    let x = originX;
    headings.forEach((heading, index) => {
      const width = VARIABLE_COLUMN_WIDTHS[index];
      cells.push(
        this.cardCell(heading, x, y, width, VARIABLE_HEADER_HEIGHT, {
          fill: 'var(--plivet-graph-header, #eef2f6)',
          stroke: 'var(--plivet-graph-grid, #cfd8e1)',
          color: 'var(--plivet-graph-header-text, #4a5b6c)',
          bold: true,
          fontSize: 12,
        })
      );
      x += width;
    });
    y += VARIABLE_HEADER_HEIGHT;

    const rows = variableTableRows(model);
    if (rows.length === 0) {
      cells.push(
        this.cardCell(
          strings.variableNoneActive,
          originX,
          y,
          TWO_COLUMN_WIDTH,
          VARIABLE_ROW_HEIGHT,
          {
            fill: 'var(--plivet-graph-surface, #ffffff)',
            stroke: 'var(--plivet-graph-grid, #cfd8e1)',
            color: 'var(--plivet-graph-muted, #8494a4)',
            fontSize: 13,
          }
        )
      );
      y += VARIABLE_ROW_HEIGHT;
    } else {
      for (const row of rows) {
        const values = [
          row.name,
          row.value,
          row.size,
          row.segment,
          row.address,
        ];
        x = originX;
        values.forEach((value, index) => {
          const width = VARIABLE_COLUMN_WIDTHS[index];
          const cell = this.cardCell(value, x, y, width, VARIABLE_ROW_HEIGHT, {
            fill:
              index === 4
                ? 'var(--plivet-graph-address, #fbfcfd)'
                : 'var(--plivet-graph-surface, #ffffff)',
            stroke: 'var(--plivet-graph-grid, #cfd8e1)',
            color: 'var(--plivet-graph-ink, #26384a)',
            code: index !== 3,
            fontSize: 13,
          });
          cell.attr({
            body: {
              'data-object-key': encodeURIComponent(row.key),
              class: 'plivet-object-cell plivet-variable-cell',
            },
            label: { pointerEvents: 'none' },
          });
          cells.push(cell);
          x += width;
        });
        y += VARIABLE_ROW_HEIGHT;
      }
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + TWO_COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  /** A teaching card: title, context, one explanation, then produced values. */
  private statementCardCells(
    card: StatementCardModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [];
    let y = originY;

    cells.push(
      this.cardCell(card.title, originX, y, COLUMN_WIDTH, CARD_TITLE_HEIGHT, {
        fill: 'var(--plivet-graph-current, #e8f2ff)',
        stroke: 'var(--plivet-graph-accent-line, #9fbfe5)',
        color: 'var(--plivet-graph-accent-text, #234b73)',
        bold: true,
        fontSize: 15,
      })
    );
    y += CARD_TITLE_HEIGHT;

    if (card.context !== '') {
      const contextHeight = this.cardTextHeight(
        card.context,
        COLUMN_WIDTH,
        CARD_CONTEXT_HEIGHT
      );
      cells.push(
        this.cardCell(card.context, originX, y, COLUMN_WIDTH, contextHeight, {
          fill: 'var(--plivet-graph-caption, #f7f9fb)',
          stroke: 'var(--plivet-graph-grid, #cfd8e1)',
          color: 'var(--plivet-graph-context-text, #5d6b78)',
          fontSize: 12,
        })
      );
      y += contextHeight;
    }

    if (card.description !== '') {
      const descriptionHeight = this.cardTextHeight(
        card.description,
        COLUMN_WIDTH,
        CARD_DESCRIPTION_HEIGHT
      );
      cells.push(
        this.cardCell(
          card.description,
          originX,
          y,
          COLUMN_WIDTH,
          descriptionHeight,
          {
            fill: 'var(--plivet-graph-surface, #ffffff)',
            stroke: 'var(--plivet-graph-grid, #cfd8e1)',
            color: 'var(--plivet-graph-ink, #26384a)',
            fontSize: 13,
          }
        )
      );
      y += descriptionHeight;
    }

    if (card.values.length !== 0) {
      cells.push(
        this.cardCell(
          strings.statementValuesHeading,
          originX,
          y,
          COLUMN_WIDTH,
          CARD_SECTION_HEIGHT,
          {
            fill: 'var(--plivet-graph-header, #eef2f6)',
            stroke: 'var(--plivet-graph-grid, #cfd8e1)',
            color: 'var(--plivet-graph-header-text, #4a5b6c)',
            bold: true,
            fontSize: 12,
          }
        )
      );
      y += CARD_SECTION_HEIGHT;
      for (const row of card.values) {
        const rendered = this.cardRow(row, originX, y);
        cells.push(...rendered.cells);
        y = rendered.bottom;
      }
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  private cardRow(
    row: StatementCardRow,
    originX: number,
    originY: number
  ): { cells: dia.Cell[]; bottom: number } {
    if (row.value === '') {
      const height = this.cardRowHeight(row.label, COLUMN_WIDTH);
      return {
        cells: [
          this.cardCell(row.label, originX, originY, COLUMN_WIDTH, height, {
            fill: 'var(--plivet-graph-note, #fff8e1)',
            stroke: 'var(--plivet-graph-note-line, #e2d3a4)',
            color: 'var(--plivet-graph-note-text, #5c5130)',
            code: row.labelCode,
            fontSize: 13,
          }),
        ],
        bottom: originY + height,
      };
    }

    const valueWidth = COLUMN_WIDTH - CARD_LABEL_WIDTH;
    const height = Math.max(
      this.cardRowHeight(row.label, CARD_LABEL_WIDTH),
      this.cardRowHeight(row.value, valueWidth)
    );
    return {
      cells: [
        this.cardCell(row.label, originX, originY, CARD_LABEL_WIDTH, height, {
          fill: 'var(--plivet-graph-header, #eef2f6)',
          stroke: 'var(--plivet-graph-grid, #cfd8e1)',
          color: 'var(--plivet-graph-header-text, #4a5b6c)',
          bold: !row.labelCode,
          code: row.labelCode,
          fontSize: 12,
        }),
        this.cardCell(
          row.value,
          originX + CARD_LABEL_WIDTH,
          originY,
          valueWidth,
          height,
          {
            fill: 'var(--plivet-graph-surface, #ffffff)',
            stroke: 'var(--plivet-graph-grid, #cfd8e1)',
            color: 'var(--plivet-graph-ink, #26384a)',
            code: row.valueCode,
            fontSize: 13,
          }
        ),
      ],
      bottom: originY + height,
    };
  }

  private cardRowHeight(text: string, width: number): number {
    return this.cardTextHeight(text, width, CARD_ROW_HEIGHT);
  }

  private cardTextHeight(text: string, width: number, minimum: number): number {
    return wrappedTextHeight(text, width, minimum);
  }

  private cardCell(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    style: {
      fill: string;
      stroke: string;
      color: string;
      bold?: boolean;
      code?: boolean;
      fontSize: number;
    }
  ): dia.Element {
    const cell = new shapes.standard.Rectangle({ z: 4 });
    cell.position(x, y);
    cell.resize(width, height);
    cell.attr({
      body: { fill: style.fill, stroke: style.stroke },
      label: {
        text,
        fill: style.color,
        fontFamily:
          style.code === true
            ? "Consolas, 'Courier New', monospace"
            : 'system-ui, sans-serif',
        fontSize: style.fontSize,
        fontWeight: style.bold === true ? 'bold' : 'normal',
        ...leftAlignedLabel(10, height),
        textWrap: { width: -20, height: -8 },
      },
    });
    return cell;
  }

  private expressionCells(
    expression: ExpressionModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const nodeWidth = 138;
    const nodeHeight = 54;
    const gapX = 18;
    const gapY = 30;
    const treeTop = originY;
    const geometry = expressionGeometry(
      expression.root,
      { x: originX, y: treeTop },
      { nodeWidth, nodeHeight, gapX, gapY }
    );
    const cells: dia.Cell[] = [];
    for (const placed of geometry.nodes) {
      cells.push(expressionNodeOf(placed));
    }
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
          stroke: 'var(--plivet-graph-expression-link, #5c6773)',
          strokeWidth: 1.5,
          targetMarker: { type: 'none' },
        },
      });
      cells.push(link);
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + geometry.width + ORIGIN_X
    );
    this.contentHeight = Math.max(
      this.contentHeight,
      treeTop + geometry.height + ORIGIN_X
    );
    return cells;
  }

  /**
   * The bar over the drawing: the zoom, what it is at, and the switches for
   * what is drawn at all.
   *
   * It is the editor's control bar again - the same joined group, the same
   * magnifiers, the same buttons - because a reader works between the two
   * panels and there is no reason for the same gesture to look different on
   * each side of the splitter. What it does not share is the stylesheet: the
   * icons are a module, and the paint is `--plivet-button-*`, so the canvas
   * still mounts on a page that has never heard of `controls.css`.
   */
  private toolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'plivet-graph__toolbar';

    const zoom = document.createElement('div');
    zoom.className = 'plivet-graph__group';
    zoom.append(
      this.zoomButton('zoomOut', strings.graphZoomOut, () =>
        this.setScale(this.scale - 0.1)
      ),
      this.zoomButton('zoomReset', strings.graphZoomReset, () =>
        this.setScale(1)
      ),
      this.zoomButton('zoomIn', strings.graphZoomIn, () =>
        this.setScale(this.scale + 0.1)
      )
    );

    // The percentage stays with the buttons that move it, and the disclosure
    // keeps the right-hand end: its panel hangs from that edge, and anywhere
    // else on the bar it would open off the side of the canvas.
    toolbar.append(zoom, this.zoomLabel, this.panel.root);
    return toolbar;
  }

  private zoomButton(
    icon: IconName,
    title: string,
    action: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plivet-graph__button';
    button.title = title;
    // The picture carries no name, so the button says what it is itself.
    button.setAttribute('aria-label', title);
    button.appendChild(iconFor(icon));
    button.addEventListener('click', action);
    return button;
  }

  private resize(): void {
    const bounds = this.graph.getBBox();
    const contentBottom = Math.max(
      this.contentHeight,
      bounds === null ? 0 : bounds.y + bounds.height
    );
    const contentRight = Math.max(
      this.contentWidth,
      bounds === null ? 0 : bounds.x + bounds.width
    );
    const height = Math.max(480, (contentBottom + 80) * this.scale);
    const width = Math.max(
      this.viewport.clientWidth,
      contentRight * this.scale
    );
    this.paper.setDimensions(width, height);
    this.paperHost.style.height = `${height}px`;
  }
}
