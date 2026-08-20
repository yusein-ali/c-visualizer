import { EventEmitter } from 'events';
const emitter = new EventEmitter();
emitter.setMaxListeners(20);
export type event =
  | 'debug'
  | 'changeTheme'
  | 'changeState'
  | 'changeOutput'
  | 'zoom'
  | 'draw';
export const slot = (
  event: event,
  listener: (...args: any[]) => void
): EventEmitter => {
  return emitter.on(event, listener);
};
export const signal = (event: event, ...args: any[]): boolean => {
  return emitter.emit(event, ...args);
};
