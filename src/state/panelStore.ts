import { create } from 'zustand';
import type { PanelMode } from '@/types';

interface PanelState {
  mode: PanelMode;
  open: (mode: 'flight' | 'list') => void;
  close: () => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  mode: 'closed',
  open: (mode) => set({ mode }),
  close: () => set({ mode: 'closed' }),
}));
