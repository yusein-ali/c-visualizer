import './files.css';
import strings from '../../strings';
import { download } from './download';
import { iconFor } from '../controls/icons';

/**
 * The data-file panel: what a running program can `fopen` and what it wrote.
 *
 * It was `FileForm` and `FileItem`, a Bootstrap panel around a
 * `react-download-link`. That package's whole content is what `download()`
 * in `download.ts` does - build a Blob, name a URL after it, click a link,
 * release the URL - so it left `package.json` with the framework.
 *
 * The panel holds no files of its own. The set lives in the interpreter
 * client, which sends uploads to the program and receives files that program
 * creates or changes; this class is told what that set contains.
 */

export interface FilePanelOptions {
  /** Files chosen from the input. The caller reads and stores them. */
  onUpload?: (files: FileList) => void;
  onDelete?: (filename: string) => void;
  /** Whether the panel starts open. Defaults to collapsed. */
  open?: boolean;
}

export class FilePanel {
  readonly root: HTMLDetailsElement;

  private readonly options: FilePanelOptions;
  private readonly list: HTMLUListElement;
  private readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, options: FilePanelOptions = {}) {
    this.options = options;

    this.root = document.createElement('details');
    this.root.className = 'plivet-files';
    this.root.open = options.open ?? false;

    const summary = document.createElement('summary');
    summary.className = 'plivet-files__summary';
    summary.textContent = strings.fileUpload;

    this.list = document.createElement('ul');
    this.list.className = 'plivet-files__list';

    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.multiple = true;
    this.input.className = 'plivet-files__input';
    this.input.setAttribute('aria-label', strings.fileUpload);
    this.input.addEventListener('change', this.selected);

    this.root.append(summary, this.list, this.input);
    parent.appendChild(this.root);

    this.setFiles(null);
  }

  /** The data-file set, as the interpreter client holds it. */
  setFiles(files: Map<string, ArrayBuffer> | null): void {
    this.list.textContent = '';

    const hint = document.createElement('li');
    hint.className = 'plivet-files__item';
    hint.textContent = strings.uploadFile;
    this.list.appendChild(hint);

    if (files === null) {
      return;
    }
    for (const [filename, arrayBuffer] of files) {
      this.list.appendChild(this.item(filename, arrayBuffer));
    }
  }

  /**
   * Forgets what is selected in the input, so that uploading the same file
   * twice in a row still raises a `change`.
   */
  clearSelection(): void {
    this.input.value = '';
  }

  /** Opens the panel so a newly created program file is immediately visible. */
  expand(): void {
    this.root.open = true;
  }

  destroy(): void {
    this.input.removeEventListener('change', this.selected);
    this.root.remove();
  }

  private readonly selected = () => {
    const files = this.input.files;
    if (files === null || files.length === 0) {
      return;
    }
    this.options.onUpload?.(files);
  };

  private item(filename: string, arrayBuffer: ArrayBuffer): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'plivet-files__item';

    const save = this.button(strings.downloadFile, filename, 'download', () =>
      download(filename, arrayBuffer)
    );
    const remove = this.button(strings.removeFile, filename, 'remove', () =>
      this.options.onDelete?.(filename)
    );

    const name = document.createElement('span');
    name.className = 'plivet-files__name';
    name.textContent = filename;

    item.append(save, remove, name);
    return item;
  }

  private button(
    title: string,
    filename: string,
    icon: 'download' | 'remove',
    action: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plivet-files__button';
    button.title = title;
    // Two buttons per row and one row per file: without the name in it, every
    // accessible name in the list would be the same two words.
    button.setAttribute('aria-label', `${title} ${filename}`);
    button.appendChild(iconFor(icon));
    button.addEventListener('click', action);
    return button;
  }
}
