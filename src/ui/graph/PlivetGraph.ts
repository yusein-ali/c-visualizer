import { dia, shapes } from '@joint/core';
import {
  ArrowGeometry,
  DEBUG_STATE,
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
import {
  graphGeometry,
  memoryGeometry,
  variableMemoryGeometry,
} from './geometry';
import { expressionGeometry } from './expressionLayout';
import { expressionNodeOf } from './ExpressionNode';
import { ViewPanelHandle, viewPanel } from './ViewPanel';
import { callStackRows } from './callStack';
import { callHeading } from './callSection';
import { variableContextLabel } from './variableTable';
import { emptyStatementExplanation, StatementExplanation } from '../records';
import { MemoryNode, memoryNodeOf } from './MemoryNode';
import { StackTable, stackTableOf } from './StackTable';
import { mutationTableCells } from './mutationTable';
import {
  DiagnosticActivity,
  DiagnosticEntry,
  RunStatus,
  STATUS_HEIGHT,
  activityIsPending,
  diagnosticStatusCell,
  diagnosticStatusText,
  diagnosticsTableCells,
  sameDiagnostics,
  sortedDiagnostics,
} from './diagnosticsTable';
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
  | { kind: 'function'; name: string }
  /**
   * A place rather than a name: what a diagnostic row points at. The canvas
   * has the file and the line already and nothing to resolve, so this asks
   * for a position instead of asking for a declaration to be found.
   */
  | { kind: 'location'; path: string; line: number; column: number };

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
 * first row; Expression expansion spans both columns beneath them, the
 * complete Memory map follows at full width, and Variables and the write
 * history share the last row - the names in scope now on the left, the stores
 * that gave them their values on the right. Each major section has one
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
/** Where the drawing starts, which is where `layoutMemory` puts the map. */
const ORIGIN_X = 24;
const ORIGIN_Y = 24;
/** What the map has to come down by to leave its own heading room. */
const MEMORY_DROP = HEADING_HEIGHT + HEADING_GAP;
const CALL_ROW_GAP = 5;
const VARIABLE_CONTEXT_HEIGHT = 30;
/**
 * How long the status line above the findings keeps reporting the last thing
 * that finished before it admits that nothing is happening. Long enough that
 * a reader who looked away still sees the answer to what they pressed, short
 * enough that "Build complete" is never left standing over a program that has
 * been rewritten since.
 */
const DIAGNOSTICS_IDLE_DELAY = 8000;
/** The bands that are collapsed while nothing is running, in layout order. */
const STATE_SECTIONS: CanvasSection[] = [
  'statement',
  'callStack',
  'expression',
  'variables',
  'memory',
  'mutations',
];
const VARIABLE_ROW_HEIGHT = 34;

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
  | 'diagnostics'
  | 'statement'
  | 'callStack'
  | 'expression'
  | 'variables'
  | 'memory'
  | 'mutations'
  | `call:${string}`;

const isCanvasSection = (value: string): value is CanvasSection =>
  value === 'diagnostics' ||
  value === 'statement' ||
  value === 'callStack' ||
  value === 'expression' ||
  value === 'variables' ||
  value === 'memory' ||
  value === 'mutations' ||
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
  /** Every finding the checkers have reported, unordered as it arrived. */
  private diagnostics: DiagnosticEntry[] = [];
  /**
   * The same findings in the order they were last drawn in. A row carries its
   * index, so the click has to be read against the list that produced it
   * rather than against whatever has arrived since.
   */
  private drawnDiagnostics: DiagnosticEntry[] = [];
  private activity: DiagnosticActivity | null = null;
  /** Why the latest run was refused or terminated, independently of Stop. */
  private runStatus: RunStatus = null;
  private debugState: DEBUG_STATE = 'Stop';
  /** Nothing has happened for long enough to stop reporting what did. */
  private diagnosticsIdle = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** One coalesced redraw after disclosure input, never one rebuild per hit. */
  private disclosureFrame: number | null = null;
  /** The status sentence as it stands on the canvas now. */
  private drawnStatus = '';
  /**
   * What the reader had collapsed before a stop collapsed everything for
   * them, and null while nothing is being held. A run puts it back, so the
   * automatic collapse is a way of clearing the canvas rather than a way of
   * overwriting what they chose.
   */
  private heldCollapsed: Set<CanvasSection> | null = null;
  private executing = false;

  /** Width of a section band in the visible canvas, in paper coordinates. */
  private fullCanvasWidth(): number {
    return Math.max(1, this.viewport.clientWidth / this.scale - ORIGIN_X * 2);
  }

  private topColumnWidth(): number {
    return Math.max(1, (this.fullCanvasWidth() - COLUMN_GAP) / 2);
  }

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
    this.paper.on('element:pointerdown', (_view, event) => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target as Element | null;
      // Aggregate rows, memory segments and whole canvas sections all fold in
      // the place where the reader sees them.
      const hit =
        target === null
          ? null
          : target.closest(
              '[data-section-target], [data-fold-target], [data-frame-target], [data-collapse-target], [data-diagnostic-index]'
            );
      if (hit === null) {
        return;
      }
      const finding = hit.getAttribute('data-diagnostic-index');
      if (finding !== null) {
        // Navigation remains a completed click; only disclosures act on
        // pointer-down so their target cannot disappear before pointer-up.
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
      this.scheduleDisclosureRender();
    });
    this.paper.on('element:pointerclick', (_view, event) => {
      const target = event.target as Element | null;
      const hit = target?.closest('[data-diagnostic-index]');
      const finding = hit?.getAttribute('data-diagnostic-index');
      if (finding !== null && typeof finding !== 'undefined') {
        this.followDiagnostic(Number(finding));
      }
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
        : new ResizeObserver(() => this.render(this.model));
    if (this.resizeObserver !== null) {
      this.resizeObserver.observe(this.container);
    }
    // Nothing is running yet, which is the state the state views have nothing
    // to say in: the canvas opens the way a stop leaves it.
    this.collapseStateSections();
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

    // The status strip is drawn whether or not anything has been found: it is
    // where a reader learns that a build is under way, and a line that
    // appeared only once the compiler had found something would be silent for
    // exactly the wait it exists to explain. The table under it is the
    // opposite - absent rather than empty, because a heading over no findings
    // is a band of canvas spent saying nothing.
    if (this.view.areDiagnosticsShown()) {
      cells.push(this.statusCell(ORIGIN_X, nextY));
      nextY += STATUS_HEIGHT;
      if (this.diagnostics.length === 0) {
        this.drawnDiagnostics = [];
      } else {
        nextY += HEADING_GAP;
        cells.push(...this.diagnosticsCells(ORIGIN_X, nextY));
        nextY = Math.max(this.contentHeight, nextY + HEADING_HEIGHT);
      }
      nextY += SECTION_GAP;
    } else {
      this.drawnDiagnostics = [];
      this.drawnStatus = '';
    }

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
            ? ORIGIN_X + this.topColumnWidth() + COLUMN_GAP
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

    const baseMemory = memoryGeometry(
      model,
      this.folds,
      this.view,
      this.fullCanvasWidth()
    );
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
          this.fullCanvasWidth()
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
          ...memory.segments.map((segment) => memoryNodeOf(segment)),
          ...frames.stacks.map(stackTableOf),
          ...[...memory.arrows, ...frames.arrows].map((arrow) =>
            this.pointerLink(arrow)
          )
        );
      }
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    } else {
      // Region switches still report their configured/dynamic state while the
      // enclosing memory section is switched off.
      this.memory = baseMemory;
    }

    // The compact current-scope table follows the complete implementation
    // memory map, so the names a reader cares about remain beside the storage
    // they describe without covering the map itself. It names very few objects
    // and each write is one line, so the two share the last row the way
    // Statement and Call stack share the first: the current values on the
    // left, the writes that produced them on the right.
    const variablesShown = this.view.areVariablesShown();
    const mutationsShown = this.view.areMutationsShown();
    if (variablesShown || mutationsShown) {
      const columnWidth =
        variablesShown && mutationsShown
          ? this.topColumnWidth()
          : this.fullCanvasWidth();
      if (variablesShown) {
        cells.push(
          ...this.variableTableCells(model, ORIGIN_X, nextY, columnWidth)
        );
      }
      if (mutationsShown) {
        cells.push(
          ...this.mutationSectionCells(
            model,
            variablesShown ? ORIGIN_X + columnWidth + COLUMN_GAP : ORIGIN_X,
            nextY,
            columnWidth
          )
        );
      }
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    }
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
   * What the checkers have found, replacing what they had found before.
   *
   * Every finding of both kinds arrives in one call for the same reason the
   * linter takes one set: two calls would each be a complete answer, and the
   * second would be drawing a table the first had already contradicted.
   */
  setDiagnostics(diagnostics: DiagnosticEntry[]): void {
    if (sameDiagnostics(this.diagnostics, diagnostics)) {
      return;
    }
    const wasDrawn = this.diagnosticsAreDrawn();
    this.diagnostics = diagnostics.slice();
    if (wasDrawn || this.diagnosticsAreDrawn()) {
      this.render(this.model);
    }
  }

  /**
   * What the checkers are doing, for the line over the table.
   *
   * The canvas is told rather than asked: which of them is running is known
   * where the requests are made, and a widget that polled for it would be
   * holding a second copy of the application's state.
   */
  setDiagnosticActivity(activity: DiagnosticActivity): void {
    this.activity = activity;
    this.diagnosticsIdle = false;
    this.restartIdleTimer();
    this.refreshStatus();
  }

  /** Report or clear an abnormal outcome of the latest run. */
  setRunStatus(status: RunStatus): void {
    if (status === this.runStatus) {
      return;
    }
    this.runStatus = status;
    this.diagnosticsIdle = false;
    this.restartIdleTimer();
    this.refreshStatus();
  }

  /**
   * Whether a program is running, and what it is doing while it runs.
   *
   * A canvas with nothing running on it draws six sections that all say the
   * same thing - that nothing is running - so a stop closes them and leaves
   * the findings open. A start puts back exactly what the reader had, which
   * is what makes this a clearing rather than a preference of its own.
   */
  setDebugState(state: DEBUG_STATE): void {
    if (state === this.debugState) {
      return;
    }
    this.debugState = state;
    const executing = state !== 'Stop';
    if (executing === this.executing) {
      this.refreshStatus();
      return;
    }
    this.executing = executing;
    if (executing) {
      this.restoreStateSections();
    } else {
      this.collapseStateSections();
    }
    this.diagnosticsIdle = false;
    this.restartIdleTimer();
    this.render(this.model);
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
    this.render(this.model);
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
    if (this.disclosureFrame !== null) {
      cancelAnimationFrame(this.disclosureFrame);
      this.disclosureFrame = null;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
    }
    this.paper.remove();
    this.graph.clear();
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
    const object = decodeURIComponent(encoded);
    // Keep the row selected while the editor moves to its declaration, even
    // when the browser does not deliver another mouseover after the gesture.
    this.setFocus(object);
    this.onNavigate(memoryNavigationTarget(this.model, object));
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
    const opening = this.collapsed.has(section);
    if (opening) {
      this.collapsed.delete(section);
    } else {
      this.collapsed.add(section);
    }
    // A band the reader opens while the canvas is cleared is a band they
    // want: the run that puts the rest back must not close it again.
    if (this.heldCollapsed !== null) {
      if (opening) {
        this.heldCollapsed.delete(section);
      } else {
        this.heldCollapsed.add(section);
      }
    }
  }

  /**
   * Let a burst of disclosure input finish before replacing the SVG scene.
   * The old targets remain present for the rest of the frame, and all state
   * changes made in that frame are represented by one expensive rebuild.
   */
  private scheduleDisclosureRender(): void {
    if (this.disclosureFrame !== null) {
      return;
    }
    this.disclosureFrame = requestAnimationFrame(() => {
      this.disclosureFrame = null;
      this.render(this.model);
    });
  }

  /** Whether the findings band is on the canvas at the moment. */
  private diagnosticsAreDrawn(): boolean {
    return this.view.areDiagnosticsShown() && this.diagnostics.length !== 0;
  }

  /**
   * Redraw for the status line alone, and only when the line has something
   * different to say. A local check runs on every pause in typing, and
   * rebuilding the scene to write the same sentence again would cost a redraw
   * a second for nothing.
   */
  private refreshStatus(): void {
    // The strip is drawn whenever the section is switched on, so this asks
    // about the switch rather than about the findings: a build with nothing
    // to report still has a status to report.
    if (!this.view.areDiagnosticsShown()) {
      return;
    }
    const status = diagnosticStatusText(
      this.activity,
      this.debugState,
      this.diagnosticsIdle,
      this.runStatus
    );
    if (status === this.drawnStatus) {
      return;
    }
    this.render(this.model);
  }

  private restartIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Nothing goes idle while a checker is still working or a program is
    // still running: the line is reporting the present, not waiting out a
    // silence.
    if (activityIsPending(this.activity) || this.debugState !== 'Stop') {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.diagnosticsIdle = true;
      this.refreshStatus();
    }, DIAGNOSTICS_IDLE_DELAY);
  }

  /** Close every state view and leave the findings open over them. */
  private collapseStateSections(): void {
    if (this.heldCollapsed === null) {
      this.heldCollapsed = new Set(this.collapsed);
    }
    for (const section of STATE_SECTIONS) {
      this.collapsed.add(section);
    }
    this.collapsed.delete('diagnostics');
  }

  /** Put back what the reader had open before the canvas was cleared. */
  private restoreStateSections(): void {
    if (this.heldCollapsed === null) {
      return;
    }
    this.collapsed.clear();
    for (const section of this.heldCollapsed) {
      this.collapsed.add(section);
    }
    this.heldCollapsed = null;
  }

  /** Follow a clicked finding to the place in the source it was found in. */
  private followDiagnostic(index: number): void {
    const entry = this.drawnDiagnostics[index];
    if (
      typeof entry === 'undefined' ||
      typeof this.onNavigate === 'undefined'
    ) {
      return;
    }
    this.onNavigate({
      kind: 'location',
      path: entry.path,
      line: entry.line,
      column: entry.column,
    });
  }

  /**
   * The strip over the whole canvas: what the checkers and the debugger are
   * doing, in one sentence.
   *
   * It is above the sections rather than inside the findings band, and outside
   * the band's own disclosure, because the two answer different questions. The
   * table says what is wrong with the program; this says whether anybody has
   * looked lately - and the moment a reader most needs that answer is the one
   * where the table is not there to carry it, waiting on a build of a program
   * nothing has been found wrong with yet.
   */
  private statusCell(originX: number, originY: number): dia.Cell {
    const width = this.fullCanvasWidth();
    this.drawnStatus = diagnosticStatusText(
      this.activity,
      this.debugState,
      this.diagnosticsIdle,
      this.runStatus
    );
    this.contentWidth = Math.max(this.contentWidth, originX + width + ORIGIN_X);
    this.contentHeight = Math.max(this.contentHeight, originY + STATUS_HEIGHT);
    return diagnosticStatusCell(this.drawnStatus, originX, originY, width);
  }

  /** The findings themselves, under their own disclosure heading. */
  private diagnosticsCells(originX: number, originY: number): dia.Cell[] {
    const width = this.fullCanvasWidth();
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.diagnosticsHeading,
        originX,
        originY,
        'diagnostics',
        width
      ),
    ];
    if (this.collapsed.has('diagnostics')) {
      this.drawnDiagnostics = [];
      return cells;
    }
    const top = originY + HEADING_HEIGHT + HEADING_GAP;
    this.drawnDiagnostics = sortedDiagnostics(this.diagnostics);
    const table = diagnosticsTableCells(
      this.drawnDiagnostics,
      originX,
      top,
      width
    );
    cells.push(...table.cells);
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + Math.max(width, table.width) + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, top + table.height);
    return cells;
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
        ...leftAlignedLabel(12, HEADING_HEIGHT),
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
        this.view.isCallStackShown()
          ? this.topColumnWidth()
          : this.fullCanvasWidth()
      ),
    ];
    if (this.collapsed.has('statement')) {
      return cells;
    }
    const headingBottom = originY + HEADING_HEIGHT + HEADING_GAP;
    this.contentWidth = Math.max(
      this.contentWidth,
      originX +
        (this.view.isCallStackShown()
          ? this.topColumnWidth()
          : this.fullCanvasWidth()) +
        ORIGIN_X
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
        headingBottom,
        this.view.isCallStackShown()
          ? this.topColumnWidth()
          : this.fullCanvasWidth()
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
        this.view.isStatementShown()
          ? this.topColumnWidth()
          : this.fullCanvasWidth()
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
      const details = [row.where, row.timesEntered].filter(
        (part) => part !== ''
      );
      const text = [row.name, details.join(' · ')].filter(Boolean).join('\n');
      const height = details.length === 0 ? 34 : 48;
      const cell = new shapes.standard.Rectangle({ z: 4 });
      cell.position(originX, y);
      const columnWidth = this.view.isStatementShown()
        ? this.topColumnWidth()
        : this.fullCanvasWidth();
      cell.resize(columnWidth, height);
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
      originX +
        (this.view.isStatementShown()
          ? this.topColumnWidth()
          : this.fullCanvasWidth()) +
        ORIGIN_X
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
        this.fullCanvasWidth(),
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
        this.fullCanvasWidth()
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
    originY: number,
    tableWidth: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.viewVariables,
        originX,
        originY,
        'variables',
        tableWidth
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
        tableWidth,
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

    const variableMemory = variableMemoryGeometry(
      model,
      this.folds,
      tableWidth
    );
    const segment = variableMemory.segments[0];
    if (typeof segment === 'undefined') {
      cells.push(
        this.cardCell(
          strings.variableNoneActive,
          originX,
          y,
          tableWidth,
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
      cells.push(
        memoryNodeOf(
          {
            ...segment,
            x: originX,
            y,
            collapsed: false,
          },
          { collapsible: false, title: false }
        )
      );
      y += segment.height - segment.titleHeight;
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + tableWidth + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  /** Every store the run has made, grouped by the object it wrote to. */
  private mutationSectionCells(
    model: StepModel,
    originX: number,
    originY: number,
    tableWidth: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.viewMutations,
        originX,
        originY,
        'mutations',
        tableWidth
      ),
    ];
    if (this.collapsed.has('mutations')) {
      return cells;
    }

    const table = mutationTableCells(
      model.mutations,
      originX,
      originY + HEADING_HEIGHT + HEADING_GAP,
      tableWidth,
      this.folds
    );
    cells.push(...table.cells);
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + table.width + ORIGIN_X
    );
    this.contentHeight = Math.max(
      this.contentHeight,
      originY + HEADING_HEIGHT + HEADING_GAP + table.height + ORIGIN_X
    );
    return cells;
  }

  /** A teaching card: title, context, one explanation, then produced values. */
  private statementCardCells(
    card: StatementCardModel,
    originX: number,
    originY: number,
    columnWidth: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [];
    let y = originY;

    cells.push(
      this.cardCell(card.title, originX, y, columnWidth, CARD_TITLE_HEIGHT, {
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
        columnWidth,
        CARD_CONTEXT_HEIGHT
      );
      cells.push(
        this.cardCell(card.context, originX, y, columnWidth, contextHeight, {
          fill: 'var(--plivet-graph-caption, #f7f9fb)',
          stroke: 'var(--plivet-graph-grid, #cfd8e1)',
          color: 'var(--plivet-graph-context-text, #5d6b78)',
          fontSize: 12,
        })
      );
      y += contextHeight;
    }

    if (card.descriptionRows !== undefined) {
      for (const row of card.descriptionRows) {
        const rendered = this.cardRow(row, originX, y, columnWidth);
        cells.push(...rendered.cells);
        y = rendered.bottom;
      }
    } else if (card.description !== '') {
      const descriptionHeight = this.cardTextHeight(
        card.description,
        columnWidth,
        CARD_DESCRIPTION_HEIGHT
      );
      cells.push(
        this.cardCell(
          card.description,
          originX,
          y,
          columnWidth,
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
          columnWidth,
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
        const rendered = this.cardRow(row, originX, y, columnWidth);
        cells.push(...rendered.cells);
        y = rendered.bottom;
      }
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + columnWidth + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  private cardRow(
    row: StatementCardRow,
    originX: number,
    originY: number,
    columnWidth: number
  ): { cells: dia.Cell[]; bottom: number } {
    if (row.value === '') {
      const height = this.cardRowHeight(row.label, columnWidth);
      return {
        cells: [
          this.cardCell(row.label, originX, originY, columnWidth, height, {
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

    const valueWidth = columnWidth - CARD_LABEL_WIDTH;
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
