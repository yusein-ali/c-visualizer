import './help.css';
import strings from '../../strings';

const PLIVET_REPOSITORY = 'https://github.com/RYOSKATE/PLIVET';
const THESIS = 'https://urn.fi/URN:NBN:fi:aalto-202309035541';

/**
 * What PLIVET is and how to drive it, in a modal dialog.
 *
 * `HowToUseButton` held a boolean and rendered `HowToUseWindows` when it was
 * true; `HowToUseWindows` was a react-bootstrap `Modal`. The button is part of
 * the control bar now and the modal is a `dialog` element, which brings its
 * own backdrop, focus trap and Escape handling.
 */
export class HowToDialog {
  readonly root: HTMLDialogElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('dialog');
    this.root.className = 'plivet-help';

    const title = document.createElement('h2');
    title.className = 'plivet-help__title';
    title.textContent = strings.howToUse;

    const body = document.createElement('div');
    body.className = 'plivet-help__body';

    const intro = document.createElement('p');
    intro.className = 'plivet-help__intro';
    intro.textContent = strings.howToIntro;
    body.appendChild(intro);

    for (const section of strings.howToSections) {
      const heading = document.createElement('h3');
      heading.textContent = section.title;

      const list = document.createElement('ul');
      for (const text of section.items) {
        const item = document.createElement('li');
        item.textContent = text;
        list.appendChild(item);
      }
      body.append(heading, list);
    }

    const attribution = document.createElement('section');
    attribution.className = 'plivet-help__attribution';
    const attributionTitle = document.createElement('h3');
    attributionTitle.textContent = strings.howToAttribution.title;

    const plivet = document.createElement('p');
    plivet.append(
      document.createTextNode(strings.howToAttribution.plivetBefore),
      this.link(PLIVET_REPOSITORY, strings.howToAttribution.plivetLink),
      document.createTextNode(strings.howToAttribution.plivetAfter)
    );

    const thesis = document.createElement('p');
    thesis.append(
      document.createTextNode(strings.howToAttribution.thesisBefore),
      this.link(THESIS, strings.howToAttribution.thesisLink),
      document.createTextNode(strings.howToAttribution.thesisAfter)
    );

    const current = document.createElement('p');
    current.textContent = strings.howToAttribution.current;
    attribution.append(attributionTitle, plivet, thesis, current);
    body.appendChild(attribution);

    const footer = document.createElement('div');
    footer.className = 'plivet-help__footer';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'plivet-help__close';
    close.textContent = strings.close;
    close.addEventListener('click', () => this.close());
    footer.appendChild(close);

    this.root.append(title, body, footer);
    parent.appendChild(this.root);
  }

  open(): void {
    // `showModal` is what gives the dialog its backdrop and focus trap. It is
    // also the one part of the element jsdom does not implement, so a test
    // environment falls back to the attribute that makes it visible.
    if (typeof this.root.showModal === 'function') {
      this.root.showModal();
      return;
    }
    this.root.setAttribute('open', '');
  }

  close(): void {
    if (typeof this.root.close === 'function') {
      this.root.close();
      return;
    }
    this.root.removeAttribute('open');
  }

  destroy(): void {
    this.root.remove();
  }

  private link(href: string, text: string): HTMLAnchorElement {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    return anchor;
  }
}
