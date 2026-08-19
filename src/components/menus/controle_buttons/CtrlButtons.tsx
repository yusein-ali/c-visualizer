import * as React from 'react';
import ButtonToolbar from 'react-bootstrap/lib/ButtonToolbar';
import ButtonGroup from 'react-bootstrap/lib/ButtonGroup';

import CtrlButton from './CtrlButton';
import { DEBUG_STATE } from '../../../server';
import { enablementFor, runCommand, stepCommand } from './enablement';
import '../../../css/ctrlbuttons.css';

interface Props {
  debugState: DEBUG_STATE;
}

/**
 * The debug controls. Which of them work, and what the two forward buttons
 * mean, is a function of the current debug state alone - see `enablement.ts` -
 * so this component holds no state of its own.
 */
export default class CtrlButtons extends React.Component<Props> {
  render() {
    const { debugState } = this.props;
    const enabled = enablementFor(debugState);
    return (
      <ButtonToolbar style={{ marginTop: '1vh', marginBottom: '1vh' }}>
        <ButtonGroup>
          <CtrlButton
            signal="debug"
            command="Start"
            icon="repeat"
            enable={enabled.Start}
            iconClass={enabled.Start ? 'icon-green' : undefined}
          />
          <CtrlButton
            signal="debug"
            command="Stop"
            icon="stop"
            enable={enabled.Stop}
            iconClass={enabled.Stop ? 'icon-red' : undefined}
          />
          <CtrlButton
            signal="debug"
            command="BackAll"
            icon="backward"
            enable={enabled.BackAll}
            iconClass={enabled.BackAll ? 'icon-blue' : undefined}
          />
          <CtrlButton
            signal="debug"
            command="StepBack"
            icon="arrow-left"
            enable={enabled.StepBack}
            iconClass={enabled.StepBack ? 'icon-blue' : undefined}
          />
          <CtrlButton
            signal="debug"
            command={stepCommand(debugState)}
            icon="arrow-right"
            enable={enabled.Step}
            iconClass={enabled.Step ? 'icon-blue' : undefined}
          />
          <CtrlButton
            signal="debug"
            command={runCommand(debugState)}
            icon="forward"
            enable={enabled.StepAll}
            iconClass={enabled.StepAll ? 'icon-blue' : undefined}
          />
        </ButtonGroup>
        <ButtonGroup>
          <CtrlButton
            signal="zoom"
            command="Out"
            icon="zoom-out"
            enable={true}
          />
          <CtrlButton
            signal="zoom"
            command="Reset"
            icon="search"
            enable={true}
          />
          <CtrlButton signal="zoom" command="In" icon="zoom-in" enable={true} />
        </ButtonGroup>
      </ButtonToolbar>
    );
  }
}
