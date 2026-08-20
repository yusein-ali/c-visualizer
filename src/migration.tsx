import * as React from 'react';
import * as ReactDOM from 'react-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import AppContainer from './components/AppContainer';

/**
 * The working entry point for Phases 8 and 9.
 *
 * It intentionally starts as the same working application served by
 * `index.tsx`. Replacement graph and shell modules belong behind this entry
 * until the final cutover, so an incomplete migration cannot break the stable
 * page.
 */
ReactDOM.render(<AppContainer />, document.getElementById('root'));
