// A default import: webpack warns that a JSON module's named exports are on
// their way out, and only the default is guaranteed.
import packageJson from '../../package.json';
import {
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
import { ControlBar, ZOOM_COMMAND } from '../ui/controls';
import { PlivetConsole } from '../ui/console';
import { PlivetGraph } from '../ui/graph';
import { FilePanel, download } from '../ui/files';
import { HowToDialog } from '../ui/help';
import type { PreprocessedDialog } from '../ui/preprocessed';
import strings from '../strings';
import { EditorController } from './EditorController';
import { Bus } from './emitter';
import { Theme, isDark } from './theme';

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
  /** The program the editor opens with. Defaults to the sample in `strings`. */
  sourceCode?: string;
  /**
   * Several files instead of one, drawn as tabs over the editor. Exactly one
   * of them is the translation unit - `entry`, or the first - and it is the
   * one that runs; the rest are open beside it. This is the shape a block of
   * the interactive-code directive has, and the reason the Worker protocol
   * carries a named set of files rather than a string.
   */
  files?: SourceFile[];
  /** Which of `files` runs. Defaults to the first. */
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
  /**
   * Built on the first press and kept after it. `@codemirror/merge` and the
   * preprocessor are a chunk of their own: a reader who never asks what the
   * preprocessor did never downloads the answer.
   */
  private preprocessed: PreprocessedDialog | null = null;
  private theme: Theme;

  constructor(parent: HTMLElement, options: PlivetOptions = {}) {
    this.theme = options.theme ?? 'light';
    const features = options.features ?? {};
    const { bus, client } = this;

    this.shell = new PlivetShell(parent, {
      version: packageJson.version,
      fromYear: 2026,
      dark: isDark(this.theme),
      files: features.loadFile !== false,
    });

    this.controls = new ControlBar(this.shell.controls, {
      onDebug: (command) => bus.signal('debug', command),
      onZoom: (command: ZOOM_COMMAND) => bus.signal('zoom', command),
      onTheme: (dark) => bus.signal('changeTheme', dark ? 'dark' : 'light'),
      onHelp: () => this.help.open(),
      onPreprocessed: () => void this.showPreprocessed(),
      onOpenFile: (file: File) => void this.openFile(file),
      onSaveCode: () => this.saveCode(),
      dark: isDark(this.theme),
      preprocessor: features.preprocessor !== false,
    });

    this.editor = new EditorController(this.shell.editor, {
      bus,
      client,
      dark: isDark(this.theme),
      doc: options.sourceCode,
      files: options.files,
      entry: options.entry,
      editableRegions: options.editableRegions,
    });

    this.console = new PlivetConsole(this.shell.console, {
      dark: isDark(this.theme),
      inputHint: strings.consoleInputHint,
      inputLabel: strings.consoleInputLabel,
      // Resume rather than single-step: the run stops at the next read, at a
      // breakpoint or at EOF, so the console re-opens on its own for the next
      // value instead of waiting for a Step press that is easy to miss.
      onInput: (text: string) => bus.signal('debug', 'StepAll', text),
    });

    this.graph = new PlivetGraph(this.shell.main, {
      model: emptyStepModel(),
      dark: isDark(this.theme),
      views: options.views,
      onFocus: (object: string | null) =>
        bus.signal('focusObject', object, 'graph'),
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
    bus.slot('changeState', (debugState: DEBUG_STATE, step: number) =>
      this.controls.setDebugState(debugState, step)
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
   * source-to-source pass over one file, and asking the interpreter for it
   * would mean a round trip and a new message for an answer this side can
   * work out while the dialog is opening.
   */
  private async showPreprocessed(): Promise<void> {
    const source = this.editor.code();
    // prettier-ignore
    const [{ PreprocessedDialog }, { preprocess }] = await Promise.all([
      import(/* webpackChunkName: "preprocessed" */ '../ui/preprocessed'),
      import(/* webpackChunkName: "preprocessed" */ '../interpreter/preprocess'),
    ]);
    if (this.preprocessed === null) {
      this.preprocessed = new PreprocessedDialog(this.shell.root, {
        dark: isDark(this.theme),
      });
    }
    this.preprocessed.open(source, preprocess(source));
  }

  destroy(): void {
    // The interpreter first: its Worker is the one thing that goes on running
    // after the widgets it reports to have gone.
    this.client.destroy();
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

  private setTheme(theme: Theme): void {
    this.theme = theme;
    this.shell.setDark(isDark(theme));
    this.controls.setDark(isDark(theme));
    this.editor.setDark(isDark(theme));
    this.console.setDark(isDark(theme));
    this.graph.setDark(isDark(theme));
    this.preprocessed?.setDark(isDark(theme));
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
