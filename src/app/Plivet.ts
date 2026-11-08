// A default import: webpack warns that a JSON module's named exports are on
// their way out, and only the default is guaranteed.
import packageJson from '../../package.json';
import {
  CONTROL_EVENT,
  DEBUG_STATE,
  InterpreterClient,
  StepModel,
  emptyStepModel,
} from '../core';
import { PlivetShell, STACKED_BELOW } from '../ui/shell';
import type { ShellLayout, ShellLayoutMode } from '../ui/shell';
import type { ProgramSessionJSON, SessionJSON } from '../ui/editor';
import type { SourceFile, ViewSelection } from '../core';
import type { StatementExplanation } from '../ui/records';
import { isSession } from '../ui/editor';
import {
  ControlBar,
  ZOOM_COMMAND,
  enablementFor,
  runCommand,
  stepCommand,
} from '../ui/controls';
import { ConsoleSpan, PlivetConsole } from '../ui/console';
import { DebuggerDock } from '../ui/debugger';
import { BreakpointTable } from '../ui/breakpoints';
import type { BreakpointEntry } from '../ui/breakpoints';
import { PlivetGraph } from '../ui/graph';
import type {
  DebugPosition,
  DiagnosticActivity,
  DiagnosticEntry,
  RunStatus,
} from '../ui/graph';
import { FilePanel, download } from '../ui/files';
import { HowToDialog } from '../ui/help';
import type { PreprocessedDialog } from '../ui/preprocessed';
import strings from '../strings';
import { EditorController } from './EditorController';
import { Bus } from './emitter';
import { Theme, isDark } from './theme';
import type {
  CodeMirrorConfig,
  DiagnosticOptions,
  DiagnosticProvider,
  ExternalDiagnostic,
  SourceSnapshot,
  Unsubscribe,
} from './host';
import type { EditableRegionsOption, LoadRefusal } from './protection';
import { joinArgs, programArgsOption, splitArgs } from './programArgs';

/**
 * The optional parts of PLIVET a page chooses before it opens.
 *
 * They are features rather than view options because they are not about what
 * the canvas draws: each one is a whole capability - a dialog, a panel - that
 * a course page either wants in front of a reader or does not. Preprocessor
 * and runtime data-file loading default on; replacing source through Load
 * defaults off and must be enabled explicitly.
 */
export interface PlivetFeatures {
  /** The button that shows the text the compiler sees after the preprocessor. */
  preprocessor?: boolean;
  /** Allow Load to replace the editor with a source file or saved session. */
  loadSource?: boolean;
  /**
   * The upload panel under the console: the data files a running program can
   * `fopen`. A page whose exercises read no files leaves it out.
   */
  loadFile?: boolean;
  /**
   * A field in the control bar holding the program's arguments, which the
   * reader may edit; an edit applies at the next Start or Run. Off by
   * default: the `args` option still applies without it.
   */
  programArgs?: boolean;
}

/**
 * Control-bar items a host drives itself and so takes off the bar. A hidden
 * item is not built at all - absent from the DOM, not disabled - and the
 * method behind it (`setTheme`, `setFontSize`) still works. Left out, every
 * item is there.
 */
export interface PlivetControls {
  /** The light/dark switch. */
  theme?: boolean;
  /** The three text-size buttons. */
  textSize?: boolean;
}

/** How the boxes are arranged: side by side, or one above the other. */
export type PlivetLayout = ShellLayout;

/** The `layout` option: one of the two arrangements, or `auto`. */
export type PlivetLayoutMode = ShellLayoutMode;

/**
 * One PLIVET: a shell, six widgets, and the bus and interpreter between them.
 *
 * It was `PlivetApp`, and before that `AppContainer` and `App` - one holding
 * the theme, the other holding a Bootstrap grid - plus `EditorSide`, `Menu`,
 * `Console`, `Graph` and `FileForm`, whose entire content was a mount point
 * and a subscription. The widgets under `src/ui/` never knew about React, so
 * what came out here is the wiring rather than a rewrite.
 *
 * Nothing it uses is the page's any more. The bus and the interpreter client
 * are constructed here and passed down, which is the point of it: two of
 * these on one page own two Workers and two buses, so stepping one does not
 * move the other. This is the only public entry - `new Plivet(element)` builds
 * everything below it, and `destroy()` takes it all back down again.
 */
export interface PlivetOptions {
  /** One program instead of the default three-file construct tour. */
  sourceCode?: string;
  /**
   * Several files instead of one, drawn as tabs over the editor and composed
   * into the interpreter's teaching translation unit. `entry`, or the first,
   * is the tab that opens and contains `main`. This is the shape a block of the
   * interactive-code directive has, and the reason the Worker protocol carries
   * a named set of files rather than a string.
   */
  files?: SourceFile[];
  /** Which of `files` opens as the runnable entry. Defaults to the first. */
  entry?: string;
  /** Which theme to open in. The switch in the control bar changes it after. */
  theme?: Theme;
  /** Optional capabilities. Source loading and program arguments default off. */
  features?: PlivetFeatures;
  /**
   * The program's arguments, `argv[1]` onwards: an array of strings, or one
   * string split as a shell splits a command line (`'a "b c"'` is `a` and
   * `b c`). `int main(int argc, char *argv[])` receives them, with `argv[0]`
   * the entry file's name without `.c`; a `main` without parameters ignores
   * them. Left out, none. `features.programArgs` lets the reader change them.
   */
  args?: string[] | string;
  /** Whether to show the copyright and licence footer. Defaults to true. */
  footer?: boolean;
  /**
   * What the canvas opens with drawn. The View panel still holds the switches,
   * so this is where the reader starts rather than what they are held to.
   */
  views?: ViewSelection;
  /**
   * The parts of the program the reader may edit. Left out, all of it. This
   * is how a page hands over a fill-in-the-blank exercise: everything outside
   * these spans is fixed, and the filter that holds them is the editor's own
   * behaviour rather than an instruction in a comment.
   *
   * Either `{ from, to }` offsets into the entry file (`sourceCode`, or the
   * entry of `files`), or 1-based inclusive line ranges per file path, the
   * syntax of the Sphinx `:editable-lines:` option:
   * `{ "main.c": [[7, 12], [20, 20]] }`. A file's entry may also be
   * `{ "lines": [[7, 12]], "text": "..." }`, where `text` is the default
   * source the lines count: the file's own text is then checked against the
   * segments cut from it, and "Restore default" puts it back.
   *
   * Either way the text between the editable ranges is the file's protected
   * segments, found again by their exact text whenever the file is replaced;
   * a replacement that has lost one is refused (`onLoadRefused`).
   */
  editableRegions?: EditableRegionsOption;
  /**
   * A session to open with, applied after `files`: a version 1 session
   * applies to the entry file, a version 2 one to every file it names that
   * is one of `files` (the others are ignored). A file's text is replaced
   * only where the session's text keeps the file's protected segments; the
   * cursor, breakpoints and pinned watches are applied to the text the file
   * ends up with, and those that no longer fit it are dropped.
   */
  session?: SessionJSON;
  /** Control-bar items to leave off, for a host that drives them itself. */
  controls?: PlivetControls;
  /**
   * How the editor, console and canvas are arranged: `columns` side by side,
   * `stacked` one above the other, or `auto` - stacked while the
   * visualizer's own width, which is its container's, is below
   * `stackedBelow`. Default `auto`. The visualizer measures its box, not the
   * window, so a host should give it a width (block-level, or `width: 100%`)
   * rather than let it size itself to its content.
   */
  layout?: PlivetLayoutMode;
  /**
   * The width in pixels below which `auto` stacks. Default 720. Going back
   * to two columns takes 48 pixels more, so a width on the threshold does not
   * switch back and forth.
   */
  stackedBelow?: number;
  /**
   * How the editor is built: indentation, the line-number gutter, bracket
   * matching, completion and text size. A host page that has editors of its
   * own hands over the configuration it built those with, so the window a
   * reader opens from one of them types the way the block they left did. Left
   * out, the editor's own defaults.
   */
  codeMirror?: CodeMirrorConfig;
  /**
   * Where the footer's licence report is. A deployed bundle ships the report
   * beside itself, under the host's assets, rather than beside the page that
   * includes it. Left out, the page-relative `./licenses.html` the standalone
   * build writes.
   */
  licenses?: string;
  /** Called after any file text, file set or entry-file change. */
  onSourceChange?: (snapshot: SourceSnapshot) => void;
  /** Called with the final source when the visualizer's window is closing. */
  onWindowClose?: (snapshot: SourceSnapshot) => void;
  /** Called when the visible source tab changes. */
  onActiveFileChange?: (path: string) => void;
  /**
   * Called when a replacement of a file's text is refused because it would
   * change protected text: by `updateFiles`, `restoreSession`, the `session`
   * option, the Load control, or - origin `files` - a file handed over
   * already altered against the default its lines count.
   */
  onLoadRefused?: (refusal: LoadRefusal) => void;
  /** Add the host-backed Build button. Requires `diagnosticProviders`. */
  supportBuild?: boolean;
  /** Compiler callbacks supplied by the host, keyed by diagnostic source. */
  diagnosticProviders?: Record<string, DiagnosticProvider>;
}

/**
 * A session if the text is one, and null for anything else - a C program, an
 * empty file, half a download. Nothing is thrown: a file that is not a
 * session is not an error, it is a program.
 */
const parseSession = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The `layout` option, if it is one. Like `session` below, a value from a
 * programmatic host is checked rather than trusted: anything else is dropped
 * with a warning, and the instance arranges itself as `auto` would.
 */
const layoutOption = (value: unknown): PlivetLayoutMode | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value !== 'auto' && value !== 'columns' && value !== 'stacked') {
    console.warn(
      'c-visualizer: layout must be "auto", "columns" or "stacked" and was ignored'
    );
    return undefined;
  }
  return value;
};

/** The `stackedBelow` option, if it is a width: a number of pixels, 0 or more. */
const stackedBelowOption = (value: unknown): number => {
  if (typeof value === 'undefined') {
    return STACKED_BELOW;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    console.warn(
      'c-visualizer: stackedBelow must be a number of pixels, 0 or more, and was ignored'
    );
    return STACKED_BELOW;
  }
  return value;
};

/**
 * The `session` option, if it is one. A programmatic host is trusted with
 * its types no more than a configuration element is: a value that is not a
 * session is dropped with a warning and the instance opens without it.
 */
const sessionOption = (value: unknown): SessionJSON | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isSession(value)) {
    console.warn('c-visualizer: session is not a session and was ignored');
    return undefined;
  }
  return value;
};

export class Plivet {
  private readonly bus = new Bus();
  private readonly client = new InterpreterClient();
  private readonly shell: PlivetShell;
  private readonly controls: ControlBar;
  private readonly editor: EditorController;
  private readonly debugger: DebuggerDock;
  private readonly breakpointTable: BreakpointTable;
  private readonly console: PlivetConsole;
  private readonly graph: PlivetGraph;
  /** Null where the page has switched the upload panel off. */
  private readonly files: FilePanel | null;
  private readonly help: HowToDialog;
  /** The browsing context this instance belongs to, if it has one. */
  private readonly lifecycleWindow: Window | null;
  private readonly onWindowClose?: (snapshot: SourceSnapshot) => void;
  /**
   * Built on the first press and kept after it. `@codemirror/merge` and the
   * preprocessor are a chunk of their own: a reader who never asks what the
   * preprocessor did never downloads the answer.
   */
  private preprocessed: PreprocessedDialog | null = null;
  private readonly diagnosticProviders = new Map<string, DiagnosticProvider>();
  private debugState: DEBUG_STATE = 'Stop';
  private stdinCommand: CONTROL_EVENT = 'StepAll';
  private theme: Theme;
  private readonly themeListeners = new Set<(theme: Theme) => void>();
  private readonly layoutListeners = new Set<(layout: PlivetLayout) => void>();
  private breakpointCount = 0;
  /** What the next run hands `main`, `argv[1]` onwards. */
  private programArgs: string[] = [];

  constructor(parent: HTMLElement, options: PlivetOptions = {}) {
    this.theme = options.theme ?? 'light';
    this.programArgs =
      programArgsOption(options.args, (message) =>
        console.warn(`c-visualizer: ${message}, and was ignored`)
      ) ?? [];
    this.lifecycleWindow = parent.ownerDocument.defaultView;
    this.onWindowClose = options.onWindowClose;
    const features = options.features ?? {};
    const { bus, client } = this;
    for (const [source, provider] of Object.entries(
      options.diagnosticProviders ?? {}
    )) {
      this.registerDiagnosticProvider(source, provider);
    }
    if (options.supportBuild === true && this.diagnosticProviders.size === 0) {
      throw new Error(
        'support-build requires at least one diagnostic provider from the host'
      );
    }

    this.shell = new PlivetShell(parent, {
      version: packageJson.version,
      fromYear: 2026,
      dark: isDark(this.theme),
      files: features.loadFile !== false,
      footer: options.footer !== false,
      licenses: options.licenses,
      layout: layoutOption(options.layout),
      stackedBelow: stackedBelowOption(options.stackedBelow),
      onLayoutChange: (layout) => this.layoutChanged(layout),
    });

    this.controls = new ControlBar(this.shell.controls, {
      onDebug: (command) => this.signalDebug(command),
      onZoom: (command: ZOOM_COMMAND) => bus.signal('zoom', command),
      onTheme: (dark) => bus.signal('changeTheme', dark ? 'dark' : 'light'),
      onHelp: () => this.help.open(),
      onPreprocessed: () => void this.showPreprocessed(),
      onOpenFile: (file: File) => void this.openFile(file),
      onSaveCode: () => this.saveCode(),
      load: features.loadSource === true,
      onBuild:
        options.supportBuild === true
          ? () => {
              void this.requestDiagnostics().catch((error: unknown) =>
                console.error(error)
              );
            }
          : undefined,
      dark: isDark(this.theme),
      preprocessor: features.preprocessor !== false,
      build: options.supportBuild === true,
      theme: options.controls?.theme !== false,
      textSize: options.controls?.textSize !== false,
      programArgs: features.programArgs === true,
      // The host's own spelling where it wrote a line, so its quoting stays.
      args:
        typeof options.args === 'string'
          ? options.args
          : joinArgs(this.programArgs),
      onArgs: (text) => {
        this.programArgs = splitArgs(text);
      },
    });

    this.editor = new EditorController(this.shell.editor, {
      bus,
      client,
      dark: isDark(this.theme),
      doc: options.sourceCode,
      files: options.files,
      entry: options.entry,
      editableRegions: options.editableRegions,
      session: sessionOption(options.session),
      codeMirror: options.codeMirror,
      onSourceChange: options.onSourceChange,
      onActiveFileChange: options.onActiveFileChange,
      onLoadRefused: options.onLoadRefused,
      programArgs: () => this.programArgs,
    });
    this.controls.setDebugToolbarTabs(this.editor.tabBarElement);

    this.debugger = new DebuggerDock(this.shell.debugger);
    this.breakpointTable = new BreakpointTable(this.debugger.breakpoints, {
      onEnabled: (path, line, enabled) =>
        this.editor.setBreakpointEnabled(path, line, enabled),
      onRemove: (path, line) => this.editor.removeBreakpoint(path, line),
      onNavigate: (path, line) => this.editor.navigateToBreakpoint(path, line),
      onAllEnabled: (enabled) => this.editor.setAllBreakpointsEnabled(enabled),
    });
    this.console = new PlivetConsole(this.debugger.console, {
      dark: isDark(this.theme),
      heading: false,
      onReveal: () => this.debugger.showConsole(),
      inputHint: strings.consoleInputHint,
      inputLabel: strings.consoleInputLabel,
      // Resume rather than single-step: the run stops at the next read, at a
      // breakpoint or at EOF, so the console re-opens on its own for the next
      // value instead of waiting for a Step press that is easy to miss.
      onInput: (text: string) => this.signalDebug(this.stdinCommand, text),
      // The same resume, telling the waiting read that the input has ended.
      onEndOfInput: (text: string) =>
        this.signalDebug(this.stdinCommand, text, true),
    });

    this.graph = new PlivetGraph(this.shell.main, {
      model: emptyStepModel(),
      dark: isDark(this.theme),
      views: options.views,
      onFocus: (object: string | null) =>
        bus.signal('focusObject', object, 'graph'),
      onNavigate: (target) => bus.signal('navigateMemory', target),
    });

    // The panel and the box it mounts into go together: with the feature off
    // there is no panel to build and no room given up to it.
    this.files =
      features.loadFile === false
        ? null
        : new FilePanel(this.shell.files, {
            onUpload: (files: FileList) => this.upload(files),
            onDelete: (filename: string) =>
              this.files?.setFiles(client.delete(filename)),
          });
    client.onFilesChanged = (files, created) => {
      this.files?.setFiles(files);
      if (created) {
        this.files?.expand();
      }
    };

    this.help = new HowToDialog(this.shell.root);

    bus.slot('changeTheme', (theme: Theme) => this.setTheme(theme));
    bus.slot(
      'changeState',
      (
        debugState: DEBUG_STATE,
        _step: number,
        position?: DebugPosition | null
      ) => {
        this.debugState = debugState;
        this.controls.setDebugState(debugState);
        // The canvas clears its state views while nothing is running, and its
        // status line says what the debugger is doing while something is -
        // which line it has stopped on, and whether a mark stopped it there.
        this.graph.setDebugState(debugState, position ?? null);
      }
    );
    bus.slot('diagnostics', (entries: DiagnosticEntry[]) =>
      this.graph.setDiagnostics(entries)
    );
    bus.slot('diagnosticActivity', (activity: DiagnosticActivity) =>
      this.graph.setDiagnosticActivity(activity)
    );
    bus.slot('runStatus', (status: RunStatus) =>
      this.graph.setRunStatus(status)
    );
    bus.slot('breakpoints', (entries: BreakpointEntry[]) => {
      const reveal = this.breakpointCount === 0 && entries.length !== 0;
      this.breakpointCount = entries.length;
      this.debugger.setBreakpointCount(entries.length);
      this.breakpointTable.setBreakpoints(entries);
      if (reveal) {
        this.debugger.showBreakpoints();
      }
    });
    bus.slot('changeOutput', (output: string, errorSpans?: ConsoleSpan[]) =>
      this.console.setOutput(output, errorSpans)
    );
    bus.slot('changeState', (debugState: DEBUG_STATE) =>
      // Typable exactly while the program is blocked on a read.
      this.console.setAccepting(debugState === 'stdin')
    );
    bus.slot('draw', (model: StepModel, explanation: StatementExplanation) => {
      this.graph.render(model, explanation);
    });
    // The editor's tooltip lights up the row the canvas draws for the same
    // object. What the canvas said itself comes back here and is ignored.
    bus.slot(
      'focusObject',
      (object: string | null, origin: 'editor' | 'graph') => {
        if (origin !== 'graph') {
          this.graph.setFocus(object);
        }
      }
    );
    this.shell.root.addEventListener('keydown', this.debugShortcut);
    const initialBreakpoints = this.editor.breakpointEntries();
    this.breakpointCount = initialBreakpoints.length;
    this.debugger.setBreakpointCount(initialBreakpoints.length);
    this.breakpointTable.setBreakpoints(initialBreakpoints);
    if (typeof this.onWindowClose !== 'undefined') {
      // Unlike `unload`, `pagehide` also works when the page enters the
      // back-forward cache. The callback must remain synchronous: browsers do
      // not wait for asynchronous work while a browsing context is leaving.
      this.lifecycleWindow?.addEventListener('pagehide', this.windowClosing);
    }
  }

  /**
   * A file the reader chose: a program, or a session saved from here.
   *
   * Which one it is, is decided by reading it rather than by its name: a
   * session is JSON and a C program is not, and a reader who renamed either
   * still gets what is in the file. Anything that is neither is refused with
   * a sentence rather than half-loaded.
   */
  private async openFile(file: File): Promise<void> {
    const text = await file.text();
    const parsed = parseSession(text);
    if (parsed !== null) {
      // JSON, so it was meant to be a session. One this version cannot read
      // is refused rather than dropped into the editor as text; one that
      // would change protected text is refused by the editor, which says so
      // over itself.
      if (!isSession(parsed)) {
        alert(strings.openedNotCode);
        return;
      }
      this.editor.restoreSession(parsed, 'load');
      return;
    }
    if (text.trim() === '') {
      alert(strings.openedNotCode);
      return;
    }
    // Beside what is open rather than over it: a reader who opens a second
    // file has two files, and which of them runs is theirs to say. A file of
    // the same name as a protected one must keep its protected text.
    this.editor.openInTab(file.name, text, 'load');
  }

  /**
   * The program, written out. The name is the file's if the reader opened
   * one, so saving what was opened gives back a file of the same name.
   */
  private saveCode(): void {
    // The file on the screen, under its own name: with several open, saving
    // the entry while looking at another one would be a surprise.
    download(this.editor.active(), this.editor.code(), 'text/x-csrc');
  }

  /**
   * The session, for a page that wants to store it or hand it in: every
   * file with its text, its cursor, its breakpoints (the disabled ones too)
   * and its pinned names, the entry and the file on screen, as version 2
   * JSON that survives `JSON.stringify`.
   */
  session(): ProgramSessionJSON {
    return this.editor.session();
  }

  /** Every source file exactly as it stands now, for saving or submission. */
  sourceSnapshot(): SourceSnapshot {
    return this.editor.sourceSnapshot();
  }

  onSourcesChanged(listener: (snapshot: SourceSnapshot) => void): Unsubscribe {
    return this.editor.onSourcesChanged(listener);
  }

  onActiveFileChanged(listener: (path: string) => void): Unsubscribe {
    return this.editor.onActiveFileChanged(listener);
  }

  /**
   * Replace the complete program after a host-side load or update. False
   * when the set is invalid, or when it would change a file's protected text;
   * the editor then keeps everything it had.
   */
  updateFiles(files: SourceFile[], entry?: string): boolean {
    return this.editor.updateFiles(files, entry);
  }

  /** Supply already-normalized findings without registering a provider. */
  setDiagnostics(
    source: string,
    diagnostics: ExternalDiagnostic[],
    options: DiagnosticOptions = {}
  ): boolean {
    return this.editor.setExternalDiagnostics(
      source.trim(),
      diagnostics,
      options
    );
  }

  clearDiagnostics(source: string): void {
    this.editor.clearExternalDiagnostics(source);
  }

  /**
   * Register the host callback that submits source to one compiler service.
   * The returned function unregisters only this exact provider.
   */
  registerDiagnosticProvider(
    source: string,
    provider: DiagnosticProvider
  ): Unsubscribe {
    const name = source.trim();
    if (name === '') {
      throw new Error('A diagnostic provider needs a non-empty source name');
    }
    this.diagnosticProviders.set(name, provider);
    return () => {
      if (this.diagnosticProviders.get(name) === provider) {
        this.diagnosticProviders.delete(name);
        this.clearDiagnostics(name);
      }
    };
  }

  /**
   * Ask one registered provider, or all of them, to compile the current files.
   * False means no provider existed or every returned answer had gone stale.
   */
  async requestDiagnostics(source?: string): Promise<boolean> {
    let providers = Array.from(this.diagnosticProviders.entries());
    if (typeof source !== 'undefined') {
      const provider = this.diagnosticProviders.get(source);
      providers =
        typeof provider === 'undefined' ? [] : [[source, provider] as const];
    }
    if (providers.length === 0) {
      return false;
    }
    const snapshot = this.sourceSnapshot();
    // A compile is a round trip to the course's own grader, so the canvas is
    // told that one is under way before it is waited on, and told again
    // however it ends. A build that failed still ended: leaving the line
    // reading "Build started" would be the one state the reader cannot act
    // on, which is the state this line exists to prevent.
    this.bus.signal('diagnosticActivity', 'buildStarted');
    try {
      const results = await Promise.all(
        providers.map(async ([name, provider]) => {
          const diagnostics = await provider(snapshot);
          // A provider replaced while this answer was in flight no longer owns
          // the diagnostic source, even if the program itself did not change.
          if (this.diagnosticProviders.get(name) !== provider) {
            return false;
          }
          if (!Array.isArray(diagnostics)) {
            throw new TypeError('A diagnostic provider must return an array');
          }
          return this.setDiagnostics(name, diagnostics, {
            revision: snapshot.revision,
          });
        })
      );
      return results.some(Boolean);
    } finally {
      this.bus.signal('diagnosticActivity', 'buildComplete');
    }
  }

  /**
   * Puts a saved session back, version 1 or 2. What arrives from outside is
   * checked rather than trusted - it may be another version's, another
   * tool's, or half of one - and a value that is not a session is refused
   * rather than half applied. So is one whose text would change a file's
   * protected text: false, the editor keeps its text, and `onLoadRefused`
   * is told which file and line. A version 2 session that names none of the
   * open files has nothing to restore, and is false too.
   */
  restoreSession(session: unknown): boolean {
    if (!isSession(session)) {
      return false;
    }
    return this.editor.restoreSession(session);
  }

  /**
   * The program beside the text the compiler is given.
   *
   * The pass runs here rather than in the Worker because it is a
   * source-to-source pass over the named source set, and asking the interpreter
   * for it would mean a round trip and a new message for an answer this side
   * can work out while the dialog is opening.
   */
  private async showPreprocessed(): Promise<void> {
    const snapshot = this.editor.sourceSnapshot();
    const source =
      snapshot.files.find((file) => file.path === snapshot.entry)?.text ??
      this.editor.code();
    // prettier-ignore
    const [{ PreprocessedDialog }, { preprocessFiles }] = await Promise.all([
      import(/* webpackChunkName: "preprocessed" */ '../ui/preprocessed'),
      import(/* webpackChunkName: "preprocessed" */ '../interpreter/preprocess'),
    ]);
    if (this.preprocessed === null) {
      this.preprocessed = new PreprocessedDialog(this.shell.root, {
        dark: isDark(this.theme),
      });
    }
    this.preprocessed.open(
      source,
      preprocessFiles(snapshot.files, snapshot.entry, source, (header) =>
        strings.preprocessedHeaderOmitted.replace('{header}', header)
      )
    );
  }

  destroy(): void {
    // The interpreter first: its Worker is the one thing that goes on running
    // after the widgets it reports to have gone.
    this.client.destroy();
    this.lifecycleWindow?.removeEventListener('pagehide', this.windowClosing);
    this.shell.root.removeEventListener('keydown', this.debugShortcut);
    this.diagnosticProviders.clear();
    this.themeListeners.clear();
    this.layoutListeners.clear();
    this.bus.destroy();
    this.help.destroy();
    this.preprocessed?.destroy();
    this.files?.destroy();
    this.graph.destroy();
    this.console.destroy();
    this.breakpointTable.destroy();
    this.debugger.destroy();
    this.editor.destroy();
    this.controls.destroy();
    this.shell.destroy();
  }

  /** Hand the host one coherent, final view before this window goes away. */
  private windowClosing = (): void => {
    this.onWindowClose?.(this.sourceSnapshot());
  };

  /**
   * Apply a theme selected by this instance or by its embedding host. The
   * `onThemeChange` listeners hear of it when it is a change, whichever of
   * the two made it - so a host that answers a change by calling this back
   * is not told again.
   */
  setTheme(theme: Theme): void {
    const changed = theme !== this.theme;
    this.theme = theme;
    this.shell.setDark(isDark(theme));
    this.controls.setDark(isDark(theme));
    this.editor.setDark(isDark(theme));
    this.console.setDark(isDark(theme));
    this.graph.setDark(isDark(theme));
    this.preprocessed?.setDark(isDark(theme));
    if (changed) {
      for (const listener of this.themeListeners) {
        listener(theme);
      }
    }
  }

  /** The theme this instance is drawn in now. */
  getTheme(): Theme {
    return this.theme;
  }

  /**
   * Be told when the theme changes: from the control bar's switch or from
   * `setTheme`. The returned function stops only this listener.
   */
  onThemeChange(listener: (theme: Theme) => void): Unsubscribe {
    this.themeListeners.add(listener);
    return () => this.themeListeners.delete(listener);
  }

  /**
   * The editor's text size, in pixels, for a host that drives it from its
   * own preferences. It is also what the Reset text-size button returns to
   * from then on. False, and nothing changes, for a size that is not a
   * positive number.
   */
  setFontSize(px: number): boolean {
    return this.editor.setFontSize(px);
  }

  /** The editor's text size now, in pixels. */
  getFontSize(): number {
    return this.editor.getFontSize();
  }

  /**
   * How the editor, console and canvas are arranged now: `columns` or
   * `stacked`. With `layout: 'auto'` it follows the visualizer's width.
   */
  getLayout(): PlivetLayout {
    return this.shell.layout();
  }

  /**
   * Be told when the arrangement changes, after it has. Not called for the
   * one the instance opens with, which `getLayout` reports. The returned
   * function stops only this listener.
   */
  onLayoutChange(listener: (layout: PlivetLayout) => void): Unsubscribe {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  /**
   * Nothing is rebuilt when the shell changes arrangement: the editor, the
   * console and the canvas stay in the boxes they were mounted in, with
   * their scroll positions, folds and session. Only the floating debug
   * toolbar, which holds a position measured against the old arrangement,
   * has to be put back over the editor.
   */
  private layoutChanged(layout: PlivetLayout): void {
    this.controls.relayout();
    for (const listener of this.layoutListeners) {
      listener(layout);
    }
  }

  /** Debugger function keys, scoped to the PLIVET instance that has focus. */
  private debugShortcut = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const enabled = enablementFor(this.debugState);
    let handled = true;
    switch (event.key) {
      case 'F5':
        if (enabled.StepAll) {
          this.signalDebug(runCommand(this.debugState));
        } else {
          handled = false;
        }
        break;
      case 'F6':
        if (enabled.Step) {
          this.signalDebug(stepCommand(this.debugState));
        } else {
          handled = false;
        }
        break;
      case 'F7':
        if (enabled.StepOver) {
          this.signalDebug('StepOver');
        } else {
          handled = false;
        }
        break;
      case 'F9':
        this.editor.toggleBreakpoint();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private signalDebug(
    command: CONTROL_EVENT,
    stdinText?: string,
    endOfInput?: boolean
  ): void {
    if (command === 'Step' || command === 'StepOver') {
      this.stdinCommand = command;
    } else if (command === 'StepAll' || command === 'Exec') {
      this.stdinCommand = 'StepAll';
    }
    this.bus.signal('debug', command, stdinText, endOfInput);
  }

  private async upload(files: FileList): Promise<void> {
    try {
      this.files?.setFiles(await this.client.upload(files));
      this.files?.clearSelection();
    } catch (e) {
      // TypeScript types a caught value as `unknown`: whatever was thrown need
      // not be an Error, and here it comes from the FileReader.
      console.warn(e instanceof Error ? e.message : e);
      alert('Failed to upload files');
    }
  }
}
