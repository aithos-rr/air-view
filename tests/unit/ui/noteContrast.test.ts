import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The lines that correct the big number have to be readable.
 *
 * Everything D14 and D15 built rests on `.fleet__note`: "1 of 2 000
 * aircraft" is only honest because the sentence under it names what is
 * hiding the rest. That sentence was 11px at `opacity: 0.5` inside a `.hud`
 * already set to rgba(255,255,255,0.7) — an effective alpha of 0.35, which
 * is 3,1:1 on the page and 2,1:1 where the HUD crosses the limb of the
 * globe, against the 4,5:1 WCAG AA asks for text under 18,66px. The number
 * being corrected sits at 9,7:1: the claim was three times more visible
 * than its correction.
 *
 * The a11y gate cannot see this. tests/e2e/a11y.spec.ts runs on the default
 * state, where both filters are on, nothing is in focus and ShortfallNotes
 * renders nothing at all; and axe returns "incomplete", not "violation",
 * for text over a canvas or a gradient. So the check is made here, on the
 * declared values, where the arithmetic is exact.
 */

// Read from disk rather than imported: vitest hands a CSS import to the
// jsdom stylesheet, which drops what it cannot parse, and the question
// here is what the file DECLARES.
const CSS = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Every rule in the sheet whose selector list satisfies `matches`. */
function rulesFor(matches: (selector: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (selectors.some(matches)) out.push(m[2] ?? '');
  }
  return out;
}

/** The last declaration of `prop` across the given blocks — source order wins. */
function declaration(blocks: string[], prop: string): string | null {
  let found: string | null = null;
  for (const block of blocks) {
    for (const m of block.matchAll(new RegExp(`(?:^|[;\n])\\s*${prop}\\s*:([^;\n]+)`, 'g'))) {
      found = (m[1] ?? '').trim();
    }
  }
  return found;
}

function parseColour(value: string): Rgba | null {
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(value);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const hex = /#([0-9a-f]{6})\b/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1] ?? '', 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  return null;
}

/** `top` painted over `bottom`, as the compositor does it. */
function over(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function luminance(c: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function contrast(text: Rgba, background: Rgba): number {
  const a = luminance(over(text, background));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const noteBlocks = rulesFor((s) => s === '.fleet__note' || s.startsWith('.fleet__note:'));
const hudBlocks = rulesFor((s) => s === '.hud');
const plateBlocks = rulesFor((s) => s.startsWith('.fleet__notes'));

/**
 * The colour the note is actually painted in: its own `color` or the one it
 * inherits from `.hud`, with every `opacity` on the way down multiplied
 * into the alpha — which is how an 0.7 text colour and an 0.5 opacity
 * became 0.35 without either number looking alarming on its own.
 */
function effectiveNoteColour(): Rgba {
  const own = declaration(noteBlocks, 'color') ?? declaration(hudBlocks, 'color');
  const colour = own === null ? null : parseColour(own);
  if (colour === null) throw new Error('no colour declared for .fleet__note or .hud');
  const opacity =
    Number(declaration(noteBlocks, 'opacity') ?? '1') *
    Number(declaration(hudBlocks, 'opacity') ?? '1');
  return { ...colour, a: colour.a * opacity };
}

/** AA for text under 18,66px — which .fleet__note is, at any size it has had. */
const AA_SMALL_TEXT = 4.5;

describe('the shortfall notes are readable, not merely present', () => {
  it('clears AA on the page background', () => {
    // html, body, #root: radial-gradient(… #0a0a14 0%, #000000 70%).
    const page = rulesFor((s) => s === 'html' || s === 'body' || s === '#root');
    const background = declaration(page, 'background');
    const stops = [...(background ?? '').matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]);
    expect(stops.length).toBeGreaterThan(0);
    const text = effectiveNoteColour();
    for (const stop of stops) {
      const backdrop = parseColour(stop);
      expect(backdrop).not.toBeNull();
      expect({ stop, ratio: Number(contrast(text, backdrop!).toFixed(2)) >= AA_SMALL_TEXT }).toEqual(
        { stop, ratio: true }
      );
    }
  });

  it('clears AA wherever the HUD happens to fall, not only over black', () => {
    // The HUD is fixed at the top-left and the globe turns under it. Over
    // the limb the same text measured 2,1:1. A note is only an explanation
    // if it is legible whatever is behind it, so it must carry its own
    // backdrop — the plate .fleet already has — instead of borrowing the
    // page's. White is the worst case anything on screen can be.
    const plate = parseColour(declaration(plateBlocks, 'background') ?? '');
    const backdrop = plate === null ? WHITE : over(plate, WHITE);
    expect(contrast(effectiveNoteColour(), backdrop)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
  });

  it('is not left behind by the number it corrects', () => {
    // 14px/600 at rgba(255,255,255,0.7) is 9,7:1 on the page. A correction
    // three times fainter than the claim is a correction only in the DOM.
    const page: Rgba = { r: 10, g: 10, b: 20, a: 1 };
    const count = parseColour(declaration(hudBlocks, 'color') ?? '');
    expect(count).not.toBeNull();
    const note = contrast(effectiveNoteColour(), page);
    expect(note).toBeGreaterThan(contrast(count!, page) / 2);
  });
});
