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
import type { EditableRegion } from '../ui/editor';
import { ControlBar, ZOOM_COMMAND } from '../ui/controls';
import { PlivetConsole } from '../ui/console';
import { PlivetGraph } from '../ui/graph';
import { FilePanel } from '../ui/files';
import { HowToDialog } from '../ui/help';
import strings from '../strings';
import { EditorController } from './EditorController';
import { Bus } from './emitter';
import { Theme, isDark } from './theme';

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
  /** Which theme to open in. The switch in the control bar changes it after. */
  theme?: Theme;
  /**
   * The parts of the program the reader may edit, as offsets into
   * `sourceCode`. Left out, all of it. This is how a page hands over a
   * fill-in-the-blank exercise: everything outside these spans is fixed, and
   * the filter that holds them is the editor's own behaviour rather than an
   * instruction in a comment.
   */
  editableRegions?: EditableRegion[];
}

export class Plivet {
  private readonly bus = new Bus();
  private readonly client = new InterpreterClient();
  private readonly shell: PlivetShell;
  private readonly controls: ControlBar;
  private readonly editor: EditorController;
  private readonly console: PlivetConsole;
  private readonly graph: PlivetGraph;
  private readonly files: FilePanel;
  private readonly help: HowToDialog;
  private theme: Theme;

  constructor(parent: HTMLElement, options: PlivetOptions = {}) {
    this.theme = options.theme ?? 'light';
    const { bus, client } = this;

    this.shell = new PlivetShell(parent, {
      version: packageJson.version,
      fromYear: 2018,
      dark: isDark(this.theme),
    });

    this.controls = new ControlBar(this.shell.controls, {
      onDebug: (command) => bus.signal('debug', command),
      onZoom: (command: ZOOM_COMMAND) => bus.signal('zoom', command),
      onTheme: (dark) => bus.signal('changeTheme', dark ? 'dark' : 'light'),
      onHelp: () => this.help.open(),
      dark: isDark(this.theme),
    });

    this.editor = new EditorController(this.shell.editor, {
      bus,
      client,
      dark: isDark(this.theme),
      doc: options.sourceCode,
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
      onFocus: (object: string | null) =>
        bus.signal('focusObject', object, 'graph'),
    });

    this.files = new FilePanel(this.shell.files, {
      onUpload: (files: FileList) => this.upload(files),
      onDelete: (filename: string) =>
        this.files.setFiles(client.delete(filename)),
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
    bus.slot('draw', (model: StepModel) => this.graph.render(model));
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

  destroy(): void {
    // The interpreter first: its Worker is the one thing that goes on running
    // after the widgets it reports to have gone.
    this.client.destroy();
    this.bus.destroy();
    this.help.destroy();
    this.files.destroy();
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
  }

  private async upload(files: FileList): Promise<void> {
    try {
      this.files.setFiles(await this.client.upload(files));
      this.files.clearSelection();
    } catch (e) {
      // TypeScript types a caught value as `unknown`: whatever was thrown need
      // not be an Error, and here it comes from the FileReader.
      console.warn(e instanceof Error ? e.message : e);
      alert('Failed to upload files');
    }
  }
}
