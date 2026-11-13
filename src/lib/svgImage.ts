/**
 * Завантаження SVG-зображень (логотип, стрілка півночі) для canvas-аркушів.
 *
 * Спершу SVG читається як текст і отримує явні width/height із viewBox, щоб
 * canvas коректно визначав натуральні розміри. Якщо fetch недоступний,
 * використовується звичайне завантаження через <img>.
 */
export async function loadSvgImage(url: string): Promise<HTMLImageElement> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const svgText = await response.text();
    let modified = svgText;
    const viewBoxMatch = svgText.match(
      /viewBox=["']\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/,
    );
    if (viewBoxMatch && (!svgText.includes('width=') || !svgText.includes('height='))) {
      const [, , , viewBoxWidth, viewBoxHeight] = viewBoxMatch;
      modified = svgText.replace(
        /<svg\b([^>]*)>/,
        `<svg$1 width="${viewBoxWidth}" height="${viewBoxHeight}">`,
      );
    }
    const blob = new Blob([modified], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (event) => reject(event);
      image.src = blobUrl;
    });
  } catch {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = (event) => reject(event);
      image.src = url;
    });
  }
}
