import React, { useState, useEffect, useCallback } from 'react';

const GRID_SIZE = 9; // 3x3 grid
const TARGET_SCORE = 30; // Need 30 hits to win
const MOLE_EMOJIS = ['🐭', '🐹', '🐰', '🦊', '🐻'];

const WhackAMole = ({ onGameWin }) => {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [activeMoles, setActiveMoles] = useState([]);
  const [gameState, setGameState] = useState('intro'); // intro, playing, won, lost
  const [lastHit, setLastHit] = useState(null);
  const [combo, setCombo] = useState(0);

  // Start game
  const startGame = useCallback(() => {
    setScore(0);
    setTimeLeft(30);
    setActiveMoles([]);
    setGameState('playing');
    setCombo(0);
    setLastHit(null);
  }, []);

  // Spawn moles randomly
  useEffect(() => {
    if (gameState !== 'playing') return;

    const spawnInterval = setInterval(() => {
      const numMoles = Math.min(1 + Math.floor(score / 10), 3); // More moles as you progress
      const newMoles = [];
      
      for (let i = 0; i < numMoles; i++) {
        const position = Math.floor(Math.random() * GRID_SIZE);
        const emoji = MOLE_EMOJIS[Math.floor(Math.random() * MOLE_EMOJIS.length)];
        
        if (!newMoles.find(m => m.position === position)) {
          newMoles.push({
            id: Date.now() + i,
            position,
            emoji,
            duration: 1000 - Math.floor(score * 10), // Faster as score increases
          });
        }
      }
      
      setActiveMoles(prev => {
        const combined = [...prev, ...newMoles];
        // Remove duplicates by position
        const unique = combined.filter((mole, index, self) =>
          index === self.findIndex(m => m.position === mole.position)
        );
        return unique;
      });

      // Remove moles after their duration
      newMoles.forEach(mole => {
        setTimeout(() => {
          setActiveMoles(prev => prev.filter(m => m.id !== mole.id));
        }, mole.duration);
      });
    }, 800);

    return () => clearInterval(spawnInterval);
  }, [gameState, score]);

  // Timer countdown
  useEffect(() => {
    if (gameState !== 'playing') return;

    if (timeLeft <= 0) {
      if (score >= TARGET_SCORE) {
        setGameState('won');
        onGameWin(3); // Award 3 points
      } else {
        setGameState('lost');
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(t => t - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, timeLeft, score, onGameWin]);

  // Check for win condition
  useEffect(() => {
    if (gameState === 'playing' && score >= TARGET_SCORE) {
      setGameState('won');
      onGameWin(3); // Award 3 points
    }
  }, [score, gameState, onGameWin]);

  // Handle mole whack
  const whackMole = (moleId, position) => {
    if (gameState !== 'playing') return;
    
    const mole = activeMoles.find(m => m.id === moleId);
    if (!mole) return;

    setScore(prev => prev + 1);
    setActiveMoles(prev => prev.filter(m => m.id !== moleId));
    setLastHit(position);
    setCombo(prev => prev + 1);
    
    setTimeout(() => setLastHit(null), 300);
    
    // Reset combo if too slow
    setTimeout(() => setCombo(0), 2000);
  };

  return (
    <div className="flex flex-col items-center space-y-4 md:space-y-6 p-2 md:p-4">
      {/* Title */}
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-2xl md:text-4xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
          Whack-a-Mole
        </h2>
        <p className="text-sm md:text-base text-gray-300">Tap the critters!</p>
        {gameState === 'playing' && (
          <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
            <div className="text-lg md:text-xl font-semibold bg-orange-500/30 text-orange-300 px-3 py-1 rounded-full">
              🎯 {score}/{TARGET_SCORE}
            </div>
            <div className={`text-lg md:text-xl font-bold px-3 py-1 rounded-full ${
              timeLeft <= 10 ? 'bg-red-500/30 text-red-300 animate-pulse' : 'bg-green-500/30 text-green-300'
            }`}>
              ⏱️ {timeLeft}s
            </div>
            {combo >= 3 && (
              <div className="text-lg md:text-xl font-bold bg-yellow-500/30 text-yellow-300 px-3 py-1 rounded-full animate-bounce">
                🔥 {combo}x
              </div>
            )}
          </div>
        )}
      </div>

      {/* Intro Screen */}
      {gameState === 'intro' && (
        <div className="text-center max-w-md space-y-4">
          <div className="text-6xl animate-bounce">🎪</div>
          <p className="text-base md:text-lg text-gray-300">
            Whack 30 critters in 30 seconds to win 3 SubPoints!
          </p>
          <p className="text-sm text-gray-400">
            Tap fast before they hide! ⚡
          </p>
          <button
            onClick={startGame}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105"
          >
            Start Game
          </button>
        </div>
      )}

      {/* Playing State */}
      {gameState === 'playing' && (
        <div className="w-full max-w-lg">
          <div className="grid grid-cols-3 gap-3 md:gap-4">
            {Array.from({ length: GRID_SIZE }).map((_, index) => {
              const mole = activeMoles.find(m => m.position === index);
              const isHit = lastHit === index;
              
              return (
                <button
                  key={index}
                  onClick={() => mole && whackMole(mole.id, index)}
                  disabled={!mole}
                  className={`
                    relative aspect-square rounded-2xl transition-all duration-200
                    ${mole 
                      ? 'bg-gradient-to-br from-green-600 to-green-700 hover:scale-110 cursor-pointer shadow-xl hover:shadow-2xl' 
                      : 'bg-gradient-to-br from-gray-800 to-gray-900 cursor-default'
                    }
                    ${isHit ? 'scale-90 bg-yellow-500' : ''}
                  `}
                >
                  {/* Hole */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-12 md:w-20 md:h-16 bg-black/40 rounded-full" />
                  </div>
                  
                  {/* Mole */}
                  {mole && (
                    <div 
                      className="absolute inset-0 flex items-center justify-center text-4xl md:text-6xl animate-bounce"
                      style={{
                        animation: 'popUp 0.3s ease-out'
                      }}
                    >
                      {mole.emoji}
                    </div>
                  )}
                  
                  {/* Hit effect */}
                  {isHit && (
                    <div className="absolute inset-0 flex items-center justify-center text-3xl md:text-4xl animate-ping">
                      💥
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Win Screen */}
      {gameState === 'won' && (
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl md:text-8xl animate-bounce">🎉</div>
          <div className="space-y-2">
            <p className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
              Whack Master!
            </p>
            <p className="text-base md:text-lg text-gray-300">
              You whacked {score} critters! 🎯
            </p>
            <p className="text-xl md:text-2xl font-semibold text-orange-300">
              +3 SubPoints earned!
            </p>
          </div>
          <button
            onClick={() => setGameState('intro')}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105"
          >
            Play Again
          </button>
        </div>
      )}

      {/* Lost Screen */}
      {gameState === 'lost' && (
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl md:text-8xl">😅</div>
          <div className="space-y-2">
            <p className="text-2xl md:text-3xl font-bold text-red-400">
              Time's Up!
            </p>
            <p className="text-base md:text-lg text-gray-300">
              You whacked {score} out of {TARGET_SCORE}
            </p>
            <p className="text-sm text-gray-400">
              Keep practicing!
            </p>
          </div>
          <button
            onClick={() => setGameState('intro')}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105"
          >
            Try Again
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes popUp {
          0% {
            transform: translateY(100%);
          }
          50% {
            transform: translateY(-10%);
          }
          100% {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default WhackAMole;
