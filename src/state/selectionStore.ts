import { create } from 'zustand';

interface SelectionState {
  selectedIcao: string | null;
  select: (icao: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIcao: null,
  select: (icao) => set({ selectedIcao: icao }),
}));
