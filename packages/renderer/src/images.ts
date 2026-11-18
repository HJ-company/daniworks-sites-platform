/**
 * Responsive image variants. Every packaged sample (`/_shared/<v>/site-templates/x.jpg`) and
 * uploaded photo (`/_media/<site>/<sha>.jpg`) has WebP variants next to it named
 * `x.w<width>.webp`, created at asset build time and at upload time respectively.
 */
export const VARIANT_WIDTHS = [480, 800, 1200] as const;
export const VARIANT_QUALITY = 72;

export const variantUrl = (src: string, width: number) => src.replace(/\.(jpg|png)$/, `.w${width}.webp`);

const hasVariants = (src: string) =>
  /\.(jpg|png)$/.test(src) && (src.includes("/site-templates/") || src.startsWith("/_media/"));

/** `srcset` for a source with variants; the original is the largest candidate when its width is known. */
export function srcSetFor(src: string, width?: number): string | undefined {
  if (!hasVariants(src)) return undefined;
  const widths = VARIANT_WIDTHS.filter((w) => !width || w < width);
  if (!widths.length) return undefined;
  const candidates = widths.map((w) => `${variantUrl(src, w)} ${w}w`);
  if (width) candidates.push(`${src} ${width}w`);
  return candidates.join(", ");
}
