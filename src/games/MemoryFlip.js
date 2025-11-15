import React, { useState, useEffect, useCallback } from 'react';

// Card symbols - 8 pairs = 16 cards
const SYMBOLS = ['🎮', '🎯', '🎲', '🎪', '🎨', '🎭', '🎸', '🎹'];

const MemoryFlip = ({ onGameWin, onGameStart }) => {
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [gameState, setGameState] = useState('intro'); // intro, playing, won
  const [canFlip, setCanFlip] = useState(true);
  const [sessionId, setSessionId] = useState(null);

  // Initialize/shuffle cards
  const initializeGame = useCallback(async () => {
    const cardPairs = [...SYMBOLS, ...SYMBOLS];
    const shuffled = cardPairs
      .map((symbol, index) => ({ id: index, symbol, matched: false }))
      .sort(() => Math.random() - 0.5);
    setCards(shuffled);
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setGameState('playing');
    setCanFlip(true);
    
    // Create game session when starting
    if (onGameStart) {
      const newSessionId = await onGameStart('memoryFlip');
      setSessionId(newSessionId);
    }
  }, [onGameStart]);

  // Handle card click
  const handleCardClick = (index) => {
    if (!canFlip || gameState !== 'playing') return;
    if (flipped.includes(index) || matched.includes(index)) return;
    if (flipped.length >= 2) return;

    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);

    // Check for match when 2 cards are flipped
    if (newFlipped.length === 2) {
      setMoves(moves + 1);
      setCanFlip(false);

      const [firstIndex, secondIndex] = newFlipped;
      if (cards[firstIndex].symbol === cards[secondIndex].symbol) {
        // Match found
        setMatched([...matched, firstIndex, secondIndex]);
        setFlipped([]);
        setCanFlip(true);
      } else {
        // No match - flip back after delay
        setTimeout(() => {
          setFlipped([]);
          setCanFlip(true);
        }, 1000);
      }
    }
  };

  // Check for win condition
  useEffect(() => {
    if (matched.length === cards.length && cards.length > 0 && gameState === 'playing') {
      setGameState('won');
      onGameWin(sessionId); // Pass sessionId instead of points
    }
  }, [matched, cards.length, gameState, onGameWin, sessionId]);

  return (
    <div className="flex flex-col items-center space-y-4 md:space-y-6 p-2 md:p-4">
      {/* Title */}
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-2xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          Memory Flip
        </h2>
        <p className="text-sm md:text-base text-gray-300">Match all the pairs!</p>
        {gameState === 'playing' && (
          <div className="text-lg md:text-xl font-semibold text-purple-300">
            Moves: {moves}
          </div>
        )}
      </div>

      {/* Intro Screen */}
      {gameState === 'intro' && (
        <div className="text-center max-w-md space-y-4">
          <p className="text-base md:text-lg text-gray-300">
            Find all 8 matching pairs to win 6 SubPoints!
          </p>
          <button
            onClick={initializeGame}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Start Game
          </button>
        </div>
      )}

      {/* Game Board */}
      {gameState === 'playing' && (
        <div className="grid grid-cols-4 gap-2 md:gap-3 w-full max-w-2xl">
          {cards.map((card, index) => {
            const isFlipped = flipped.includes(index) || matched.includes(index);
            const isMatched = matched.includes(index);

            return (
              <button
                key={card.id}
                onClick={() => handleCardClick(index)}
                disabled={!canFlip || isFlipped}
                className={`
                  aspect-square rounded-xl text-4xl md:text-5xl font-bold transition-all duration-300 transform
                  ${isFlipped ? 'rotate-0' : 'rotate-y-180'}
                  ${isMatched 
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 cursor-default' 
                    : isFlipped
                      ? 'bg-gradient-to-br from-purple-600 to-pink-600 hover:scale-105'
                      : 'bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 hover:scale-105'
                  }
                  ${!canFlip && !isFlipped ? 'opacity-75 cursor-not-allowed' : ''}
                  shadow-lg hover:shadow-xl
                `}
              >
                {isFlipped ? card.symbol : '?'}
              </button>
            );
          })}
        </div>
      )}

      {/* Win Screen */}
      {gameState === 'won' && (
        <div className="text-center space-y-4 max-w-md">
          <div className="text-4xl md:text-6xl animate-bounce">🎉</div>
          <div className="space-y-2">
            <p className="text-xl md:text-2xl font-bold text-green-400">
              You Won!
            </p>
            <p className="text-base md:text-lg text-gray-300">
              Completed in {moves} moves
            </p>
            <p className="text-lg md:text-xl font-semibold text-purple-300">
              +6 SubPoints earned!
            </p>
          </div>
          <button
            onClick={() => setGameState('intro')}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};

export default MemoryFlip;
