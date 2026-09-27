import { useEffect, useRef } from 'react';
import { GameEngine } from '../engine/GameEngine.js';
import { useGameStore } from '../store/gameStore.js';

export default function GameCanvas({ engineRef }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;

    const engine = new GameEngine(container, {
      onScore: (score) => useGameStore.getState().setScore(score),
      onBest: (best) => useGameStore.getState().setBest(best),
      onStreak: (streak) => useGameStore.getState().setStreak(streak),
      onCombo: (combo) => useGameStore.getState().setCombo(combo),
      onShuffles: (shuffles) => useGameStore.getState().setShuffles(shuffles),
      onGameOver: (stats) => useGameStore.getState().setGameOverStats(stats),
    });

    engine.init().then(() => {
      if (disposed) return;
      engine.setMuted(useGameStore.getState().muted);
      engineRef.current = engine;
    });

    return () => {
      disposed = true;
      engineRef.current = null;
      engine.destroy();
    };
  }, [engineRef]);

  return <div ref={containerRef} className="game-canvas-container" />;
}
