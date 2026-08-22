/**
 * CodeMirror's shared host surface when an embedding page has none of its own.
 *
 * The deploy build writes these namespaces onto `window.CodeMirror`. The main
 * PLIVET application treats the five packages as externals, so every extension
 * and the view it is attached to use one package identity in either case.
 */
export * as autocomplete from '@codemirror/autocomplete';
export * as commands from '@codemirror/commands';
export * as language from '@codemirror/language';
export * as state from '@codemirror/state';
export * as view from '@codemirror/view';
