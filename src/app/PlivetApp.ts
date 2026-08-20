// A default import: webpack warns that a JSON module's named exports are on
// their way out, and only the default is guaranteed.
import packageJson from '../../package.json';
import { DEBUG_STATE, StepModel, emptyStepModel, server } from '../core';
import strings from '../strings';
import { PlivetShell } from '../ui/shell';
import { ControlBar, ZOOM_COMMAND } from '../ui/controls';
import { PlivetConsole } from '../ui/console';
import { PlivetGraph } from '../ui/graph';
import { FilePanel } from '../ui/files';
import { HowToDialog } from '../ui/help';
import { EditorController } from './EditorController';
import { signal, slot } from './emitter';
import { Theme, isDark } from './theme';

/**
 * The application: a shell, six widgets and the bus between them.
 *
 * It was `AppContainer` and `App` - one holding the theme, the other holding a
 * Bootstrap grid - plus `EditorSide`, `Menu`, `Console`, `Graph` and
 * `FileForm`, whose entire content was a mount point and a subscription. The
 * widgets under `src/ui/` never knew about React, so what came out here is the
 * wiring rather than a rewrite.
 *
 * The bus is still module-level; Phase 10 makes it an instance's own, which is
 * what two PLIVETs on one page need. Everything else here is already per
 * instance and takes its mount element from the shell.
 */
export class PlivetApp {
  private readonly shell: PlivetShell;
  private readonly controls: ControlBar;
  private readonly editor: EditorController;
  private readonly console: PlivetConsole;
  private readonly graph: PlivetGraph;
  private readonly files: FilePanel;
  private readonly help: HowToDialog;
  private theme: Theme = 'light';

  constructor(parent: HTMLElement) {
    this.shell = new PlivetShell(parent, {
      version: packageJson.version,
      fromYear: 2018,
      dark: isDark(this.theme),
    });

    this.controls = new ControlBar(this.shell.controls, {
      onDebug: (command) => signal('debug', command),
      onZoom: (command: ZOOM_COMMAND) => signal('zoom', command),
      onTheme: (dark) => signal('changeTheme', dark ? 'dark' : 'light'),
      onHelp: () => this.help.open(),
      dark: isDark(this.theme),
    });

    this.editor = new EditorController(this.shell.editor, isDark(this.theme));

    this.console = new PlivetConsole(this.shell.console, {
      dark: isDark(this.theme),
      inputHint: strings.consoleInputHint,
      inputLabel: strings.consoleInputLabel,
      // Resume rather than single-step: the run stops at the next read, at a
      // breakpoint or at EOF, so the console re-opens on its own for the next
      // value instead of waiting for a Step press that is easy to miss.
      onInput: (text: string) => signal('debug', 'StepAll', text),
    });

    this.graph = new PlivetGraph(this.shell.main, { model: emptyStepModel() });

    this.files = new FilePanel(this.shell.files, {
      onUpload: (files: FileList) => this.upload(files),
      onDelete: (filename: string) =>
        this.files.setFiles(server.delete(filename)),
    });

    this.help = new HowToDialog(this.shell.root);

    slot('changeTheme', (theme: Theme) => this.setTheme(theme));
    slot('changeState', (debugState: DEBUG_STATE, step: number) =>
      this.controls.setDebugState(debugState, step)
    );
    slot('changeOutput', (output: string) => this.console.setOutput(output));
    slot('changeState', (debugState: DEBUG_STATE) =>
      // Typable exactly while the program is blocked on a read.
      this.console.setAccepting(debugState === 'stdin')
    );
    slot('draw', (model: StepModel) => this.graph.render(model));
  }

  destroy(): void {
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
      this.files.setFiles(await server.upload(files));
      this.files.clearSelection();
    } catch (e) {
      // TypeScript types a caught value as `unknown`: whatever was thrown need
      // not be an Error, and here it comes from the FileReader.
      console.warn(e instanceof Error ? e.message : e);
      alert('Failed to upload files');
    }
  }
}
