import {
  enablementFor,
  isLive,
  runCommand,
  stepCommand,
} from '../src/ui/controls';
import { DEBUG_STATE } from '../src/core';

const states: DEBUG_STATE[] = [
  'Stop',
  'First',
  'Debugging',
  'stdin',
  'Executing',
  'EOF',
];

describe('control button enablement', () => {
  it('answers for all seven buttons in every debug state', () => {
    for (const state of states) {
      const enabled = enablementFor(state);
      expect(Object.values(enabled).every((v) => typeof v === 'boolean')).toBe(
        true
      );
    }
  });

  it('offers nothing but starting when there is no session', () => {
    expect(enablementFor('Stop')).toEqual({
      Start: false,
      Stop: false,
      BackAll: false,
      StepBack: false,
      StepOver: false,
      Step: true,
      StepAll: true,
    });
  });

  it('lets a live session be stopped, however it was started', () => {
    // The regression this covers: a session begun with `Exec` reaches
    // `Debugging` without passing through `First`, and used to arrive with the
    // stop button still disabled and both forward buttons still bound to the
    // commands that restart the program.
    for (const state of states.filter((s) => s !== 'Stop')) {
      expect(enablementFor(state).Stop).toBe(true);
      expect(enablementFor(state).Start).toBe(true);
    }
  });

  it('does not offer stepping backwards before there is a step to undo', () => {
    expect(enablementFor('First').StepBack).toBe(false);
    expect(enablementFor('First').BackAll).toBe(false);
    expect(enablementFor('Debugging').StepBack).toBe(true);
    expect(enablementFor('stdin').StepBack).toBe(true);
    expect(enablementFor('stdin').BackAll).toBe(true);
  });

  it('does not offer stepping forward once the program has ended', () => {
    expect(enablementFor('EOF').Step).toBe(false);
    expect(enablementFor('EOF').StepOver).toBe(false);
    expect(enablementFor('EOF').StepAll).toBe(false);
    expect(enablementFor('EOF').StepBack).toBe(true);
  });

  it('steps within a session and starts one otherwise', () => {
    expect(stepCommand('Stop')).toBe('Start');
    expect(runCommand('Stop')).toBe('Exec');
    for (const state of states.filter((s) => s !== 'Stop')) {
      expect(isLive(state)).toBe(true);
      expect(stepCommand(state)).toBe('Step');
      expect(runCommand(state)).toBe('StepAll');
    }
  });
});
