import { TabBar } from '../src/ui/tabs';
import { Server } from '../src/core';

/**
 * Several files open, one of them the one that runs.
 *
 * C compiles one translation unit, and PLIVET's preprocessor discards
 * `#include`, so the second file is not compiled with the first. What the
 * tabs buy is the shape the interactive-code directive already has - the
 * parts of a block are tabs, exactly one is the main file - and the protocol
 * carries the whole set so that widening it later does not touch every branch
 * at once.
 */

const mounted = (options = {}) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tabs = new TabBar(host, options);
  return { host, tabs };
};

const tabsOf = (bar: TabBar) =>
  Array.from(bar.root.querySelectorAll('.plivet-tabs__tab'));

const selectIn = (tab: Element) =>
  tab.querySelector<HTMLButtonElement>('.plivet-tabs__select')!;

describe('the tab strip', () => {
  it('is not drawn at all while there is one file', () => {
    const { host, tabs } = mounted();
    tabs.setTabs([{ path: 'main.c', entry: true, active: true }]);
    expect(tabs.root.hidden).toBe(true);
    tabs.destroy();
    host.remove();
  });

  it('draws a tab per file once there is more than one', () => {
    const { host, tabs } = mounted();
    tabs.setTabs([
      { path: 'main.c', entry: true, active: true },
      { path: 'notes.c', entry: false, active: false },
    ]);
    expect(tabs.root.hidden).toBe(false);
    expect(tabsOf(tabs).map((tab) => selectIn(tab).textContent)).toEqual([
      'main.c',
      'notes.c',
    ]);
    tabs.destroy();
    host.remove();
  });

  it('reports the file a reader picked', () => {
    const picked: string[] = [];
    const { host, tabs } = mounted({
      onSelect: (path: string) => picked.push(path),
    });
    tabs.setTabs([
      { path: 'main.c', entry: true, active: true },
      { path: 'notes.c', entry: false, active: false },
    ]);
    selectIn(tabsOf(tabs)[1]).click();
    expect(picked).toEqual(['notes.c']);
    tabs.destroy();
    host.remove();
  });

  it('will not close the file that runs', () => {
    const closed: string[] = [];
    const { host, tabs } = mounted({
      onClose: (path: string) => closed.push(path),
    });
    tabs.setTabs([
      { path: 'main.c', entry: true, active: true },
      { path: 'notes.c', entry: false, active: false },
    ]);
    const [entry, other] = tabsOf(tabs);
    expect(entry.querySelector('.plivet-tabs__close')).toBeNull();
    other.querySelector<HTMLButtonElement>('.plivet-tabs__close')!.click();
    expect(closed).toEqual(['notes.c']);
    tabs.destroy();
    host.remove();
  });

  it('makes another file the one that runs', () => {
    const asked: string[] = [];
    const { host, tabs } = mounted({
      onEntry: (path: string) => asked.push(path),
    });
    tabs.setTabs([
      { path: 'main.c', entry: true, active: true },
      { path: 'other.c', entry: false, active: false },
    ]);
    const [entry, other] = tabsOf(tabs);
    // The marker on the file that already runs says so and does nothing.
    expect(
      entry.querySelector<HTMLButtonElement>('.plivet-tabs__entry')!.disabled
    ).toBe(true);
    other.querySelector<HTMLButtonElement>('.plivet-tabs__entry')!.click();
    expect(asked).toEqual(['other.c']);
    tabs.destroy();
    host.remove();
  });
});

describe('the protocol', () => {
  it('compiles the entry file rather than the first thing it is handed', () => {
    const server = new Server();
    const log = console.log;
    console.log = () => undefined;
    return server
      .send({
        controlEvent: 'SyntaxCheck',
        // What `sourcecode` says is deliberately not what should be compiled.
        sourcecode: 'this is not a program',
        files: [
          { path: 'notes.c', text: 'this is not a program' },
          { path: 'main.c', text: 'int main(void) { return 0; }' },
        ],
        entry: 'main.c',
      })
      .then((response) => {
        console.log = log;
        expect(response.errors).toEqual([]);
        expect(response.sourcecode).toBe('int main(void) { return 0; }');
      });
  });

  it('falls back to the single text when no file set is given', () => {
    const server = new Server();
    const log = console.log;
    console.log = () => undefined;
    return server
      .send({
        controlEvent: 'SyntaxCheck',
        sourcecode: 'int main(void) { return 0; }',
      })
      .then((response) => {
        console.log = log;
        expect(response.errors).toEqual([]);
      });
  });
});
