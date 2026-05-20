import { create } from 'zustand';

interface A11yState {
  prefersReducedMotion: boolean;
  keyboardMode: boolean;
  setPrefersReducedMotion: (v: boolean) => void;
  setKeyboardMode: (v: boolean) => void;
}

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const useA11yStore = create<A11yState>((set) => ({
  prefersReducedMotion: detectReducedMotion(),
  keyboardMode: false,
  setPrefersReducedMotion: (v) => set({ prefersReducedMotion: v }),
  setKeyboardMode: (v) => set({ keyboardMode: v }),
}));

// Sync prefersReducedMotion with the media query + keyboard mode on first Tab
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', (e) => useA11yStore.getState().setPrefersReducedMotion(e.matches));
  } catch {
    // Older browsers / jsdom may not support addEventListener on MediaQueryList
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !useA11yStore.getState().keyboardMode) {
      useA11yStore.getState().setKeyboardMode(true);
    }
  });
}
