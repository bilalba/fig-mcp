import { Resvg } from '@resvg/resvg-js';

export interface ScreenshotOptions {
  maxWidth?: number;  // Default: 800
  maxHeight?: number; // Default: 600
}

export async function generateScreenshot(
  svgString: string,
  options: ScreenshotOptions = {}
): Promise<{ base64: string; width: number; height: number; mimeType: string }> {
  const { maxWidth = 800, maxHeight = 600 } = options;

  // Parse SVG dimensions from the string
  const widthMatch = svgString.match(/width="(\d+)"/);
  const heightMatch = svgString.match(/height="(\d+)"/);
  const svgWidth = widthMatch ? parseInt(widthMatch[1]) : 800;
  const svgHeight = heightMatch ? parseInt(heightMatch[1]) : 600;

  // Calculate scale to fit within max dimensions
  const scale = Math.min(maxWidth / svgWidth, maxHeight / svgHeight, 1);

  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: 'width',
      value: Math.round(svgWidth * scale),
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  return {
    base64: pngBuffer.toString('base64'),
    width: pngData.width,
    height: pngData.height,
    mimeType: 'image/png'
  };
}
