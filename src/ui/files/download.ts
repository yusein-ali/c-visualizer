/**
 * Handing a file to the browser.
 *
 * It was `react-download-link`, whose whole content is what this does: build
 * a Blob, name a URL after it, click a link, release the URL. Two callers
 * want it - the uploaded files a program can `fopen`, and the program itself -
 * so it is a function rather than a method on either of them.
 */
export const download = (
  filename: string,
  data: BlobPart,
  type: string = 'application/octet-stream'
): void => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Released on the next turn rather than now: revoking a URL the browser has
  // not finished reading cancels the download it was asked for.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
