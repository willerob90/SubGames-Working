import React, { useState, useCallback, useEffect } from 'react';

const GRID_SIZE = 8;
const BLOCK_SHAPES = [
  // Single block
  [[1]],
  
  // 2x1 blocks
  [[1, 1]],
  [[1], [1]],
  
  // 3x1 blocks
  [[1, 1, 1]],
  [[1], [1], [1]],
  
  // L-shapes
  [[1, 0], [1, 0], [1, 1]],
  [[1, 1], [1, 0], [1, 0]],
  [[1, 1, 1], [1, 0, 0]],
  [[1, 0, 0], [1, 1, 1]],
  
  // T-shapes
  [[1, 1, 1], [0, 1, 0]],
  [[0, 1], [1, 1], [0, 1]],
  
  // Square
  [[1, 1], [1, 1]],
  
  // Plus sign
  [[0, 1, 0], [1, 1, 1], [0, 1, 0]],
];

const BlockBlast = ({ onGameWin, isGuest }) => {
  const [grid, setGrid] = useState(() => Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));
  const [score, setScore] = useState(0);
  const [currentBlocks, setCurrentBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [gameOver, setGameOver] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(null);

  // Generate 3 random blocks
  const generateBlocks = useCallback(() => {
    const blocks = [];
    for (let i = 0; i < 3; i++) {
      const shape = BLOCK_SHAPES[Math.floor(Math.random() * BLOCK_SHAPES.length)];
      blocks.push({ id: Date.now() + i, shape });
    }
    return blocks;
  }, []);

  // Initialize blocks
  useEffect(() => {
    setCurrentBlocks(generateBlocks());
  }, [generateBlocks]);

  // Check if a block can be placed at position
  const canPlaceBlock = useCallback((block, row, col) => {
    if (!block) return false;
    
    for (let r = 0; r < block.shape.length; r++) {
      for (let c = 0; c < block.shape[r].length; c++) {
        if (block.shape[r][c] === 1) {
          const newRow = row + r;
          const newCol = col + c;
          
          if (newRow >= GRID_SIZE || newCol >= GRID_SIZE || grid[newRow][newCol] === 1) {
            return false;
          }
        }
      }
    }
    return true;
  }, [grid]);

  // Place block on grid
  const placeBlock = useCallback((block, row, col) => {
    const newGrid = grid.map(r => [...r]);
    
    for (let r = 0; r < block.shape.length; r++) {
      for (let c = 0; c < block.shape[r].length; c++) {
        if (block.shape[r][c] === 1) {
          newGrid[row + r][col + c] = 1;
        }
      }
    }

    // Check for complete rows and columns
    let clearedLines = 0;
    const rowsToClear = [];
    const colsToClear = [];

    // Check rows
    for (let r = 0; r < GRID_SIZE; r++) {
      if (newGrid[r].every(cell => cell === 1)) {
        rowsToClear.push(r);
        clearedLines++;
      }
    }

    // Check columns
    for (let c = 0; c < GRID_SIZE; c++) {
      if (newGrid.every(row => row[c] === 1)) {
        colsToClear.push(c);
        clearedLines++;
      }
    }

    // Clear rows and columns
    rowsToClear.forEach(r => {
      for (let c = 0; c < GRID_SIZE; c++) {
        newGrid[r][c] = 0;
      }
    });

    colsToClear.forEach(c => {
      for (let r = 0; r < GRID_SIZE; r++) {
        newGrid[r][c] = 0;
      }
    });

    setGrid(newGrid);
    
    // Update score
    const blockScore = block.shape.flat().filter(c => c === 1).length;
    const clearBonus = clearedLines * 10;
    const newScore = score + blockScore + clearBonus;
    setScore(newScore);

    // Check for win condition (score >= 100)
    if (newScore >= 100 && onGameWin) {
      onGameWin(newScore);
    }

    // Remove used block
    const remainingBlocks = currentBlocks.filter(b => b.id !== block.id);
    
    // Generate new blocks if all used
    if (remainingBlocks.length === 0) {
      setCurrentBlocks(generateBlocks());
    } else {
      setCurrentBlocks(remainingBlocks);
      
      // Check if any remaining blocks can be placed
      const canPlaceAny = remainingBlocks.some(blk => {
        for (let r = 0; r < GRID_SIZE; r++) {
          for (let c = 0; c < GRID_SIZE; c++) {
            if (canPlaceBlock(blk, r, c)) return true;
          }
        }
        return false;
      });

      if (!canPlaceAny) {
        setGameOver(true);
      }
    }

    setSelectedBlock(null);
  }, [grid, score, currentBlocks, generateBlocks, canPlaceBlock, onGameWin]);

  // Handle grid cell click
  const handleCellClick = useCallback((row, col) => {
    if (!selectedBlock || gameOver) return;
    
    if (canPlaceBlock(selectedBlock, row, col)) {
      placeBlock(selectedBlock, row, col);
    }
  }, [selectedBlock, gameOver, canPlaceBlock, placeBlock]);

  // Reset game
  const resetGame = () => {
    setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));
    setScore(0);
    setCurrentBlocks(generateBlocks());
    setSelectedBlock(null);
    setGameOver(false);
  };

  // Check if placement is valid when hovering
  const getPreviewGrid = useCallback(() => {
    if (!selectedBlock || !hoveredCell) return grid;
    
    const [row, col] = hoveredCell;
    if (!canPlaceBlock(selectedBlock, row, col)) return grid;

    const previewGrid = grid.map(r => [...r]);
    for (let r = 0; r < selectedBlock.shape.length; r++) {
      for (let c = 0; c < selectedBlock.shape[r].length; c++) {
        if (selectedBlock.shape[r][c] === 1) {
          previewGrid[row + r][col + c] = 2; // 2 = preview
        }
      }
    }
    return previewGrid;
  }, [grid, selectedBlock, hoveredCell, canPlaceBlock]);

  const previewGrid = getPreviewGrid();

  return (
    <div className="flex flex-col items-center space-y-6 p-4">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-purple-400">Block Blast</h2>
        <p className="text-gray-400">Place blocks to clear rows and columns!</p>
        <div className="flex items-center justify-center space-x-4">
          <div className="bg-gray-800 px-6 py-3 rounded-lg border border-gray-700">
            <span className="text-sm text-gray-400">Score: </span>
            <span className="text-2xl font-bold text-green-400">{score}</span>
          </div>
          <div className="bg-gray-800 px-6 py-3 rounded-lg border border-gray-700">
            <span className="text-sm text-gray-400">Goal: </span>
            <span className="text-xl font-bold text-yellow-400">100</span>
          </div>
        </div>
      </div>

      {/* Game Grid */}
      <div 
        className="bg-gray-800 p-4 rounded-xl border-2 border-gray-700"
        style={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${GRID_SIZE}, 40px)`,
          gap: '2px'
        }}
      >
        {previewGrid.map((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <div
              key={`${rowIndex}-${colIndex}`}
              onClick={() => handleCellClick(rowIndex, colIndex)}
              onMouseEnter={() => setHoveredCell([rowIndex, colIndex])}
              onMouseLeave={() => setHoveredCell(null)}
              className={`w-10 h-10 rounded transition-all cursor-pointer ${
                cell === 1 
                  ? 'bg-purple-600 shadow-lg' 
                  : cell === 2 
                  ? 'bg-green-500 opacity-50'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
            />
          ))
        )}
      </div>

      {/* Available Blocks */}
      <div className="space-y-2">
        <p className="text-center text-gray-400 text-sm">Click a block, then click the grid to place it</p>
        <div className="flex space-x-4">
          {currentBlocks.map((block) => (
            <div
              key={block.id}
              onClick={() => setSelectedBlock(block)}
              className={`p-3 rounded-lg cursor-pointer transition-all ${
                selectedBlock?.id === block.id 
                  ? 'bg-blue-600 shadow-xl scale-110' 
                  : 'bg-gray-800 hover:bg-gray-700 border border-gray-600'
              }`}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${block.shape[0].length}, 20px)`,
                gap: '2px'
              }}
            >
              {block.shape.map((row, r) =>
                row.map((cell, c) => (
                  <div
                    key={`${r}-${c}`}
                    className={`w-5 h-5 rounded ${
                      cell === 1 ? 'bg-purple-500' : 'bg-transparent'
                    }`}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Game Over / Win Message */}
      {gameOver && (
        <div className="bg-red-900/50 border-2 border-red-600 p-6 rounded-xl text-center">
          <p className="text-2xl font-bold text-red-400 mb-2">Game Over!</p>
          <p className="text-gray-300 mb-4">Final Score: {score}</p>
          <button
            onClick={resetGame}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors"
          >
            Play Again
          </button>
        </div>
      )}

      {score >= 100 && !isGuest && (
        <div className="bg-green-900/50 border-2 border-green-600 p-6 rounded-xl text-center animate-pulse">
          <p className="text-2xl font-bold text-green-400">🎉 You Win! 🎉</p>
          <p className="text-gray-300">You earned 1 Sub Point for your creator!</p>
        </div>
      )}

      {isGuest && (
        <p className="text-yellow-400 text-sm text-center">
          ⚠️ Guest Mode - Points don&apos;t count. Sign in to earn points!
        </p>
      )}
    </div>
  );
};

export default BlockBlast;
