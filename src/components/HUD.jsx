import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore.js';

export default function HUD({ engineRef }) {
  const score = useGameStore((s) => s.score);
  const best = useGameStore((s) => s.best);
  const streak = useGameStore((s) => s.streak);
  const combo = useGameStore((s) => s.combo);
  const shuffles = useGameStore((s) => s.shuffles);
  const muted = useGameStore((s) => s.muted);
  const screen = useGameStore((s) => s.screen);
  const toggleMuted = useGameStore((s) => s.toggleMuted);

  const handleMute = () => {
    toggleMuted();
    engineRef.current?.setMuted(!muted);
  };
  const handleShuffle = () => engineRef.current?.shuffleCurrentBubble();

  return (
    <div className="hud">
      <div className="hud-stat">
        <span className="hud-label">Score</span>
        <motion.span
          key={score}
          className="hud-value"
          initial={{ scale: 1.3 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        >
          {score}
        </motion.span>
      </div>
      <div className="hud-stat">
        <span className="hud-label">Best</span>
        <span className="hud-value">{best}</span>
      </div>
      <motion.div
        className="hud-stat hud-streak"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="hud-label">Streak</span>
        <span className="hud-value">🔥{streak}</span>
      </motion.div>

      <AnimatePresence>
        {combo > 1 && screen === 'playing' && (
          <motion.div
            className="hud-combo"
            initial={{ opacity: 0, y: -8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            x{combo} combo
          </motion.div>
        )}
      </AnimatePresence>

      <div className="hud-actions">
        <button
          className="icon-btn"
          onClick={handleShuffle}
          disabled={screen !== 'playing' || shuffles <= 0}
          aria-label="Shuffle bubble color"
        >
          🔀
          <span className="badge">{shuffles}</span>
        </button>
        <button className="icon-btn" onClick={handleMute} aria-label="Toggle sound">
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}
