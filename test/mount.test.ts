import {
  LEGACY_MOUNT_ELEMENT_ID,
  MOUNT_ELEMENT_ID,
  findMount,
  mount,
  whenReady,
} from '../src/index';

/*
 * The visualization is stubbed for the same reason it is in
 * `instances.test.ts`: JointJS cannot build a paper under jsdom. What is
 * checked here is which element a bundle mounts into and what it reads before
 * it does, which is above the canvas either way.
 */
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    constructor(private readonly container: HTMLElement) {
      this.container.classList.add('plivet-graph');
    }
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    destroy(): void {}
  },
}));

/**
 * What a page has to write for the deployed bundle to find it.
 *
 * `src/embed.ts` is the entry `npm run deploy` builds, and everything it does
 * on load is here: find the element, read the configuration element beside it,
 * build one instance. The entry itself is a script tag's worth of code over
 * this, and cannot be imported under Jest - it mounts on load, and would do so
 * against whichever document a test happened to leave behind.
 */

const pageOf = (html: string) => {
  document.body.innerHTML = html;
};

const shellIn = (id: string) =>
  document.getElementById(id)?.querySelector('.plivet');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the element the bundle mounts into', () => {
  it('is #c-visualizer, the name a host page will not already be using', () => {
    pageOf(`<div id="${MOUNT_ELEMENT_ID}"></div>`);
    const instance = mount();
    expect(instance).not.toBeNull();
    expect(shellIn(MOUNT_ELEMENT_ID)).not.toBeNull();
    instance?.destroy();
  });

  it('is #root where the page is the one that always wrote #root', () => {
    pageOf(`<div id="${LEGACY_MOUNT_ELEMENT_ID}"></div>`);
    const instance = mount();
    expect(instance).not.toBeNull();
    expect(shellIn(LEGACY_MOUNT_ELEMENT_ID)).not.toBeNull();
    instance?.destroy();
  });

  it('is the new name where a page carries both', () => {
    pageOf(
      `<div id="${MOUNT_ELEMENT_ID}"></div><div id="${LEGACY_MOUNT_ELEMENT_ID}"></div>`
    );
    const instance = mount();
    expect(shellIn(MOUNT_ELEMENT_ID)).not.toBeNull();
    expect(shellIn(LEGACY_MOUNT_ELEMENT_ID)).toBeNull();
    instance?.destroy();
  });

  it('is nothing at all where the page wrote neither, and that is not an error', () => {
    pageOf('<p>a chapter that includes the bundle and nothing else</p>');
    expect(findMount()).toBeNull();
    expect(mount()).toBeNull();
  });

  it('takes one instance, however many times the bundle was included', () => {
    pageOf(`<div id="${MOUNT_ELEMENT_ID}"></div>`);
    const first = mount();
    const second = mount();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      document.getElementById(MOUNT_ELEMENT_ID)?.querySelectorAll('.plivet')
        .length
    ).toBe(1);
    first?.destroy();
  });
});

describe('what the page configured', () => {
  it('is read from the configuration element and applied before anything opens', () => {
    pageOf(
      `<div id="c-visualizer-config" config='{"theme": "dark", "features": {"loadFile": false}}'></div>` +
        `<div id="${MOUNT_ELEMENT_ID}"></div>`
    );
    const instance = mount();
    const shell = shellIn(MOUNT_ELEMENT_ID) as HTMLElement;
    expect(shell.classList.contains('plivet--dark')).toBe(true);
    expect(shell.querySelector('.plivet__files')).toBeNull();
    instance?.destroy();
  });

  it('wins over what the entry passed, because the page has the last word', () => {
    pageOf(
      `<div id="c-visualizer-config" config='{"licenses": "/legal/oss.html"}'></div>` +
        `<div id="${MOUNT_ELEMENT_ID}"></div>`
    );
    const instance = mount(document, { licenses: '_static/licenses.html' });
    const link = document.querySelector(
      '.plivet__footer a[href="/legal/oss.html"]'
    );
    expect(link).not.toBeNull();
    instance?.destroy();
  });

  it('leaves the licence report beside the bundle when the page says nothing', () => {
    pageOf(`<div id="${MOUNT_ELEMENT_ID}"></div>`);
    const instance = mount(document, {
      licenses: 'https://host.example/_static/c-visualizer/licenses.html',
    });
    const link = document.querySelector(
      '.plivet__footer a[href="https://host.example/_static/c-visualizer/licenses.html"]'
    );
    expect(link).not.toBeNull();
    instance?.destroy();
  });
});

describe('when the bundle mounts', () => {
  it('runs straight away where the document is already parsed', () => {
    const run = jest.fn();
    whenReady(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for the body where the script is in the head', () => {
    const run = jest.fn();
    const doc = {
      readyState: 'loading',
      addEventListener: jest.fn(),
    } as unknown as Document;
    whenReady(run, doc);
    expect(run).not.toHaveBeenCalled();
    const [event, listener] = (doc.addEventListener as jest.Mock).mock.calls[0];
    expect(event).toBe('DOMContentLoaded');
    listener();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
