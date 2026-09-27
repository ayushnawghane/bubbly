import { create } from 'zustand';

// The GameEngine (outside React) calls these setters directly via
// useGameStore.getState().setX(...) whenever a value actually changes.
// React components subscribe with selectors (useGameStore(s => s.score)),
// so they only re-render on the slices they actually read — never on every
// animation frame, since the 60fps loop lives entirely inside PixiJS.
export const useGameStore = create((set) => ({
  screen: 'start', // 'start' | 'playing' | 'gameover'
  score: 0,
  best: 0,
  streak: 0,
  combo: 0,
  shuffles: 0,
  muted: false,
  gameOverStats: null, // { score, isNewBest, bubblesPopped, bestCombo }

  setScreen: (screen) => set({ screen }),
  setScore: (score) => set({ score }),
  setBest: (best) => set({ best }),
  setStreak: (streak) => set({ streak }),
  setCombo: (combo) => set({ combo }),
  setShuffles: (shuffles) => set({ shuffles }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  setGameOverStats: (gameOverStats) => set({ gameOverStats, screen: 'gameover' }),
}));
