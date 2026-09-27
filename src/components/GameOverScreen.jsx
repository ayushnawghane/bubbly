import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore.js';

export default function GameOverScreen({ onPlay }) {
  const stats = useGameStore((s) => s.gameOverStats);
  if (!stats) return null;

  return (
    <motion.div
      className="screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.h1
        className="title"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 16 }}
      >
        Game Over
      </motion.h1>
      <p className="subtitle">Score: {stats.score}</p>
      {stats.isNewBest && (
        <motion.p
          className="new-best"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 400 }}
        >
          New best score!
        </motion.p>
      )}
      <div className="stats-recap">
        <div className="stat-block">
          <span className="stats-value">{stats.bubblesPopped}</span>
          <span className="stats-label">bubbles popped</span>
        </div>
        <div className="stat-block">
          <span className="stats-value">x{stats.bestCombo}</span>
          <span className="stats-label">best combo</span>
        </div>
      </div>
      <motion.button
        className="primary-btn"
        onClick={onPlay}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.04 }}
      >
        Play Again
      </motion.button>
    </motion.div>
  );
}
