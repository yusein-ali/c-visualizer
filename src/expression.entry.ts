/**
 * `c-expression.js`: the canvas's expression tree, for a page that builds its
 * own trees.
 *
 * The expression playground of the course evaluates C expressions itself and
 * describes each step as an `ExpressionModel` - the shape the interpreter's
 * trace has, documented in the README under the version below. This script
 * draws one with the canvas's layout and boxes and nothing else: no worker,
 * no interpreter, no editor.
 *
 * It is one plain script with no chunks, so a host includes it with one tag
 * and finds the API on `window` as soon as it has run. `CExpressionTreeReady`
 * resolves to the same object, for a host that would rather wait on a
 * promise than check for a global.
 */
import { EXPRESSION_MODEL_VERSION } from './core/model';
import type { ExpressionModel, ExpressionNodeModel } from './core/model';
import {
  ExpressionTree,
  ExpressionTreeOptions,
  ExpressionTreeRenderOptions,
  ExpressionTreeTheme,
} from './ui/graph/ExpressionTree';

/** What `mount` returns: one tree in one element. */
export interface CExpressionTreeHandle {
  /** Draw a tree, replacing the one before; `null` draws nothing. */
  render(
    model: ExpressionModel | ExpressionNodeModel | null,
    options?: ExpressionTreeRenderOptions
  ): void;
  setTheme(theme: ExpressionTreeTheme): void;
  /** Scale the drawing so its labels are this many pixels. */
  setFontSize(px: number): void;
  destroy(): void;
}

export interface CExpressionTreeGlobal {
  /** `EXPRESSION_MODEL_VERSION`: the model shape this script draws. */
  version: number;
  mount(
    element: HTMLElement,
    options?: ExpressionTreeOptions
  ): CExpressionTreeHandle;
}

type ExpressionWindow = Window & {
  CExpressionTree?: CExpressionTreeGlobal;
  CExpressionTreeReady?: Promise<CExpressionTreeGlobal>;
};

const api: CExpressionTreeGlobal = {
  version: EXPRESSION_MODEL_VERSION,
  mount(element, options = {}) {
    const tree = new ExpressionTree(element, options);
    return {
      render: (model, renderOptions) => tree.render(model, renderOptions),
      setTheme: (theme) => tree.setTheme(theme),
      setFontSize: (px) => tree.setFontSize(px),
      destroy: () => tree.destroy(),
    };
  },
};

const scope = window as ExpressionWindow;
scope.CExpressionTree = api;
scope.CExpressionTreeReady = Promise.resolve(api);
