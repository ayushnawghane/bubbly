import { useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useGameStore } from './store/gameStore.js';
import GameCanvas from './components/GameCanvas.jsx';
import HUD from './components/HUD.jsx';
import StartScreen from './components/StartScreen.jsx';
import GameOverScreen from './components/GameOverScreen.jsx';

export default function App() {
  const engineRef = useRef(null);
  const screen = useGameStore((s) => s.screen);

  const handlePlay = () => {
    engineRef.current?.start();
    useGameStore.getState().setScreen('playing');
  };

  return (
    <div className="app-root">
      <GameCanvas engineRef={engineRef} />
      <HUD engineRef={engineRef} />
      <AnimatePresence mode="wait">
        {screen === 'start' && <StartScreen key="start" onPlay={handlePlay} />}
        {screen === 'gameover' && <GameOverScreen key="gameover" onPlay={handlePlay} />}
      </AnimatePresence>
    </div>
  );
}
