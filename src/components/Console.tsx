import * as React from 'react';

import { slot, signal } from './emitter';
import { Theme } from './Props';
import { DEBUG_STATE } from '../core';
import { PlivetConsole } from '../ui/console';
import strings from '../strings';

interface Props {}
interface State {}

/**
 * The console's place in the application: it shows what the interpreter has
 * printed and sends back what the user types when the program blocks on a
 * read.
 *
 * The console itself is `PlivetConsole` under `src/ui/console`, which knows
 * nothing about React and nothing about the interpreter. This component is the
 * wiring between the two, and it is what Phase 9 deletes.
 */
export default class Console extends React.Component<Props, State> {
  private console: PlivetConsole | null = null;
  private container = React.createRef<HTMLDivElement>();
  private output = '';
  private isAccepting = false;
  private theme: Theme = 'light';

  constructor(props: Props) {
    super(props);

    slot('changeOutput', (output: string) => {
      this.output = output;
      if (this.console !== null) {
        this.console.setOutput(output);
      }
    });
    slot('changeTheme', (theme: Theme) => {
      this.theme = theme;
      if (this.console !== null) {
        this.console.setDark(theme === 'dark');
      }
    });
    slot('changeState', (debugState: DEBUG_STATE) => {
      // Typable exactly while the program is blocked on a read.
      this.isAccepting = debugState === 'stdin';
      if (this.console !== null) {
        this.console.setAccepting(this.isAccepting);
      }
    });
  }

  componentDidMount() {
    if (this.container.current === null) {
      return;
    }
    // The state the bus reported before there was anything to report it to:
    // subscriptions are made in the constructor, a mount later.
    this.console = new PlivetConsole(this.container.current, {
      output: this.output,
      dark: this.theme === 'dark',
      inputHint: strings.consoleInputHint,
      inputLabel: strings.consoleInputLabel,
      onInput: (text: string) => this.submit(text),
    });
    if (this.isAccepting) {
      this.console.setAccepting(true);
    }
  }

  componentWillUnmount() {
    if (this.console !== null) {
      this.console.destroy();
      this.console = null;
    }
  }

  private submit(text: string) {
    // Resume rather than single-step: the run stops at the next read, at a
    // breakpoint or at EOF, so the console re-opens on its own for the next
    // value instead of waiting for a Step press that is easy to miss.
    signal('debug', 'StepAll', text);
  }

  render() {
    return <div ref={this.container} />;
  }
}
