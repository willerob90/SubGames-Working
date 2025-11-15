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

const BlockBlast = ({ onGameWin, onGameStart }) => {
  const [grid, setGrid] = useState(() => Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));
  const [score, setScore] = useState(0);
  const [currentBlocks, setCurrentBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [draggedBlock, setDraggedBlock] = useState(null);
  const [dragPosition, setDragPosition] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const [explosions, setExplosions] = useState([]); // Track explosion animations
  const [sessionId, setSessionId] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);

  // Generate 3 random blocks
  const generateBlocks = useCallback(() => {
    const blocks = [];
    for (let i = 0; i < 3; i++) {
      const shape = BLOCK_SHAPES[Math.floor(Math.random() * BLOCK_SHAPES.length)];
      blocks.push({ id: Date.now() + i, shape });
    }
    return blocks;
  }, []);

  // Initialize blocks and create session
  useEffect(() => {
    if (!gameStarted) {
      setCurrentBlocks(generateBlocks());
      setGameStarted(true);
      
      // Create game session when game loads
      if (onGameStart) {
        onGameStart('blockBlast').then(newSessionId => {
          setSessionId(newSessionId);
        });
      }
    }
  }, [generateBlocks, onGameStart, gameStarted]);

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

    // Trigger explosion animations
    const newExplosions = [];
    rowsToClear.forEach(r => {
      for (let c = 0; c < GRID_SIZE; c++) {
        newExplosions.push({
          id: `${Date.now()}-${r}-${c}`,
          row: r,
          col: c
        });
      }
    });
    colsToClear.forEach(c => {
      for (let r = 0; r < GRID_SIZE; r++) {
        // Avoid duplicates from row/col intersections
        if (!rowsToClear.includes(r)) {
          newExplosions.push({
            id: `${Date.now()}-${r}-${c}`,
            row: r,
            col: c
          });
        }
      }
    });

    if (newExplosions.length > 0) {
      setExplosions(newExplosions);
      // Clear explosions after animation completes
      setTimeout(() => setExplosions([]), 600);
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

    // Check for win condition (score >= 100) - only award once
    if (newScore >= 100 && !hasWon && onGameWin) {
      setHasWon(true);
      onGameWin(sessionId);
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
  }, [grid, score, currentBlocks, generateBlocks, canPlaceBlock, onGameWin, hasWon]);

  // Handle drag start (touch and mouse)
  const handleDragStart = useCallback((block, e) => {
    if (e.cancelable) {
      e.preventDefault();
    }
    setDraggedBlock(block);
    setSelectedBlock(block);
    setIsDragging(true);
    
    // Set initial drag position
    const touch = e.touches ? e.touches[0] : e;
    setDragPosition({ x: touch.clientX, y: touch.clientY });
  }, []);

  // Add global touch/mouse move and end listeners
  useEffect(() => {
    const handleDragEnd = (e) => {
      if (!draggedBlock) return;
      
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      const gridElement = document.getElementById('block-blast-grid');
      
      if (gridElement) {
        const gridRect = gridElement.getBoundingClientRect();
        const cellSize = gridRect.width / GRID_SIZE;
        
        // Calculate which cell the block was dropped on
        const relativeX = touch.clientX - gridRect.left;
        const relativeY = touch.clientY - gridRect.top;
        
        if (relativeX >= 0 && relativeX < gridRect.width && relativeY >= 0 && relativeY < gridRect.height) {
          const col = Math.floor(relativeX / cellSize);
          const row = Math.floor(relativeY / cellSize);
          
          if (canPlaceBlock(draggedBlock, row, col)) {
            placeBlock(draggedBlock, row, col);
          }
        }
      }
      
      setDraggedBlock(null);
      setDragPosition(null);
      setIsDragging(false);
      setSelectedBlock(null);
    };

    const handleGlobalMove = (e) => {
      if (isDragging && draggedBlock) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const touch = e.touches ? e.touches[0] : e;
        setDragPosition({ x: touch.clientX, y: touch.clientY });
      }
    };

    const handleGlobalEnd = (e) => {
      if (isDragging && draggedBlock) {
        handleDragEnd(e);
      }
    };

    if (isDragging) {
      document.addEventListener('touchmove', handleGlobalMove, { passive: false });
      document.addEventListener('touchend', handleGlobalEnd);
      document.addEventListener('mousemove', handleGlobalMove);
      document.addEventListener('mouseup', handleGlobalEnd);
    }

    return () => {
      document.removeEventListener('touchmove', handleGlobalMove);
      document.removeEventListener('touchend', handleGlobalEnd);
      document.removeEventListener('mousemove', handleGlobalMove);
      document.removeEventListener('mouseup', handleGlobalEnd);
    };
  }, [isDragging, draggedBlock, canPlaceBlock, placeBlock]);

  // Get cell under drag position for preview
  const getDragHoveredCell = useCallback(() => {
    if (!dragPosition || !isDragging) return null;
    
    const gridElement = document.getElementById('block-blast-grid');
    if (!gridElement) return null;
    
    const gridRect = gridElement.getBoundingClientRect();
    const cellSize = gridRect.width / GRID_SIZE;
    
    const relativeX = dragPosition.x - gridRect.left;
    const relativeY = dragPosition.y - gridRect.top;
    
    if (relativeX >= 0 && relativeX < gridRect.width && relativeY >= 0 && relativeY < gridRect.height) {
      const col = Math.floor(relativeX / cellSize);
      const row = Math.floor(relativeY / cellSize);
      return [row, col];
    }
    
    return null;
  }, [dragPosition, isDragging]);

  // Reset game
  const resetGame = () => {
    setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0)));
    setScore(0);
    setCurrentBlocks(generateBlocks());
    setSelectedBlock(null);
    setGameOver(false);
    setHasWon(false);
  };

  // Check if placement is valid when hovering
  const getPreviewGrid = useCallback(() => {
    const targetCell = isDragging ? getDragHoveredCell() : null;
    const blockToPreview = isDragging ? draggedBlock : selectedBlock;
    
    if (!blockToPreview || !targetCell) return grid;
    
    const [row, col] = targetCell;
    if (!canPlaceBlock(blockToPreview, row, col)) return grid;

    const previewGrid = grid.map(r => [...r]);
    for (let r = 0; r < blockToPreview.shape.length; r++) {
      for (let c = 0; c < blockToPreview.shape[r].length; c++) {
        if (blockToPreview.shape[r][c] === 1) {
          previewGrid[row + r][col + c] = 2; // 2 = preview
        }
      }
    }
    return previewGrid;
  }, [grid, selectedBlock, canPlaceBlock, isDragging, getDragHoveredCell, draggedBlock]);

  const previewGrid = getPreviewGrid();

  return (
    <div className="flex flex-col items-center space-y-3 md:space-y-6 p-2 md:p-4">
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-xl md:text-3xl font-bold text-purple-400">Block Blast</h2>
        <p className="text-xs md:text-base text-gray-400">Place blocks to clear rows and columns!</p>
        <div className="flex items-center justify-center space-x-2 md:space-x-4">
          <div className="bg-gray-800 px-3 py-1.5 md:px-6 md:py-3 rounded-lg border border-gray-700">
            <span className="text-xs md:text-sm text-gray-400">Score: </span>
            <span className="text-lg md:text-2xl font-bold text-green-400">{score}</span>
          </div>
          <div className="bg-gray-800 px-3 py-1.5 md:px-6 md:py-3 rounded-lg border border-gray-700">
            <span className="text-xs md:text-sm text-gray-400">Goal: </span>
            <span className="text-base md:text-xl font-bold text-yellow-400">100</span>
          </div>
        </div>
      </div>

      {/* Game Grid */}
      <div 
        id="block-blast-grid"
        className="bg-gray-800 p-2 md:p-4 rounded-xl border-2 border-gray-700"
        style={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${GRID_SIZE}, 40px)`,
          gap: '2px',
          touchAction: 'none'
        }}
      >
        {previewGrid.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const hasExplosion = explosions.some(e => e.row === rowIndex && e.col === colIndex);
            
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`w-10 h-10 rounded transition-all relative ${
                  cell === 1 
                    ? 'bg-purple-600 shadow-lg' 
                    : cell === 2 
                    ? 'bg-green-500 opacity-60'
                    : 'bg-gray-700'
                }`}
              >
                {/* Explosion Animation */}
                {hasExplosion && (
                  <>
                    <div className="absolute inset-0 bg-yellow-400 rounded animate-ping opacity-75" />
                    <div className="absolute inset-0 bg-orange-500 rounded animate-pulse" />
                    <div className="absolute inset-0 flex items-center justify-center text-2xl animate-bounce">
                      💥
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Available Blocks */}
      <div className="space-y-1 md:space-y-2">
        <p className="text-center text-gray-400 text-xs md:text-sm">Drag blocks onto the grid to place them</p>
        <div className="flex space-x-2 md:space-x-4 justify-center">
          {currentBlocks.map((block) => (
            <div
              key={block.id}
              onTouchStart={(e) => handleDragStart(block, e)}
              onMouseDown={(e) => handleDragStart(block, e)}
              className={`p-2 md:p-3 rounded-lg cursor-grab active:cursor-grabbing transition-all touch-none select-none ${
                draggedBlock?.id === block.id 
                  ? 'opacity-30 scale-95' 
                  : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:scale-105'
              }`}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${block.shape[0].length}, 20px)`,
                gap: '2px',
                touchAction: 'none'
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
        <div className="bg-red-900/50 border-2 border-red-600 p-4 md:p-6 rounded-xl text-center">
          <p className="text-xl md:text-2xl font-bold text-red-400 mb-1 md:mb-2">Game Over!</p>
          <p className="text-sm md:text-base text-gray-300 mb-3 md:mb-4">Final Score: {score}</p>
          <button
            onClick={resetGame}
            className="px-4 py-2 md:px-6 md:py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors text-sm md:text-base"
          >
            Play Again
          </button>
        </div>
      )}

      {score >= 100 && (
        <div className="bg-yellow-900/50 border-2 border-yellow-500 p-4 md:p-6 rounded-xl text-center animate-pulse">
          <p className="text-xl md:text-2xl font-bold text-yellow-400">🎉 You Win! 🎉</p>
          <p className="text-sm md:text-base text-gray-300">You earned 5 Sub Points for your creator!</p>
        </div>
      )}

      {/* Floating Drag Preview */}
      {isDragging && draggedBlock && dragPosition && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            transform: 'translate(-50%, -50%)',
            display: 'grid',
            gridTemplateColumns: `repeat(${draggedBlock.shape[0].length}, 24px)`,
            gap: '2px'
          }}
        >
          {draggedBlock.shape.map((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                className={`w-6 h-6 rounded ${
                  cell === 1 ? 'bg-purple-500 shadow-lg opacity-80' : 'bg-transparent'
                }`}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default BlockBlast;
