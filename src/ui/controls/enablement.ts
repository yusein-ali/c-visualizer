import { CONTROL_EVENT, DEBUG_STATE } from '../../core';

/**
 * Which control buttons work in which debug state, and what the two forward
 * buttons mean there.
 *
 * This used to live inside `CtrlButtons.componentWillReceiveProps`, where
 * three of the six cases set only the flags they cared about and left the rest
 * of the state alone. That made enablement depend on the path taken rather
 * than on the state reached: a session begun with `Exec` never passes through
 * `First` - the editor swallows the `Executing` response it gets back - so
 * `Stop` stayed false, and both forward buttons kept the commands they carry
 * before a session exists. Stepping at a breakpoint restarted the program, and
 * continuing ran it from the beginning to the same breakpoint again.
 *
 * The mapping is therefore total: every state answers for all seven buttons.
 */
export interface Enablement {
  Start: boolean;
  Stop: boolean;
  BackAll: boolean;
  StepBack: boolean;
  StepOver: boolean;
  Step: boolean;
  StepAll: boolean;
}

/** True while the interpreter holds a session, whatever started it. */
export const isLive = (debugState: DEBUG_STATE): boolean =>
  debugState !== 'Stop';

export const enablementFor = (debugState: DEBUG_STATE): Enablement => {
  switch (debugState) {
    case 'First':
      // The session is armed at the first statement: there is nothing behind
      // it to step back to.
      return {
        Start: true,
        Stop: true,
        BackAll: false,
        StepBack: false,
        StepOver: true,
        Step: true,
        StepAll: true,
      };
    case 'Debugging':
      return {
        Start: true,
        Stop: true,
        BackAll: true,
        StepBack: true,
        StepOver: true,
        Step: true,
        StepAll: true,
      };
    case 'stdin':
      // Blocked on input. Stepping resumes the read; stepping backwards over
      // it would have to un-consume the input, so it is not offered.
      return {
        Start: true,
        Stop: true,
        BackAll: false,
        StepBack: false,
        StepOver: false,
        Step: true,
        StepAll: true,
      };
    case 'Executing':
      // A run is in flight. Only stopping and restarting are meaningful.
      return {
        Start: true,
        Stop: true,
        BackAll: false,
        StepBack: false,
        StepOver: false,
        Step: false,
        StepAll: false,
      };
    case 'EOF':
      // The program is over: it can be rewound, but not advanced.
      return {
        Start: true,
        Stop: true,
        BackAll: true,
        StepBack: true,
        StepOver: false,
        Step: false,
        StepAll: false,
      };
    case 'Stop':
    default:
      // No session. The two forward buttons are what starts one.
      return {
        Start: false,
        Stop: false,
        BackAll: false,
        StepBack: false,
        StepOver: false,
        Step: true,
        StepAll: true,
      };
  }
};

/** The arrow: one step forward, or the command that begins a session. */
export const stepCommand = (debugState: DEBUG_STATE): CONTROL_EVENT =>
  isLive(debugState) ? 'Step' : 'Start';

/** The double arrow: continue to the next breakpoint, or start and run to it. */
export const runCommand = (debugState: DEBUG_STATE): CONTROL_EVENT =>
  isLive(debugState) ? 'StepAll' : 'Exec';
