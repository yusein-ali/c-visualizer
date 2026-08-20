/**
 * The control icons, as inline SVG.
 *
 * They were Bootstrap 3 Glyphicons: an icon font, delivered as four font files
 * and addressed by class name. Dropping Bootstrap took the font with it, and
 * an icon that is nine hundred bytes of markup in the bundle beats one that is
 * a separate request for a typeface with two hundred glyphs in it.
 *
 * Each path is drawn in a 16x16 box and filled with `currentColor`, so the
 * enabled/disabled colours in `controls.css` reach the icon without the button
 * having to say so twice.
 */

export type IconName =
  | 'restart'
  | 'stop'
  | 'rewind'
  | 'stepBack'
  | 'stepForward'
  | 'run'
  | 'zoomOut'
  | 'zoomReset'
  | 'zoomIn'
  | 'download'
  | 'remove';

/*
 * The magnifier, in pieces: an outer circle and an inner one, which the
 * even-odd fill rule turns into a ring, and a handle that starts just clear of
 * the outer edge so it does not punch a notch out of it.
 */
const RING =
  'M6.5 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11zM6.5 2.5a4 4 0 1 0 0 8 4 4 0 1 0 0-8z';
const HANDLE = 'M10.1 11.2l1.1-1.1 3.6 3.6-1.1 1.1z';

const paths: Record<IconName, string> = {
  // A circular arrow: the session starts again from the first statement.
  restart: 'M8 3V0.5L4.5 3.5 8 6.5V4a4 4 0 1 1-4 4H2.5A5.5 5.5 0 1 0 8 3z',
  stop: 'M3 3h10v10H3z',
  // Bar plus two triangles: back past every step there is.
  rewind: 'M2 3h2v10H2zM14 3v10L8.5 8zM8 3v10L2.5 8z',
  stepBack: 'M11 2.5v11L3.5 8z',
  stepForward: 'M5 2.5v11L12.5 8z',
  run: 'M2 3v10l5.5-5zM8 3v10l5.5-5z',
  // The editor's text size: a magnifier with a minus, nothing, or a plus.
  zoomOut: `${RING}${HANDLE}M4 6h5v1H4z`,
  zoomReset: `${RING}${HANDLE}`,
  zoomIn: `${RING}${HANDLE}M6 4h1v2h2v1H7v2H6V7H4V6h2z`,
  // An arrow into a tray, and a waste basket: the two things that can be done
  // to a file that has already been uploaded.
  download:
    'M7.5 1h1v6.8l2.3-2.3.7.7L8 9.7 4.5 6.2l.7-.7 2.3 2.3zM2 11h12v3H2z',
  remove:
    'M6 1h4v1h4v1H2V2h4zM3.5 4h9l-.7 10H4.2zm2 2 .3 6h1l-.3-6zm5 0h-1l-.3 6h1z',
};

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The icon as an element, hidden from assistive technology: every button
 * carries its own accessible name, and the picture would only repeat it badly.
 */
export const iconFor = (name: IconName): SVGSVGElement => {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', paths[name]);
  path.setAttribute('fill', 'currentColor');
  // Every icon that has a hole in it - the magnifiers, the waste basket -
  // draws the hole as a second subpath. Under the default winding rule the
  // two would merge into one solid blob.
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  return svg;
};
