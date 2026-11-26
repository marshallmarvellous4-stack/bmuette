// One height rule for the comments and share sheets, so they feel the same on every phone.
// About two thirds of the screen: tall enough to read and type comfortably, short enough
// that the video stays visible above it (the same proportion TikTok and Instagram use).
export function sheetHeight(windowH: number, topInset: number, share = 0.68): number {
  const usable = windowH - topInset;
  const h = Math.round(usable * share);
  const floor = Math.min(440, Math.round(usable * 0.6)); // never cramped on small phones
  const ceil = Math.round(usable * 0.75);                // never swallows the video on tall phones
  return Math.max(floor, Math.min(h, 660, ceil));
}
