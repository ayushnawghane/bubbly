import { motion } from 'framer-motion';

export default function StartScreen({ onPlay }) {
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
        initial={{ y: -14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05, type: 'spring', stiffness: 260, damping: 20 }}
      >
        Bubbly
      </motion.h1>
      <p className="subtitle">Endless bubble shooter. Match 3+, don't let the ceiling fall.</p>
      <motion.button
        className="primary-btn"
        onClick={onPlay}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.04 }}
      >
        Play
      </motion.button>
      <p className="hint">Drag / arrow keys to aim &middot; tap, click or space to shoot</p>
      <p className="hint">Follow the bounce line &middot; save your shuffles for when you're stuck</p>
      <p className="offline-hint">Works fully offline once loaded.</p>
    </motion.div>
  );
}
