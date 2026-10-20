import { isNative } from './platform';

// The receipt is the one thing a buyer may download: a PNG picture of it (files never are).
export async function downloadReceiptImage(el: HTMLElement, name: string) {
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
  const file = `${name.replace(/[^\w.-]+/g, '-')}.png`;
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: file, data: dataUrl.split(',')[1]!, directory: Directory.Cache });
    await Share.share({ title: name, files: [saved.uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl; a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
}
