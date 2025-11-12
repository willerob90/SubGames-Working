import React, { useState, useEffect, useCallback } from 'react';

const PatternPro = ({ onGameWin }) => {
  const [currentLevel, setCurrentLevel] = useState(1);
  const [pattern, setPattern] = useState([]);
  const [options, setOptions] = useState([]);
  const [correctAnswer, setCorrectAnswer] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [gameState, setGameState] = useState('intro'); // intro, playing, correct, wrong, won
  const [timeLeft, setTimeLeft] = useState(15);
  const [combo, setCombo] = useState(0);

  // Fun emoji sets for patterns
  const EMOJI_SETS = [
    ['🍕', '🍔', '🌭', '🍟', '🌮', '🍿'],
    ['⚽', '🏀', '🎾', '🏈', '⚾', '🎱'],
    ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊'],
    ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️'],
    ['⭐', '💫', '✨', '🌟', '💥', '🔥'],
    ['🎸', '🎹', '🎺', '🎷', '🥁', '🎻'],
    ['🌈', '☀️', '⛅', '🌙', '⭐', '💫'],
    ['🎮', '🎯', '🎲', '🎪', '🎨', '🎭'],
  ];

  // Generate fun visual pattern
  const generatePattern = useCallback((level) => {
    const emojiSet = EMOJI_SETS[Math.floor(Math.random() * EMOJI_SETS.length)];
    const patternLength = 3 + Math.floor(level / 3); // Grows with level
    const basePatternSize = Math.min(2 + Math.floor(level / 4), 3);
    const basePattern = emojiSet.slice(0, basePatternSize);
    
    const sequence = [];
    for (let i = 0; i < patternLength; i++) {
      sequence.push(basePattern[i % basePattern.length]);
    }
    
    const answer = basePattern[patternLength % basePattern.length];
    
    // Create 4 options including the correct answer
    const wrongOptions = emojiSet.filter(e => e !== answer).slice(0, 3);
    const allOptions = [answer, ...wrongOptions].sort(() => Math.random() - 0.5);
    
    setPattern(sequence);
    setCorrectAnswer(answer);
    setOptions(allOptions);
    setSelectedAnswer(null);
    setTimeLeft(15 - Math.floor(level / 2)); // Faster as you progress
  }, []);

  // Start game
  const startGame = useCallback(() => {
    setCurrentLevel(1);
    setCombo(0);
    setGameState('playing');
    generatePattern(1);
  }, [generatePattern]);

  // Timer countdown
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    if (timeLeft <= 0) {
      setGameState('wrong');
      setCombo(0);
      setTimeout(() => {
        setGameState('intro');
      }, 2000);
      return;
    }
    
    const timer = setInterval(() => {
      setTimeLeft(t => t - 1);
    }, 1000);
    
    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  // Handle answer selection
  const handleAnswer = (answer) => {
    if (selectedAnswer !== null) return;
    
    setSelectedAnswer(answer);
    
    if (answer === correctAnswer) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      setGameState('correct');
      
      setTimeout(() => {
        if (currentLevel >= 10) {
          setGameState('won');
          onGameWin(10); // Award 10 points
        } else {
          setCurrentLevel(currentLevel + 1);
          setGameState('playing');
          generatePattern(currentLevel + 1);
        }
      }, 1000);
    } else {
      setGameState('wrong');
      setCombo(0);
      
      setTimeout(() => {
        setGameState('intro');
      }, 2000);
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4 md:space-y-6 p-2 md:p-4">
      {/* Title */}
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-2xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
          Pattern Pro
        </h2>
        <p className="text-sm md:text-base text-gray-300">Spot the pattern, pick what's next!</p>
        {gameState === 'playing' && (
          <div className="flex items-center justify-center gap-4 mt-2">
            <div className="text-lg md:text-xl font-semibold text-purple-300">
              Level {currentLevel}/10
            </div>
            <div className={`text-lg md:text-xl font-bold px-3 py-1 rounded-full ${
              timeLeft <= 5 ? 'bg-red-500/30 text-red-300 animate-pulse' : 'bg-cyan-500/30 text-cyan-300'
            }`}>
              ⏱️ {timeLeft}s
            </div>
            {combo > 0 && (
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
          <div className="text-6xl animate-bounce">🎯</div>
          <p className="text-base md:text-lg text-gray-300">
            Complete 10 visual patterns to win 10 SubPoints!
          </p>
          <p className="text-sm text-gray-400">
            Quick reflexes and sharp eyes needed! ⚡
          </p>
          <button
            onClick={startGame}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-600 hover:from-pink-500 hover:via-purple-500 hover:to-cyan-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105"
          >
            Start Challenge
          </button>
        </div>
      )}

      {/* Playing State */}
      {(gameState === 'playing' || gameState === 'correct' || gameState === 'wrong') && (
        <div className="w-full max-w-2xl space-y-6">
          {/* Pattern Display */}
          <div className="bg-gradient-to-br from-purple-900/40 to-pink-900/40 backdrop-blur-sm rounded-2xl p-6 md:p-8 border-2 border-purple-500/50 shadow-xl">
            <div className="flex items-center justify-center gap-2 md:gap-3 flex-wrap mb-4">
              {pattern.map((item, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl w-14 h-14 md:w-20 md:h-20 flex items-center justify-center text-3xl md:text-5xl shadow-lg transform hover:scale-110 transition-transform"
                  style={{
                    animation: `slideIn 0.3s ease-out ${index * 0.1}s both`
                  }}
                >
                  {item}
                </div>
              ))}
              <div className="text-3xl md:text-5xl text-pink-400 animate-pulse mx-2">
                →
              </div>
              <div className="bg-gradient-to-br from-pink-600/30 to-purple-600/30 border-2 border-dashed border-pink-400 rounded-2xl w-14 h-14 md:w-20 md:h-20 flex items-center justify-center text-3xl md:text-4xl text-pink-300 animate-pulse">
                ?
              </div>
            </div>
          </div>

          {/* Answer Options */}
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            {options.map((option, index) => {
              const isSelected = selectedAnswer === option;
              const isCorrect = option === correctAnswer;
              const showResult = selectedAnswer !== null;
              
              let buttonClass = 'rounded-2xl p-6 md:p-10 text-4xl md:text-6xl font-bold transition-all duration-300 shadow-lg ';
              
              if (showResult) {
                if (isSelected && isCorrect) {
                  buttonClass += 'bg-gradient-to-br from-green-500 to-emerald-600 scale-110 animate-bounce';
                } else if (isSelected && !isCorrect) {
                  buttonClass += 'bg-gradient-to-br from-red-500 to-rose-600 scale-90 opacity-50';
                } else if (isCorrect) {
                  buttonClass += 'bg-gradient-to-br from-green-500 to-emerald-600 scale-110 animate-pulse';
                } else {
                  buttonClass += 'bg-gradient-to-br from-gray-800 to-gray-900 opacity-30';
                }
              } else {
                buttonClass += 'bg-gradient-to-br from-gray-800 to-gray-900 hover:from-purple-600 hover:to-pink-600 hover:scale-110 cursor-pointer hover:shadow-2xl';
              }
              
              return (
                <button
                  key={index}
                  onClick={() => handleAnswer(option)}
                  disabled={selectedAnswer !== null}
                  className={buttonClass}
                >
                  {option}
                </button>
              );
            })}
          </div>

          {/* Feedback Message */}
          {gameState === 'correct' && (
            <div className="text-center">
              <p className="text-3xl font-bold text-green-400 animate-bounce">
                Perfect! 🎉
              </p>
            </div>
          )}
          {gameState === 'wrong' && (
            <div className="text-center space-y-2">
              <p className="text-3xl font-bold text-red-400">
                Oops! 😅
              </p>
              <p className="text-sm text-gray-400">Try again from the start!</p>
            </div>
          )}
        </div>
      )}

      {/* Win Screen */}
      {gameState === 'won' && (
        <div className="text-center space-y-4 max-w-md">
          <div className="text-6xl md:text-8xl animate-bounce">�</div>
          <div className="space-y-2">
            <p className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
              Pattern Master!
            </p>
            <p className="text-base md:text-lg text-gray-300">
              You crushed all 10 patterns! 🔥
            </p>
            <p className="text-xl md:text-2xl font-semibold text-purple-300">
              +10 SubPoints earned!
            </p>
          </div>
          <button
            onClick={() => setGameState('intro')}
            className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-pink-600 via-purple-600 to-cyan-600 hover:from-pink-500 hover:via-purple-500 hover:to-cyan-500 text-white text-base md:text-lg font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105"
          >
            Play Again
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default PatternPro;
