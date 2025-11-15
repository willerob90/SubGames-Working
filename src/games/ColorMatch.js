import React, { useState, useCallback, useEffect, useRef } from 'react';

const COLORS = [
  { id: 'red', bg: 'bg-red-600', hover: 'hover:bg-red-500', active: 'bg-red-400', sound: 329.63 },
  { id: 'blue', bg: 'bg-blue-600', hover: 'hover:bg-blue-500', active: 'bg-blue-400', sound: 392.00 },
  { id: 'green', bg: 'bg-green-600', hover: 'hover:bg-green-500', active: 'bg-green-400', sound: 523.25 },
  { id: 'yellow', bg: 'bg-yellow-500', hover: 'hover:bg-yellow-400', active: 'bg-yellow-300', sound: 659.25 },
];

const ColorMatch = ({ onGameWin, onGameStart }) => {
  const [sequence, setSequence] = useState([]);
  const [playerSequence, setPlayerSequence] = useState([]);
  const [level, setLevel] = useState(1);
  const [gameState, setGameState] = useState('intro'); // intro, showing, player-turn, correct, wrong, won
  const [activeColor, setActiveColor] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const audioContext = useRef(null);

  // Initialize Web Audio API
  useEffect(() => {
    audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  // Play tone
  const playTone = useCallback((frequency, duration = 200) => {
    if (!audioContext.current) return;
    
    const oscillator = audioContext.current.createOscillator();
    const gainNode = audioContext.current.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.current.currentTime + duration / 1000);
    
    oscillator.start(audioContext.current.currentTime);
    oscillator.stop(audioContext.current.currentTime + duration / 1000);
  }, []);

  // Show sequence to player
  const showSequence = useCallback(async (seq) => {
    setGameState('showing');
    
    for (let i = 0; i < seq.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const colorId = seq[i];
      const color = COLORS.find(c => c.id === colorId);
      
      setActiveColor(colorId);
      playTone(color.sound);
      
      await new Promise(resolve => setTimeout(resolve, 400));
      setActiveColor(null);
    }
    
    setGameState('player-turn');
  }, [playTone]);

  // Start new game
  const startGame = useCallback(async () => {
    const newSequence = [COLORS[Math.floor(Math.random() * COLORS.length)].id];
    setSequence(newSequence);
    setPlayerSequence([]);
    setLevel(1);
    setGameState('showing');
    showSequence(newSequence);
    
    // Create game session when starting
    if (onGameStart) {
      const newSessionId = await onGameStart('colorMatch');
      setSessionId(newSessionId);
    }
  }, [showSequence, onGameStart]);

  // Handle player clicking a color
  const handleColorClick = useCallback((colorId) => {
    if (gameState !== 'player-turn') return;
    
    const color = COLORS.find(c => c.id === colorId);
    setActiveColor(colorId);
    playTone(color.sound);
    
    setTimeout(() => setActiveColor(null), 200);
    
    const newPlayerSequence = [...playerSequence, colorId];
    setPlayerSequence(newPlayerSequence);
    
    // Check if player made a mistake
    if (newPlayerSequence[newPlayerSequence.length - 1] !== sequence[newPlayerSequence.length - 1]) {
      setGameState('wrong');
      setTimeout(() => {
        setGameState('intro');
      }, 2000);
      return;
    }
    
    // Check if player completed the sequence
    if (newPlayerSequence.length === sequence.length) {
      if (level === 8) {
        // Player won the game!
        setGameState('won');
        if (onGameWin) {
          onGameWin(sessionId);
        }
      } else {
        // Move to next level
        setGameState('correct');
        setTimeout(() => {
          const nextLevel = level + 1;
          const newSequence = [...sequence, COLORS[Math.floor(Math.random() * COLORS.length)].id];
          setSequence(newSequence);
          setPlayerSequence([]);
          setLevel(nextLevel);
          showSequence(newSequence);
        }, 1000);
      }
    }
  }, [gameState, playerSequence, sequence, level, playTone, showSequence, onGameWin]);

  // Reset game
  const resetGame = () => {
    setSequence([]);
    setPlayerSequence([]);
    setLevel(1);
    setGameState('intro');
  };

  return (
    <div className="flex flex-col items-center space-y-4 md:space-y-6 p-2 md:p-4">
      {/* Title */}
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-xl md:text-3xl font-bold text-blue-400">Color Match</h2>
        <p className="text-xs md:text-base text-gray-400">Repeat the color sequence!</p>
        <div className="bg-gray-800 px-4 py-2 md:px-6 md:py-3 rounded-lg border border-gray-700 inline-block">
          <span className="text-xs md:text-sm text-gray-400">Level: </span>
          <span className="text-lg md:text-2xl font-bold text-green-400">{level}</span>
          <span className="text-gray-400"> / 8</span>
        </div>
      </div>

      {/* Color Grid - Always visible */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 w-full max-w-md">
        {COLORS.map((color) => (
          <button
            key={color.id}
            onClick={() => handleColorClick(color.id)}
            disabled={gameState !== 'player-turn'}
            className={`h-40 md:h-48 rounded-xl transition-all shadow-lg ${
              activeColor === color.id 
                ? color.active 
                : color.bg
            } ${
              gameState === 'player-turn' 
                ? `${color.hover} cursor-pointer` 
                : 'cursor-not-allowed opacity-70'
            }`}
          />
        ))}
      </div>

      {/* Game State Messages */}
      {gameState === 'intro' && (
        <div className="text-center max-w-md">
          <p className="text-base md:text-lg text-blue-300 mb-3 md:mb-4">
            Reach level 8 to win!
          </p>
          <button
            onClick={startGame}
            className="px-6 py-3 md:px-8 md:py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-bold hover:from-blue-500 hover:to-blue-600 transition-all shadow-lg text-sm md:text-base"
          >
            Start Game
          </button>
        </div>
      )}

      {gameState === 'showing' && (
        <div className="bg-purple-900/50 border border-purple-500 p-3 md:p-4 rounded-lg">
          <p className="text-base md:text-lg text-purple-300 font-semibold">
            Watch carefully...
          </p>
        </div>
      )}

      {gameState === 'player-turn' && (
        <div className="bg-green-900/50 border border-green-500 p-3 md:p-4 rounded-lg">
          <p className="text-base md:text-lg text-green-300 font-semibold">
            Your turn! ({playerSequence.length}/{sequence.length})
          </p>
        </div>
      )}

      {gameState === 'correct' && (
        <div className="bg-green-900/50 border border-green-500 p-3 md:p-4 rounded-lg animate-pulse">
          <p className="text-base md:text-lg text-green-300 font-semibold">
            ✓ Correct! Next level...
          </p>
        </div>
      )}

      {gameState === 'wrong' && (
        <div className="bg-red-900/50 border-2 border-red-500 p-4 md:p-6 rounded-xl text-center">
          <p className="text-xl md:text-2xl font-bold text-red-400 mb-1 md:mb-2">Wrong sequence!</p>
          <p className="text-sm md:text-base text-gray-300">You reached level {level}</p>
        </div>
      )}

      {gameState === 'won' && (
        <div className="bg-yellow-900/50 border-2 border-yellow-500 p-4 md:p-6 rounded-xl text-center animate-pulse">
          <p className="text-xl md:text-2xl font-bold text-yellow-400 mb-1 md:mb-2">🎉 You Win! 🎉</p>
          <p className="text-sm md:text-base text-gray-300">You earned 8 Sub Points for your creator!</p>
          <button
            onClick={resetGame}
            className="mt-3 md:mt-4 px-4 py-2 md:px-6 md:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors text-sm md:text-base"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

export default ColorMatch;
