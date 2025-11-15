import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, onSnapshot, collection, updateDoc, increment, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, firebaseConfig } from './firebaseConfig';
import { AuthProvider, useAuth } from './AuthContext';
import WelcomePage from './WelcomePage';
import CreatorProfile from './CreatorProfile';
import CreatorOnboarding from './CreatorOnboarding';
import BlockBlast from './games/BlockBlast';
import ColorMatch from './games/ColorMatch';
import MemoryFlip from './games/MemoryFlip';
import PatternPro from './games/PatternPro';
import WhackAMole from './games/WhackAMole';

// --- CONFIGURATION SETUP ---
// NOTE: Global variables (__app_id, etc.) are used here for compatibility 
// with the Canvas environment. They are safely checked for existence.

// Fallback configuration for running the app outside the Canvas (e.g., local VS Code)
// Note: Firebase is now initialized in firebaseConfig.js

// Function to safely determine the appId
const getAppId = () => {
    // If running outside the Canvas, we MUST use the projectId 
    // as the default appId to ensure the Firestore path is correct 
    // for local development based on the security rules structure.

    // eslint-disable-next-line no-undef
    if (typeof __app_id !== 'undefined' && __app_id) {
        // eslint-disable-next-line no-undef
        return __app_id;
    }

    // *** NEW LOGIC: Use the projectId from the config as the local App ID ***
    return firebaseConfig.projectId;
}

// eslint-disable-next-line no-unused-vars
const appId = getAppId(); // Kept for potential future use

// --- UTILITY FUNCTIONS ---

// Cycle Management Utilities
const getCurrentCycleId = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}-18:00`;
};

// Helper functions for cycle-based structure
const getUserDocRef = (db, userId) => {
  return doc(db, 'users', userId);
};

const getCyclePickRef = (db, cycleId, userId) => {
  return doc(db, 'cycles', cycleId, 'picks', userId);
};

const getCycleLeaderboardRef = (db, cycleId, creatorId) => {
  return doc(db, 'cycles', cycleId, 'leaderboard', creatorId);
};

// --- MAIN REACT COMPONENT ---

const MainApp = () => {
  const { userProfile } = useAuth();
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('minigame'); // 'minigame', 'leaderboard', 'creatorhub', 'creatorprofile'
  const [selectedGame, setSelectedGame] = useState(null); // null for library, 'reaction' or 'blockblast' for playing
  const [playerPoints, setPlayerPoints] = useState(0); // Points earned this cycle
  const [optimisticPoints, setOptimisticPoints] = useState(0); // Immediate UI update
  const [showPointsAnimation, setShowPointsAnimation] = useState(null); // Show +X animation
  const [creators, setCreators] = useState([]); // Leaderboard data
  const [selectedCreator, setSelectedCreator] = useState(null); // User's daily pick
  const [selectedCreatorProfile, setSelectedCreatorProfile] = useState(null); // Selected creator's full profile
  const [currentCycleId] = useState(getCurrentCycleId());
  const [reactionTestState, setReactionTestState] = useState('initial'); // 'initial', 'wait', 'go', 'result'
  const [reactionTime, setReactionTime] = useState(null);
  const [gameSessionId, setGameSessionId] = useState(null); // Store session ID
  const [gameStartTime, setGameStartTime] = useState(null); // Store start time
  const [profile, setProfile] = useState({ name: '', contentUrl: '' });
  const [profileStatus, setProfileStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [cycleWinner, setCycleWinner] = useState(null); // Yesterday's winner
  const [hasPityPoint, setHasPityPoint] = useState(false); // User has pity point
  const [showCreatorOnboarding, setShowCreatorOnboarding] = useState(false); // Show onboarding modal

  // 1. AUTHENTICATION EFFECT
  useEffect(() => {
    let isMounted = true; // Flag to prevent state updates after unmount

    // NOTE: Removed automatic anonymous sign-in
    // The new auth flow requires users to choose their auth method on the welcome page first
    // Authentication is now handled by AuthContext (Google/Apple sign-in or guest mode)

    // Auth state change listener (Handles initial state and subsequent sign-outs)
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (isMounted) {
        setUser(currentUser);
        setIsAuthReady(true);
        setLoading(false);
        
        if (currentUser && !currentUser.isAnonymous) {
          // Create/update user document in new structure
          const userDocRef = getUserDocRef(db, currentUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            // Create new user document
            await setDoc(userDocRef, {
              email: currentUser.email || '',
              displayName: currentUser.displayName || 'Anonymous Player',
              photoURL: currentUser.photoURL || '',
              accountType: 'player',
              createdAt: Date.now(),
              totalGamesPlayed: 0,
              totalPointsEarned: 0,
              currentStreak: 0,
              suspicionScore: 0,
              requiresCaptcha: false
            });
          }
        }
      }
    });

    return () => {
        isMounted = false; // Cleanup flag
        unsubscribe(); // Cleanup listener
    }
  }, []); // Removed isAuthReady to prevent infinite loop

  // Check if creator needs onboarding
  useEffect(() => {
    if (userProfile && userProfile.accountType === 'creator' && !userProfile.creatorProfile?.profileComplete) {
      setShowCreatorOnboarding(true);
    } else {
      setShowCreatorOnboarding(false);
    }
  }, [userProfile]);

  // 2. CYCLE PICK DATA LISTENER (User's current pick and points earned this cycle)
  useEffect(() => {
    // Skip if not authenticated
    if (!user || !isAuthReady) {
      setPlayerPoints(0);
      setSelectedCreator(null);
      return;
    }

    const cyclePickRef = getCyclePickRef(db, currentCycleId, user.uid);

    const unsubscribe = onSnapshot(cyclePickRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const dbPoints = data.pointsEarned || 0;
        setPlayerPoints(dbPoints);
        // Sync optimistic points with database (in case of discrepancy)
        setOptimisticPoints(dbPoints);
        setSelectedCreator(data.creatorId || null);
      } else {
        // No pick yet for this cycle
        setPlayerPoints(0);
        setOptimisticPoints(0);
        setSelectedCreator(null);
      }
    });

    return unsubscribe;
  }, [user, isAuthReady, currentCycleId]);

  // Fetch selected creator's profile
  useEffect(() => {
    if (!selectedCreator) {
      setSelectedCreatorProfile(null);
      return;
    }

    const fetchCreatorProfile = async () => {
      try {
        const creatorRef = getUserDocRef(db, selectedCreator);
        const creatorSnap = await getDoc(creatorRef);
        
        if (creatorSnap.exists()) {
          setSelectedCreatorProfile(creatorSnap.data());
        }
      } catch (error) {
        console.error('Error fetching creator profile:', error);
      }
    };

    fetchCreatorProfile();
  }, [selectedCreator]);

  // 3. CREATOR/LEADERBOARD DATA LISTENER (Cycle-based)
  useEffect(() => {
    if (!db || !isAuthReady) return; // Wait until auth is ready

    const leaderboardRef = collection(db, 'cycles', currentCycleId, 'leaderboard');

    const unsubscribe = onSnapshot(leaderboardRef, async (snapshot) => {
      const creatorList = [];
      
      for (const docSnap of snapshot.docs) {
        const leaderboardData = docSnap.data();
        
        // Fetch creator profile from users collection
        const userRef = getUserDocRef(db, docSnap.id);
        const userSnap = await getDoc(userRef);
        
        const userData = userSnap.data();
        const isCreator = userData?.accountType === 'creator' || userData?.isCreator === true;
        
        if (userSnap.exists() && isCreator) {
          creatorList.push({
            id: docSnap.id,
            name: userData.displayName,
            contentUrl: userData.promotionalURL || userData.creatorProfile?.promotionalUrl || '',
            points: leaderboardData.totalPoints || 0,
            supporterCount: leaderboardData.supporterCount || 0,
            photoURL: userData.photoURL || ''
          });
        }
      }

      // Sort by points (highest first)
      creatorList.sort((a, b) => b.points - a.points);

      setCreators(creatorList);

      // Pre-fill profile if user is already a creator
      if (user && userProfile?.accountType === 'creator') {
        setProfile({ 
          name: userProfile.displayName, 
          contentUrl: userProfile.promotionalURL || '' 
        });
      }
    }, (error) => {
      console.error("Error fetching creators:", error);
    });

    return unsubscribe;
  }, [isAuthReady, currentCycleId, user, userProfile]); // Added dependencies

  // 4. LOAD YESTERDAY'S WINNER AND CHECK PITY POINTS
  useEffect(() => {
    const loadWinnerAndPityPoints = async () => {
      if (!db || !isAuthReady) return;

      try {
        // Get the most recent completed cycle (today's if after 6pm, yesterday's if before 6pm)
        const now = new Date();
        const currentHour = now.getHours();
        
        // If it's before 6pm, show yesterday's winner. If after 6pm, show today's winner.
        const daysAgo = currentHour < 18 ? 1 : 0;
        const cycleDate = new Date();
        cycleDate.setDate(cycleDate.getDate() - daysAgo);
        
        const year = cycleDate.getFullYear();
        const month = String(cycleDate.getMonth() + 1).padStart(2, '0');
        const day = String(cycleDate.getDate()).padStart(2, '0');
        const completedCycleId = `${year}-${month}-${day}-18:00`;

        // Load the completed cycle's winner
        const winnerRef = doc(db, 'cycleWinners', completedCycleId);
        const winnerSnap = await getDoc(winnerRef);
        
        if (winnerSnap.exists()) {
          setCycleWinner(winnerSnap.data());
        }

        // Check if user is eligible for a pity point from the completed cycle
        if (user) {
          const eligibilityRef = doc(db, 'cycles', completedCycleId, 'pityPointsEligible', user.uid);
          const eligibilitySnap = await getDoc(eligibilityRef);
          
          if (eligibilitySnap.exists() && eligibilitySnap.data().eligibleForPityPoint && !eligibilitySnap.data().clickedWinnerLink) {
            setHasPityPoint(true);
          } else {
            setHasPityPoint(false);
          }
        }
      } catch (error) {
        console.error('Error loading winner and pity points:', error);
      }
    };

    loadWinnerAndPityPoints();
  }, [isAuthReady, user, currentCycleId]);

  // Helper function for optimistic updates and animations
  const showPointsEarned = useCallback((points) => {
    // Immediately update UI
    setOptimisticPoints(prev => prev + points);
    // Show animation
    setShowPointsAnimation(points);
    // Hide animation after 3 seconds
    setTimeout(() => setShowPointsAnimation(null), 3000);
  }, []);

  // --- MINIGAME LOGIC (Reaction Test) ---

  // Reset reaction test when leaving the game
  useEffect(() => {
    if (selectedGame !== 'reaction') {
      setReactionTestState('initial');
      setReactionTime(null);
      setGameSessionId(null);
      setGameStartTime(null);
    }
  }, [selectedGame]);

  const startReactionTest = useCallback(() => {
    if (!user || !selectedCreator) {
      setProfileStatus('Please pick a creator first before playing!');
      return;
    }
    
    // Start the visual game immediately - no delay
    setReactionTestState('wait');
    setReactionTime(null);
    const delay = Math.random() * 3000 + 2000; // 2 to 5 seconds
    setTimeout(() => {
      setReactionTestState('go');
      // Start tracking time from this moment
      setGameStartTime(Date.now());
    }, delay);
    
    // Create session in the background (don't await)
    const startGameSession = httpsCallable(functions, 'startGameSession');
    startGameSession({
      gameType: 'reaction',
      difficulty: 'standard'
    }).then(result => {
      const sessionId = result.data.sessionId;
      // Store session ID in state
      setGameSessionId(sessionId);
    }).catch(error => {
      console.error('Error starting game session:', error.message);
      // Don't show error to user - they're already playing
    });
  }, [user, selectedCreator]);

  const handleReactionClick = useCallback(async () => {
    if (view !== 'minigame') return;
    if (reactionTestState === 'wait') {
      // Too early click
      setReactionTestState('result');
      setReactionTime('Too Early!');
      return;
    }

    if (reactionTestState === 'go') {
      // Successful click!
      const timeElapsed = Date.now() - gameStartTime;
      setReactionTime(`${timeElapsed} ms`);
      setReactionTestState('result');

      if (timeElapsed < 500) {
        if (!user || !gameSessionId) {
          setProfileStatus('Error: Game session not started properly');
          return;
        }

        // Check if creator is selected
        if (!selectedCreator) {
          setProfileStatus('🎉 Nice! Pick a creator to start earning points for wins like this!');
          return;
        }

        // Show points immediately (optimistic update)
        showPointsEarned(1);

        try {
          // Call Cloud Function to validate and record the result
          const submitGameResult = httpsCallable(functions, 'submitGameResult');
          const result = await submitGameResult({
            sessionId: gameSessionId,
            timeTaken: timeElapsed
          });
          
          if (result.data.success) {
            setProfileStatus(`Success! +${result.data.pointsAwarded} points for ${creators.find(c => c.id === result.data.creatorId)?.name || 'creator'}!`);
          } else if (!result.data.success) {
            setProfileStatus('Error: Failed to submit game result');
            // Rollback optimistic update on error
            setOptimisticPoints(prev => prev - 1);
          }
        } catch (error) {
          console.error('Error submitting game result:', error.message);
          setProfileStatus(`Error submitting result: ${error.message}`);
          // Rollback optimistic update on error
          setOptimisticPoints(prev => prev - 1);
        }
      }
      return;
    }

    if (reactionTestState === 'initial' || reactionTestState === 'result') {
      startReactionTest();
    }
  }, [reactionTestState, user, view, startReactionTest, selectedCreator, gameSessionId, gameStartTime, creators, showPointsEarned]);


  // Handle Block Blast game win
  const handleBlockBlastWin = useCallback(async (sessionId) => {
    if (!user) {
      console.log('Cannot award points - user not logged in');
      return;
    }

    if (!selectedCreator) {
      alert('🎉 Great job! Pick a creator from the Creator Hub to start earning points!');
      return;
    }

    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    // Show points immediately (optimistic update)
    showPointsEarned(5);

    try {
      console.log('🎮 Block Blast Win! Submitting result...');

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +5 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
        // Rollback optimistic update on error
        setOptimisticPoints(prev => prev - 5);
      }
    } catch (error) {
      console.error('Error submitting Block Blast result:', error);
      setProfileStatus(`Error: ${error.message}`);
      // Rollback optimistic update on error
      setOptimisticPoints(prev => prev - 5);
    }
  }, [user, selectedCreator, creators, showPointsEarned]);

  // Handle Color Match game win
  const handleColorMatchWin = useCallback(async (sessionId) => {
    if (!user) {
      console.log('Cannot award points - user not logged in');
      return;
    }

    if (!selectedCreator) {
      alert('🎉 Amazing! Pick a creator from the Creator Hub to start earning points!');
      return;
    }

    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    // Show points immediately (optimistic update)
    showPointsEarned(8);

    try {
      console.log('🎨 Color Match Win! Submitting result...');

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +8 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
        // Rollback optimistic update on error
        setOptimisticPoints(prev => prev - 8);
      }
    } catch (error) {
      console.error('Error submitting Color Match result:', error);
      setProfileStatus(`Error: ${error.message}`);
      // Rollback optimistic update on error
      setOptimisticPoints(prev => prev - 8);
    }
  }, [user, selectedCreator, creators, showPointsEarned]);

  // Handle game start - create session
  const handleGameStart = useCallback(async (gameType) => {
    if (!user) {
      console.log('Cannot start game - user not logged in');
      return null;
    }

    if (!selectedCreator) {
      return null; // Will show alert on win if no creator selected
    }

    try {
      console.log(`� Starting ${gameType} game - creating session...`);
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const sessionResult = await startGameSession({
        gameType,
        difficulty: 'standard'
      });
      console.log('Session created:', sessionResult.data.sessionId);
      return sessionResult.data.sessionId;
    } catch (error) {
      console.error('Error creating game session:', error);
      return null;
    }
  }, [user, selectedCreator]);

  // Handle Memory Flip game win
  const handleMemoryFlipWin = useCallback(async (sessionId) => {
    if (!user) {
      console.log('Cannot award points - user not logged in');
      return;
    }

    if (!selectedCreator) {
      alert('🎉 Excellent memory! Pick a creator from the Creator Hub to start earning points!');
      return;
    }

    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    // Show points immediately (optimistic update)
    showPointsEarned(6);

    try {
      console.log('🃏 Memory Flip Win! Submitting result...');

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +6 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
        // Rollback optimistic update on error
        setOptimisticPoints(prev => prev - 6);
      }
    } catch (error) {
      console.error('Error submitting Memory Flip result:', error);
      setProfileStatus(`Error: ${error.message}`);
      // Rollback optimistic update on error
      setOptimisticPoints(prev => prev - 6);
    }
  }, [user, selectedCreator, creators, showPointsEarned]);

  // Handle Pattern Pro game win
  // Handle Pattern Pro game win
  const handlePatternProWin = useCallback(async (sessionId) => {
    if (!user) {
      console.log('Cannot award points - user not logged in');
      return;
    }

    if (!selectedCreator) {
      alert('🎉 Pattern master! Pick a creator from the Creator Hub to start earning points!');
      return;
    }

    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    // Show points immediately (optimistic update)
    showPointsEarned(10);

    try {
      console.log('🧩 Pattern Pro Win! Submitting result...');

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +10 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
        // Rollback optimistic update on error
        setOptimisticPoints(prev => prev - 10);
      }
    } catch (error) {
      console.error('Error submitting Pattern Pro result:', error);
      setProfileStatus(`Error: ${error.message}`);
      // Rollback optimistic update on error
      setOptimisticPoints(prev => prev - 10);
    }
  }, [user, selectedCreator, creators, showPointsEarned]);

  // Handle Whack-a-Mole game win
  const handleWhackAMoleWin = useCallback(async (sessionId) => {
    if (!user) {
      console.log('Cannot award points - user not logged in');
      return;
    }

    if (!selectedCreator) {
      alert('🎉 Quick reflexes! Pick a creator from the Creator Hub to start earning points!');
      return;
    }

    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    // Show points immediately (optimistic update)
    showPointsEarned(3);

    try {
      console.log('🎪 Whack-a-Mole Win! Submitting result...');

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +3 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
        // Rollback optimistic update on error
        setOptimisticPoints(prev => prev - 3);
      }
    } catch (error) {
      console.error('Error submitting Whack-a-Mole result:', error);
      setProfileStatus(`Error: ${error.message}`);
      // Rollback optimistic update on error
      setOptimisticPoints(prev => prev - 3);
    }
  }, [user, selectedCreator, creators, showPointsEarned]);

  const miniGameContent = useMemo(() => {
    // If a game is selected, show the game
    if (selectedGame === 'blockblast') {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <BlockBlast onGameWin={handleBlockBlastWin} onGameStart={handleGameStart} />
        </div>
      );
    }

    if (selectedGame === 'colormatch') {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <ColorMatch onGameWin={handleColorMatchWin} onGameStart={handleGameStart} />
        </div>
      );
    }

    if (selectedGame === 'memoryflip') {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <MemoryFlip onGameWin={handleMemoryFlipWin} onGameStart={handleGameStart} />
        </div>
      );
    }

    if (selectedGame === 'patternpro') {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <PatternPro onGameWin={handlePatternProWin} onGameStart={handleGameStart} />
        </div>
      );
    }

    if (selectedGame === 'whackamole') {
      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <WhackAMole onGameWin={handleWhackAMoleWin} onGameStart={handleGameStart} />
        </div>
      );
    }

    if (selectedGame === 'reaction') {
      const timeValue = reactionTime && reactionTime !== 'Too Early!' ? parseInt(reactionTime) : Infinity;
      const isWin = timeValue < 500;

      let message;
      let boxClass = 'cursor-pointer w-full h-80 flex items-center justify-center rounded-2xl shadow-xl transition-all duration-300 text-3xl font-bold';

      switch (reactionTestState) {
        case 'initial':
          boxClass += ' bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white';
          message = 'Click to Start Reaction Test';
          break;
        case 'wait':
          boxClass += ' bg-red-500 text-white';
          message = 'Wait for Green...';
          break;
        case 'go':
          boxClass += ' bg-green-500 text-white shadow-2xl shadow-green-400';
          message = 'CLICK NOW!';
          break;
        case 'result':
          boxClass += ' bg-gray-800 text-gray-100 border-2 border-gray-700';
          message = (
            <div className="text-center p-4">
              <p className="text-5xl mb-4">{reactionTime}</p>
              {reactionTime === 'Too Early!' && <p className="text-red-400">You lost this round: Too Early!</p>}
              {isWin && <p className="text-yellow-400">Success! You earned 1 Sub Point!</p>}
              {!isWin && reactionTime !== 'Too Early!' && reactionTime !== null && <p className="text-orange-400">Too slow. Try again!</p>}
              <button
                onClick={startReactionTest}
                className="mt-6 px-6 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-full hover:from-purple-500 hover:to-purple-600 transition-all shadow-md"
              >
                Play Again
              </button>
            </div>
          );
          break;
        default:
          message = 'Error';
      }

      return (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            ← Back to Games
          </button>
          <div id="reaction-box" className={boxClass} onClick={handleReactionClick}>
            {message}
          </div>
        </div>
      );
    }

    // Game Library View (default)
    const games = [
      {
        id: 'reaction',
        name: 'Reaction Test',
        icon: '🎯',
        description: 'Test your reflexes! Click as fast as you can when the screen turns green.',
        color: 'from-purple-600 to-purple-700',
        points: '1 point',
      },
      {
        id: 'whackamole',
        name: 'Whack-a-Mole',
        icon: '🎪',
        description: 'Tap the critters before they hide! Hit 30 in 30 seconds to win.',
        color: 'from-orange-500 to-red-600',
        points: '3 points',
      },
      {
        id: 'blockblast',
        name: 'Block Blast',
        icon: '🧩',
        description: 'Clear lines by placing blocks strategically. Reach 100 points to win!',
        color: 'from-yellow-500 to-yellow-600',
        points: '5 points',
      },
      {
        id: 'memoryflip',
        name: 'Memory Flip',
        icon: '🃏',
        description: 'Match all the pairs! Find 8 matching card pairs to win.',
        color: 'from-purple-500 to-pink-600',
        points: '6 points',
      },
      {
        id: 'colormatch',
        name: 'Color Match',
        icon: '🎨',
        description: 'Simon says! Repeat the color sequence. Reach level 8 to win!',
        color: 'from-blue-500 to-blue-600',
        points: '8 points',
      },
      {
        id: 'patternpro',
        name: 'Pattern Pro',
        icon: '🧠',
        description: 'Master the patterns! Solve 10 challenging pattern puzzles to win.',
        color: 'from-cyan-500 to-blue-600',
        points: '10 points',
      },
    ];

    return (
      <div className="space-y-6">
        {!selectedCreator && userProfile?.accountType === 'player' && (
          <div className="bg-blue-500/20 backdrop-blur-sm border border-blue-400/30 rounded-lg p-4 text-center">
            <div className="text-3xl mb-2">�</div>
            <p className="text-blue-100 text-sm md:text-base">
              <strong>Reminder:</strong> Pick a creator from the Creator Hub to make your points count!
            </p>
            <button
              onClick={() => setView('creatorhub')}
              className="mt-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-2 px-4 rounded-lg transition text-sm"
            >
              Choose a Creator
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {games.map((game) => {
            return (
              <button
                key={game.id}
                onClick={() => setSelectedGame(game.id)}
                className="group relative bg-white/10 backdrop-blur-sm rounded-2xl overflow-hidden hover:scale-105 hover:shadow-2xl hover:border-white/40 transition-all duration-300 shadow-xl border-2 border-white/20"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${game.color} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
                
                <div className="relative p-6 md:p-8 text-left">
                  <div className="text-6xl md:text-7xl mb-4">{game.icon}</div>
                  
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">
                    {game.name}
                  </h3>
                  
                  <p className="text-gray-200 mb-4 text-sm md:text-base">
                    {game.description}
                  </p>
                  
                  <div className="flex items-center justify-between">
                    <span className={`px-3 py-1 rounded-full bg-gradient-to-r ${game.color} text-white text-sm font-semibold`}>
                      Earn {game.points}
                    </span>
                    <span className="text-white font-semibold group-hover:translate-x-2 transition-transform">
                      Play Now →
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [selectedGame, reactionTestState, reactionTime, startReactionTest, handleReactionClick, handleBlockBlastWin, handleColorMatchWin, handleMemoryFlipWin, handlePatternProWin, handleWhackAMoleWin, handleGameStart, selectedCreator, userProfile]);

  // --- CREATOR HUB LOGIC ---

  const [selectedCreatorForModal, setSelectedCreatorForModal] = useState(null);
  const [allCreators, setAllCreators] = useState([]);

  // Fetch all creators for Creator Hub
  useEffect(() => {
    const fetchAllCreators = async () => {
      try {
        const usersRef = collection(db, 'users');
        const creatorsSnapshot = await getDocs(usersRef);
        
        const creatorsList = [];
        creatorsSnapshot.forEach((doc) => {
          const data = doc.data();
          const isCreator = data.accountType === 'creator' || data.isCreator === true;
          if (isCreator && data.creatorProfile?.profileComplete) {
            creatorsList.push({
              id: doc.id,
              name: data.displayName || 'Unknown Creator',
              photoURL: data.photoURL || '',
              channelUrl: data.creatorProfile?.channelUrl || '',
              promotionalUrl: data.creatorProfile?.promotionalUrl || '',
              platform: data.creatorProfile?.platform || 'Other',
              contentType: data.creatorProfile?.contentType || 'Other',
            });
          }
        });
        
        setAllCreators(creatorsList);
      } catch (error) {
        console.error('Error fetching creators:', error);
      }
    };

    if (view === 'creatorhub') {
      fetchAllCreators();
    }
  }, [view]);

  const handleSupportCreator = async (creatorId) => {
    if (!user) {
      alert('Please sign in to support a creator');
      return;
    }

    // Prevent switching if already supporting a creator
    if (selectedCreator && selectedCreator !== creatorId) {
      alert('You are already supporting a creator for this cycle. Your choice is locked until the next cycle.');
      return;
    }

    try {
      const cyclePickRef = getCyclePickRef(db, currentCycleId, user.uid);
      await setDoc(cyclePickRef, {
        creatorId: creatorId,
        pickedAt: Date.now()
      });

      setSelectedCreator(creatorId);
      setSelectedCreatorForModal(null);
      alert('Creator supported! You can now play games and earn points for them.');
      setView('minigame'); // Redirect to games
    } catch (error) {
      console.error('Error supporting creator:', error);
      alert('Error supporting creator. Please try again.');
    }
  };

  const getPlatformIcon = (platform) => {
    const icons = {
      'YouTube': '📺',
      'Twitch': '🎮',
      'Kick': '⚡',
      'TikTok': '🎵',
      'Other': '🌐'
    };
    return icons[platform] || '🌐';
  };

  const creatorHubContent = (
    <div className="space-y-6">
      {allCreators.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-gray-300 text-lg">No creators found yet</p>
          <p className="text-gray-400 text-sm mt-2">Be the first to sign up as a creator!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {allCreators.map((creator) => (
            <button
              key={creator.id}
              onClick={() => setSelectedCreatorForModal(creator)}
              className="hover:scale-105 transition-all duration-300"
            >
              <div className="flex flex-col items-center text-center">
                {creator.photoURL ? (
                  <img 
                    src={creator.photoURL} 
                    alt={creator.name}
                    className="w-20 h-20 md:w-24 md:h-24 rounded-full border-2 border-white/30 hover:border-white/60 transition-all mb-1"
                  />
                ) : (
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-3xl md:text-4xl border-2 border-white/30 hover:border-white/60 transition-all mb-1">
                    👤
                  </div>
                )}
                
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{getPlatformIcon(creator.platform)}</span>
                  <span className="text-sm text-gray-300 font-medium">{creator.platform}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Creator Detail Modal */}
      {selectedCreatorForModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedCreatorForModal(null)}>
          <div className="bg-gradient-to-br from-[#3B5998] to-[#2A4475] rounded-2xl p-6 max-w-md w-full border-2 border-white/20 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setSelectedCreatorForModal(null)}
              className="float-right text-white/70 hover:text-white text-2xl"
            >
              ×
            </button>
            
            <div className="text-center mb-6">
              {selectedCreatorForModal.photoURL ? (
                <img 
                  src={selectedCreatorForModal.photoURL} 
                  alt={selectedCreatorForModal.name}
                  className="w-24 h-24 rounded-full border-4 border-white/30 mx-auto mb-4"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-4xl border-4 border-white/30 mx-auto mb-4">
                  👤
                </div>
              )}
              
              <h2 className="text-2xl font-bold text-white mb-2">{selectedCreatorForModal.name}</h2>
              
              <div className="flex items-center justify-center gap-2 mb-4">
                <span className="text-3xl">{getPlatformIcon(selectedCreatorForModal.platform)}</span>
                <span className="text-gray-300">{selectedCreatorForModal.platform}</span>
              </div>

              {selectedCreatorForModal.contentType && (
                <div className="text-sm text-gray-300 bg-white/10 px-3 py-1 rounded-full inline-block mb-4">
                  {selectedCreatorForModal.contentType} Content
                </div>
              )}
            </div>

            <div className="space-y-3">
              {selectedCreator === selectedCreatorForModal.id ? (
                <div className="bg-green-500/20 border border-green-500/50 text-green-200 px-4 py-3 rounded-lg text-center font-semibold">
                  ✓ Currently Supporting
                </div>
              ) : (
                <button
                  onClick={() => handleSupportCreator(selectedCreatorForModal.id)}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-6 rounded-lg transition-all"
                >
                  💜 Support This Creator
                </button>
              )}

              {selectedCreatorForModal.promotionalUrl && (
                <button
                  onClick={() => window.open(selectedCreatorForModal.promotionalUrl, '_blank')}
                  className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3 px-6 rounded-lg transition-all border border-white/20"
                >
                  🔗 View Profile Links
                </button>
              )}

              {selectedCreatorForModal.channelUrl && (
                <button
                  onClick={() => window.open(selectedCreatorForModal.channelUrl, '_blank')}
                  className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3 px-6 rounded-lg transition-all border border-white/20"
                >
                  {getPlatformIcon(selectedCreatorForModal.platform)} Visit Channel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // --- LEADERBOARD LOGIC ---

  const handlePickCreator = useCallback(async (creatorId) => {
    if (!user) {
      setProfileStatus("Please sign in to pick a creator.");
      return;
    }

    try {
      const pickRef = getCyclePickRef(db, currentCycleId, user.uid);
      const pickSnap = await getDoc(pickRef);
      
      if (pickSnap.exists()) {
        // Update existing pick
        await updateDoc(pickRef, {
          creatorId: creatorId,
          lastSwitchedAt: Date.now(),
          switchCount: increment(1)
        });
        setProfileStatus(`Successfully switched to supporting ${creators.find(c => c.id === creatorId)?.name || 'creator'}!`);
      } else {
        // Create new pick
        await setDoc(pickRef, {
          userId: user.uid,
          creatorId: creatorId,
          pointsEarned: 0,
          pickedAt: Date.now(),
          lastSwitchedAt: Date.now(),
          switchCount: 0
        });
        
        // Add user to creator's supporter list
        const leaderboardRef = getCycleLeaderboardRef(db, currentCycleId, creatorId);
        const leaderboardSnap = await getDoc(leaderboardRef);
        
        if (leaderboardSnap.exists()) {
          const supporters = leaderboardSnap.data().supporters || [];
          if (!supporters.includes(user.uid)) {
            await updateDoc(leaderboardRef, {
              supporterCount: increment(1),
              supporters: [...supporters, user.uid]
            });
          }
        }
        
        setProfileStatus(`Now supporting ${creators.find(c => c.id === creatorId)?.name || 'creator'}! Start playing to earn points for them.`);
      }
      
      setSelectedCreator(creatorId);
    } catch (error) {
      console.error('Error picking creator:', error);
      setProfileStatus(`Error: ${error.message}`);
    }
  }, [user, creators, currentCycleId]);

  const leaderboardContent = (
    <div className="p-2 md:p-4 space-y-4 md:space-y-6">
      <div className="text-center">
        <h2 className="text-xl md:text-3xl font-extrabold text-white pb-2">Creator Leaderboard</h2>
      </div>

      {creators.length === 0 ? (
        <p className="text-white/60 text-sm md:text-base">No creators registered yet. Be the first!</p>
      ) : (
        <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-3 md:p-6 border border-white/20">
          <div className="border-2 border-yellow-400/50 bg-yellow-500/10 backdrop-blur-sm p-3 md:p-4 rounded-lg flex items-center shadow-md">
            {creators[0].photoURL && (
              <img 
                src={creators[0].photoURL} 
                alt={creators[0].name}
                className="w-8 h-8 md:w-10 md:h-10 rounded-full mr-2 md:mr-3 border-2 border-yellow-400 object-cover flex-shrink-0"
                onError={(e) => e.target.style.display = 'none'}
              />
            )}
            <p className="text-base md:text-2xl font-bold text-yellow-300 truncate">
              {creators[0].name} ({creators[0].points || 0} Points)
            </p>
          </div>

          <ul className="mt-4 md:mt-8 space-y-2 md:space-y-3">
            {creators.map((creator, index) => (
              <li
                key={creator.id}
                className="flex items-center justify-between p-2 md:p-4 bg-white/10 backdrop-blur-sm hover:bg-white/15 rounded-lg shadow-sm transition-all border border-white/20"
              >
                <div className="flex items-center flex-1 min-w-0">
                  {/* Profile Picture */}
                  {creator.photoURL ? (
                    <img 
                      src={creator.photoURL} 
                      alt={creator.name}
                      className="w-10 h-10 md:w-12 md:h-12 rounded-full mr-2 md:mr-4 border-2 border-yellow-400/70 flex-shrink-0 object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div 
                    className="w-10 h-10 md:w-12 md:h-12 rounded-full mr-2 md:mr-4 bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-lg md:text-xl font-bold flex-shrink-0 border border-white/30"
                    style={{ display: creator.photoURL ? 'none' : 'flex' }}
                  >
                    {creator.name.charAt(0).toUpperCase()}
                  </div>
                  
                  {/* Creator Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm md:text-lg font-medium text-white truncate">
                      {index + 1}. {creator.name}
                    </p>
                    <a href={creator.contentUrl} target="_blank" rel="noopener noreferrer" className="text-xs md:text-sm text-white/70 hover:text-white hover:underline truncate block">
                      {creator.contentUrl}
                    </a>
                    <p className="text-xs text-white/60 mt-1">
                      {creator.supporterCount || 0} supporter{creator.supporterCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                
                {/* Points */}
                <div className="ml-2 md:ml-4">
                  <span className="text-lg md:text-2xl font-extrabold text-yellow-400">{creator.points || 0}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // --- RENDERING ---

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900"><div className="text-xl font-medium text-gray-100">Loading The Subgames...</div></div>;
  }

  const currentViewContent = () => {
    switch (view) {
      case 'minigame':
        return miniGameContent;
      case 'leaderboard':
        return leaderboardContent;
      case 'creatorhub':
        return creatorHubContent;
      case 'creatorprofile':
        return <CreatorProfile />;
      default:
        return <div>Select a view.</div>;
    }
  };

  const handleClickWinnerLink = async () => {
    if (!cycleWinner || !cycleWinner.promotionalURL) return;

    try {
      // Get the completed cycle (same logic as loadWinnerAndPityPoints)
      const now = new Date();
      const currentHour = now.getHours();
      const daysAgo = currentHour < 18 ? 1 : 0;
      const cycleDate = new Date();
      cycleDate.setDate(cycleDate.getDate() - daysAgo);
      
      const year = cycleDate.getFullYear();
      const month = String(cycleDate.getMonth() + 1).padStart(2, '0');
      const day = String(cycleDate.getDate()).padStart(2, '0');
      const completedCycleId = `${year}-${month}-${day}-18:00`;

      // Call cloud function to track click and apply pity point
      const clickWinnerLink = httpsCallable(functions, 'clickWinnerLink');
      const result = await clickWinnerLink({
        cycleId: completedCycleId,
        winnerUrl: cycleWinner.promotionalURL
      });

      console.log('clickWinnerLink result:', result.data);

      if (result.data.pityPointApplied) {
        alert(`Pity point applied! +${result.data.pointsAwarded} point added to your chosen creator!`);
        setHasPityPoint(false);
      }

      // Open the winner's URL
      window.open(cycleWinner.promotionalURL, '_blank');
    } catch (error) {
      console.error('Error clicking winner link:', error);
      alert('Error processing click. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#3B5998] to-[#2A4475] flex flex-col font-inter">
      {/* Header/Navbar */}
      <header className="bg-[#2A4475]/80 backdrop-blur-sm shadow-lg p-2 md:p-4 sticky top-0 z-10 border-b border-white/10">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl md:text-4xl font-black text-white flex items-baseline">
            <span className="text-sm md:text-xl font-normal mr-0.5 md:mr-1">The</span>
            <span className="bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent" style={{letterSpacing: '-0.02em'}}>SubGames</span>
          </h1>
          <div className="flex items-center space-x-2 md:space-x-4">
            <div className="relative flex items-center gap-2">
              {/* Points Animation - on the left */}
              {showPointsAnimation && (
                <div 
                  className="text-2xl md:text-3xl font-bold text-green-400 pointer-events-none"
                  style={{
                    animation: 'floatUp 3s ease-out forwards'
                  }}
                >
                  +{showPointsAnimation}
                </div>
              )}
              <span className="text-lg md:text-xl font-bold text-gray-100 bg-gradient-to-br from-yellow-500 to-yellow-600 px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-lg flex items-center gap-1 md:gap-2">
                <span className="text-xl md:text-2xl">🪙</span>
                <span>{optimisticPoints}</span>
              </span>
            </div>
            {selectedCreator && (
              <span className="text-xs md:text-sm text-white bg-white/20 backdrop-blur-sm px-2 py-1 md:p-2 rounded-lg truncate max-w-[100px] md:max-w-none">
                <span className="hidden md:inline">Supporting: </span>{selectedCreatorProfile?.displayName || 'Creator'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-2 md:p-4">
        {/* Winner Announcement */}
        {cycleWinner && cycleWinner.promotionalURL && (
          <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-white p-3 md:p-4 rounded-xl shadow-xl mb-4 md:mb-6">
            <div className="text-center mb-3">
              <p className="font-extrabold text-base md:text-lg mb-1">
                🏆 Yesterday's Winner: {cycleWinner.winnerName}
              </p>
              <p className="text-xs md:text-sm opacity-90">
                {cycleWinner.finalScore} points • {cycleWinner.supporterCount} supporters
              </p>
            </div>
            
            {hasPityPoint && selectedCreator ? (
              <div className="text-center">
                <p className="text-sm md:text-base font-semibold mb-2">
                  🎁 Visit this creator to earn a bonus point for your favorite creator!
                </p>
                <button
                  onClick={handleClickWinnerLink}
                  className="bg-white text-yellow-600 px-4 py-2 md:px-6 md:py-3 rounded-lg font-bold hover:bg-gray-100 transition-colors text-sm md:text-base"
                >
                  Visit Winner's Channel & Claim Bonus Point
                </button>
              </div>
            ) : selectedCreator === cycleWinner.winnerId ? (
              <div className="text-center">
                <p className="text-sm md:text-base font-semibold mb-2">
                  🎉 You picked the winner! Check out their content!
                </p>
                <button
                  onClick={() => window.open(cycleWinner.promotionalURL, '_blank')}
                  className="bg-white text-yellow-600 px-4 py-2 md:px-6 md:py-3 rounded-lg font-bold hover:bg-gray-100 transition-colors text-sm md:text-base"
                >
                  Visit Winner's Channel
                </button>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-xs md:text-sm opacity-90">
                  {hasPityPoint ? 'Pick a creator first to claim your bonus point!' : 'Support the winner!'}
                </p>
                <button
                  onClick={() => window.open(cycleWinner.promotionalURL, '_blank')}
                  className="mt-2 bg-white text-yellow-600 px-4 py-2 md:px-6 md:py-3 rounded-lg font-bold hover:bg-gray-100 transition-colors text-sm md:text-base"
                >
                  Visit Winner's Channel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Dynamic Content */}
        <div className="bg-white/10 backdrop-blur-md p-3 md:p-6 rounded-xl shadow-2xl min-h-[500px] border border-white/20">
          {currentViewContent()}
        </div>
      </main>

      {/* Footer/Navigation */}
      <footer className="bg-[#2A4475]/80 backdrop-blur-sm p-3 md:p-4 sticky bottom-0 w-full border-t border-white/10">
        <div className="max-w-4xl mx-auto flex justify-around items-center">
          <NavItem view="minigame" currentView={view} setView={setView} icon="🎮" label="Games" />
          <NavItem view="leaderboard" currentView={view} setView={setView} icon="🏆" label="Leaderboard" />
          <NavItem view="creatorhub" currentView={view} setView={setView} icon="🧑‍💻" label="Creators" />
          <NavItem view="creatorprofile" currentView={view} setView={setView} icon="⭐" label="My Profile" />
        </div>
      </footer>

      {/* Creator Onboarding Modal */}
      {showCreatorOnboarding && (
        <CreatorOnboarding 
          onComplete={() => setShowCreatorOnboarding(false)}
        />
      )}
    </div>
  );
};

// --- NAVIGATION COMPONENT ---

const NavItem = ({ view, currentView, setView, icon, label }) => {
  const isActive = view === currentView;
  return (
    <button
      onClick={() => setView(view)}
      className={`flex flex-col items-center p-1 md:p-2 rounded-xl transition-all ${
        isActive
          ? 'text-white'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      <span className="text-xl md:text-2xl">{icon}</span>
      <span className="text-[10px] md:text-xs font-medium mt-0.5 md:mt-1">{label}</span>
    </button>
  );
};

// --- MAIN APP WITH AUTHENTICATION ROUTING ---

const App = () => {
  const [hasCompletedWelcome, setHasCompletedWelcome] = useState(false);

  return (
    <AuthProvider>
      <AppContent 
        hasCompletedWelcome={hasCompletedWelcome}
        setHasCompletedWelcome={setHasCompletedWelcome}
      />
    </AuthProvider>
  );
};

const AppContent = ({ hasCompletedWelcome, setHasCompletedWelcome }) => {
  const { currentUser, loading } = useAuth();

  // Reset welcome screen when user signs out
  useEffect(() => {
    if (!loading && !currentUser) {
      setHasCompletedWelcome(false);
    }
  }, [currentUser, loading, setHasCompletedWelcome]);

  // Show loading state while auth is initializing
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  // Show welcome page if user hasn't signed in yet
  if (!hasCompletedWelcome && !currentUser) {
    return <WelcomePage onContinue={() => setHasCompletedWelcome(true)} />;
  }

  // Show main app once authenticated
  return <MainApp />;
};

export default App;

