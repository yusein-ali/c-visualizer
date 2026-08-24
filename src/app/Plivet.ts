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
import { PlivetShell } from '../ui/shell';
import type { EditableRegion, SessionJSON } from '../ui/editor';
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
import { PlivetConsole } from '../ui/console';
import { PlivetGraph } from '../ui/graph';
import type {
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

/**
 * The parts of PLIVET a page may switch off before it opens.
 *
 * They are features rather than view options because they are not about what
 * the canvas draws: each one is a whole capability - a dialog, a panel - that
 * a course page either wants in front of a reader or does not. A field left
 * out is on, so the standalone page, which passes none of these, is PLIVET
 * entire.
 */
export interface PlivetFeatures {
  /** The button that shows the text the compiler sees after the preprocessor. */
  preprocessor?: boolean;
  /**
   * The upload panel under the console: the data files a running program can
   * `fopen`. A page whose exercises read no files leaves it out.
   */
  loadFile?: boolean;
}

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
 * are constructed here and passed down, which is what Phase 10 was for: two of
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
  /** What the page has switched off. Everything not named here is on. */
  features?: PlivetFeatures;
  /**
   * What the canvas opens with drawn. The View panel still holds the switches,
   * so this is where the reader starts rather than what they are held to.
   */
  views?: ViewSelection;
  /**
   * The parts of the program the reader may edit, as offsets into
   * `sourceCode`. Left out, all of it. This is how a page hands over a
   * fill-in-the-blank exercise: everything outside these spans is fixed, and
   * the filter that holds them is the editor's own behaviour rather than an
   * instruction in a comment.
   */
  editableRegions?: EditableRegion[];
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

export class Plivet {
  private readonly bus = new Bus();
  private readonly client = new InterpreterClient();
  private readonly shell: PlivetShell;
  private readonly controls: ControlBar;
  private readonly editor: EditorController;
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

  constructor(parent: HTMLElement, options: PlivetOptions = {}) {
    this.theme = options.theme ?? 'light';
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
      licenses: options.licenses,
    });

    this.controls = new ControlBar(this.shell.controls, {
      statusParent: this.shell.status,
      onDebug: (command) => this.signalDebug(command),
      onZoom: (command: ZOOM_COMMAND) => bus.signal('zoom', command),
      onTheme: (dark) => bus.signal('changeTheme', dark ? 'dark' : 'light'),
      onHelp: () => this.help.open(),
      onPreprocessed: () => void this.showPreprocessed(),
      onOpenFile: (file: File) => void this.openFile(file),
      onSaveCode: () => this.saveCode(),
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
    });

    this.editor = new EditorController(this.shell.editor, {
      bus,
      client,
      dark: isDark(this.theme),
      doc: options.sourceCode,
      files: options.files,
      entry: options.entry,
      editableRegions: options.editableRegions,
      codeMirror: options.codeMirror,
      onSourceChange: options.onSourceChange,
      onActiveFileChange: options.onActiveFileChange,
    });
    this.controls.setDebugToolbarTabs(this.editor.tabBarElement);

    this.console = new PlivetConsole(this.shell.console, {
      dark: isDark(this.theme),
      inputHint: strings.consoleInputHint,
      inputLabel: strings.consoleInputLabel,
      // Resume rather than single-step: the run stops at the next read, at a
      // breakpoint or at EOF, so the console re-opens on its own for the next
      // value instead of waiting for a Step press that is easy to miss.
      onInput: (text: string) => this.signalDebug(this.stdinCommand, text),
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

    this.help = new HowToDialog(this.shell.root);

    bus.slot('changeTheme', (theme: Theme) => this.setTheme(theme));
    bus.slot('changeState', (debugState: DEBUG_STATE, step: number) => {
      this.debugState = debugState;
      this.controls.setDebugState(debugState, step);
      // The canvas clears its state views while nothing is running, and its
      // status line says what the debugger is doing while something is.
      this.graph.setDebugState(debugState);
    });
    bus.slot('diagnostics', (entries: DiagnosticEntry[]) =>
      this.graph.setDiagnostics(entries)
    );
    bus.slot('diagnosticActivity', (activity: DiagnosticActivity) =>
      this.graph.setDiagnosticActivity(activity)
    );
    bus.slot('runStatus', (status: RunStatus) =>
      this.graph.setRunStatus(status)
    );
    bus.slot('changeOutput', (output: string) =>
      this.console.setOutput(output)
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
      // is refused rather than dropped into the editor as text.
      if (!this.restoreSession(parsed)) {
        alert(strings.openedNotCode);
      }
      return;
    }
    if (text.trim() === '') {
      alert(strings.openedNotCode);
      return;
    }
    // Beside what is open rather than over it: a reader who opens a second
    // file has two files, and which of them runs is theirs to say.
    this.editor.openInTab(file.name, text);
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
   * The session, for a page that wants to store it or hand it in: the
   * program, the cursor, the breakpoints and the pinned names, as JSON that
   * survives `JSON.stringify`.
   */
  session(): SessionJSON {
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

  /** Replace the complete program after a host-side load or update. */
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
   * Puts a saved session back. What arrives from outside is checked rather
   * than trusted - it may be another version's, another tool's, or half of
   * one - and a value that is not a session is refused rather than half
   * applied.
   */
  restoreSession(session: unknown): boolean {
    if (!isSession(session)) {
      return false;
    }
    this.editor.restore(session);
    return true;
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
      preprocessFiles(snapshot.files, snapshot.entry, source)
    );
  }

  destroy(): void {
    // The interpreter first: its Worker is the one thing that goes on running
    // after the widgets it reports to have gone.
    this.client.destroy();
    this.lifecycleWindow?.removeEventListener('pagehide', this.windowClosing);
    this.shell.root.removeEventListener('keydown', this.debugShortcut);
    this.diagnosticProviders.clear();
    this.bus.destroy();
    this.help.destroy();
    this.preprocessed?.destroy();
    this.files?.destroy();
    this.graph.destroy();
    this.console.destroy();
    this.editor.destroy();
    this.controls.destroy();
    this.shell.destroy();
  }

  /** Hand the host one coherent, final view before this window goes away. */
  private windowClosing = (): void => {
    this.onWindowClose?.(this.sourceSnapshot());
  };

  private setTheme(theme: Theme): void {
    this.theme = theme;
    this.shell.setDark(isDark(theme));
    this.controls.setDark(isDark(theme));
    this.editor.setDark(isDark(theme));
    this.console.setDark(isDark(theme));
    this.graph.setDark(isDark(theme));
    this.preprocessed?.setDark(isDark(theme));
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

  private signalDebug(command: CONTROL_EVENT, stdinText?: string): void {
    if (command === 'Step' || command === 'StepOver') {
      this.stdinCommand = command;
    } else if (command === 'StepAll' || command === 'Exec') {
      this.stdinCommand = 'StepAll';
    }
    this.bus.signal('debug', command, stdinText);
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
