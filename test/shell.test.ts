import { PlivetShell } from '../src/ui/shell';
import { HowToDialog } from '../src/ui/help';
import strings from '../src/strings';

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the shell', () => {
  it('hands out one mount point per widget', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent, { version: '1.0.0', fromYear: 2018 });

    for (const mount of [
      shell.controls,
      shell.editor,
      shell.console,
      shell.files,
      shell.main,
    ]) {
      expect(shell.root.contains(mount)).toBe(true);
    }
  });

  it('carries the theme on the root, where the widgets inherit it', () => {
    const parent = parentOf();
    const shell = new PlivetShell(parent);

    expect(shell.root.classList.contains('plivet--dark')).toBe(false);
    shell.setDark(true);
    expect(shell.root.classList.contains('plivet--dark')).toBe(true);
  });

  it('dates the copyright from the year given to the year it is', () => {
    const parent = parentOf();
    new PlivetShell(parent, { version: '1.0.0', fromYear: 2018 });
    const thisYear = new Date().getFullYear();

    const footer = parent.querySelector('.plivet__footer') as HTMLElement;
    expect(footer.textContent).toContain('PLIVET v1.0.0');
    expect(footer.textContent).toContain(`2018 - ${thisYear}`);
  });
});

describe('the instructions', () => {
  it('shows every line of the text, as text', () => {
    const parent = parentOf();
    const dialog = new HowToDialog(parent);
    dialog.open();

    const paragraphs = dialog.root.querySelectorAll('.plivet-help__body p');
    expect(paragraphs).toHaveLength(strings.howToText.length);
    expect(paragraphs[0].textContent).toBe(strings.howToText[0].trim());
  });

  it('closes from the button', () => {
    const parent = parentOf();
    const dialog = new HowToDialog(parent);
    dialog.open();
    expect(dialog.root.hasAttribute('open')).toBe(true);

    const close = dialog.root.querySelector(
      '.plivet-help__close'
    ) as HTMLButtonElement;
    close.click();
    expect(dialog.root.hasAttribute('open')).toBe(false);
  });
});
