import logoUrl from '@/assets/aithos-logo-horizontal.png';

/**
 * Decorative watermark in the bottom-left of the viewport.
 *
 * The source PNG has a solid black background. Rather than processing the
 * image, we use `mix-blend-mode: screen` to drop pure black to transparent
 * (any pixel where R=G=B=0 becomes invisible against a darker scene), and
 * the gold pixels stay luminous because `screen` lightens.
 *
 * Strictly decorative — no link, no pointer events, no announcements
 * beyond the alt text for screen readers.
 */
export function BrandWatermark() {
  return (
    <img
      src={logoUrl}
      alt="Aithos"
      className="brand-watermark"
      draggable={false}
    />
  );
}
