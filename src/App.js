import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, onSnapshot, collection, updateDoc, increment, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, firebaseConfig } from './firebaseConfig';
import { AuthProvider, useAuth } from './AuthContext';
import WelcomePage from './WelcomePage';
import CreatorProfile from './CreatorProfile';
import BlockBlast from './games/BlockBlast';
import ColorMatch from './games/ColorMatch';

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
  const [creators, setCreators] = useState([]); // Leaderboard data
  const [selectedCreator, setSelectedCreator] = useState(null); // User's daily pick
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
        setPlayerPoints(data.pointsEarned || 0);
        setSelectedCreator(data.creatorId || null);
      } else {
        // No pick yet for this cycle
        setPlayerPoints(0);
        setSelectedCreator(null);
      }
    });

    return unsubscribe;
  }, [user, isAuthReady, currentCycleId]);

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
        
        if (userSnap.exists() && userSnap.data().accountType === 'creator') {
          const userData = userSnap.data();
          creatorList.push({
            id: docSnap.id,
            name: userData.displayName,
            contentUrl: userData.promotionalURL || '',
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
        // Calculate yesterday's cycle ID
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, '0');
        const day = String(yesterday.getDate()).padStart(2, '0');
        const yesterdayCycleId = `${year}-${month}-${day}-18:00`;

        // Load yesterday's winner
        const winnerRef = doc(db, 'cycleWinners', yesterdayCycleId);
        const winnerSnap = await getDoc(winnerRef);
        
        if (winnerSnap.exists()) {
          setCycleWinner(winnerSnap.data());
        }

        // Check if user is eligible for a pity point from yesterday
        if (user) {
          const eligibilityRef = doc(db, 'cycles', yesterdayCycleId, 'pityPointsEligible', user.uid);
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

  // --- MINIGAME LOGIC (Reaction Test) ---


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
      gameType: 'reactionTest',
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
        if (!user || !gameSessionId || !selectedCreator) {
          setProfileStatus('Please pick a creator first before playing!');
          return;
        }

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
          }
        } catch (error) {
          console.error('Error submitting game result:', error.message);
          setProfileStatus(`Error submitting result: ${error.message}`);
        }
      }
      return;
    }

    if (reactionTestState === 'initial' || reactionTestState === 'result') {
      startReactionTest();
    }
  }, [reactionTestState, user, view, startReactionTest, selectedCreator, gameSessionId, gameStartTime, creators]);


  // Handle Block Blast game win
  const handleBlockBlastWin = useCallback(async (finalScore) => {
    if (!user || !selectedCreator) {
      console.log('Cannot award points - missing requirements:', { 
        hasUser: !!user, 
        hasCreator: !!selectedCreator
      });
      return;
    }

    try {
      console.log('🎮 Block Blast Win! Creating session and submitting result...');
      
      // Create a game session
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const sessionResult = await startGameSession({
        gameType: 'blockBlast',
        difficulty: 'standard'
      });

      console.log('Session created:', sessionResult.data.sessionId);

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId: sessionResult.data.sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +5 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
      }
    } catch (error) {
      console.error('Error submitting Block Blast result:', error);
      setProfileStatus(`Error: ${error.message}`);
    }
  }, [user, selectedCreator, creators]);

  // Handle Color Match game win
  const handleColorMatchWin = useCallback(async (level) => {
    if (!user || !selectedCreator) {
      console.log('Cannot award points - missing requirements:', { 
        hasUser: !!user, 
        hasCreator: !!selectedCreator
      });
      return;
    }

    try {
      console.log('🎨 Color Match Win! Creating session and submitting result...');
      
      // Create a game session
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const sessionResult = await startGameSession({
        gameType: 'colorMatch',
        difficulty: 'standard'
      });

      console.log('Session created:', sessionResult.data.sessionId);

      // Submit the game result
      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      const result = await submitGameResult({
        sessionId: sessionResult.data.sessionId,
        timeTaken: 0
      });

      console.log('Result submitted:', result.data);

      if (result.data.success) {
        setProfileStatus(`Success! +8 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
      } else {
        setProfileStatus('Error: Failed to submit game result');
      }
    } catch (error) {
      console.error('Error submitting Color Match result:', error);
      setProfileStatus(`Error: ${error.message}`);
    }
  }, [user, selectedCreator, creators]);

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
          <BlockBlast onGameWin={handleBlockBlastWin} />
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
          <ColorMatch onGameWin={handleColorMatchWin} />
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
        id: 'blockblast',
        name: 'Block Blast',
        icon: '🧩',
        description: 'Clear lines by placing blocks strategically. Reach 100 points to win!',
        color: 'from-yellow-500 to-yellow-600',
        points: '5 points',
      },
      {
        id: 'colormatch',
        name: 'Color Match',
        icon: '🎨',
        description: 'Simon says! Repeat the color sequence. Reach level 8 to win!',
        color: 'from-blue-500 to-blue-600',
        points: '8 points',
      },
    ];

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">Game Library</h2>
          <p className="text-gray-400">Choose a game to play and earn points</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {games.map((game) => (
            <button
              key={game.id}
              onClick={() => setSelectedGame(game.id)}
              className="group relative bg-white/10 backdrop-blur-sm rounded-2xl overflow-hidden hover:scale-105 transition-all duration-300 shadow-xl hover:shadow-2xl border-2 border-white/20 hover:border-white/40"
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
          ))}
        </div>

        {!selectedCreator && (
          <div className="bg-yellow-500/20 backdrop-blur-sm border border-yellow-400/30 rounded-lg p-4 text-center">
            <p className="text-yellow-100 text-sm md:text-base">
              💡 Pick a creator from the Leaderboard to start earning points!
            </p>
          </div>
        )}
      </div>
    );
  }, [selectedGame, reactionTestState, reactionTime, startReactionTest, handleReactionClick, handleBlockBlastWin, handleColorMatchWin, selectedCreator]);

  // --- CREATOR HUB LOGIC ---

  const handleProfileChange = (e) => {
    setProfileStatus('');
    setProfile({ ...profile, [e.target.name]: e.target.value });
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!user || !profile.name || !profile.contentUrl) {
      setProfileStatus('Please fill out both fields.');
      return;
    }

    const userRef = getUserDocRef(db, user.uid);

    try {
      // Update user document to become a creator
      await updateDoc(userRef, {
        displayName: profile.name,
        promotionalURL: profile.contentUrl,
        accountType: 'creator',
        subscriptionStatus: 'active', // Default for now
        totalWins: 0,
        totalPointsReceived: 0
      });
      
      // Also create an entry in the current cycle's leaderboard
      const leaderboardRef = getCycleLeaderboardRef(db, currentCycleId, user.uid);
      const leaderboardSnap = await getDoc(leaderboardRef);
      
      if (!leaderboardSnap.exists()) {
        await setDoc(leaderboardRef, {
          creatorId: user.uid,
          totalPoints: 0,
          supporterCount: 0,
          supporters: [],
          firstToReachCurrentScore: Date.now(),
          lastUpdated: Date.now()
        });
      }
      
      setProfileStatus('Profile Updated Successfully! You are now a registered creator.');
    } catch (error) {
      console.error('Error updating creator profile:', error);
      setProfileStatus(`Error updating profile: ${error.message}`);
    }
  };

  const creatorHubContent = (
    <div className="p-4 space-y-6">
      <h2 className="text-2xl font-semibold text-white">Become a Subgames Creator</h2>
      <p className="text-gray-200">Register your profile here to start earning points from players' wins!</p>

      <form onSubmit={handleUpdateProfile} className="space-y-4 bg-white/10 backdrop-blur-sm p-6 rounded-xl shadow-lg border border-white/20">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-white">Creator Name</label>
          <input
            type="text"
            id="name"
            name="name"
            value={profile.name}
            onChange={handleProfileChange}
            placeholder="e.g., The Gaming Guru"
            required
            className="mt-1 block w-full bg-white/10 border border-white/20 text-white rounded-lg shadow-sm p-3 focus:ring-white/50 focus:border-white/50 placeholder-gray-300"
          />
        </div>
        <div>
          <label htmlFor="contentUrl" className="block text-sm font-medium text-white">Content URL (e.g., Twitch, YouTube)</label>
          <input
            type="url"
            id="contentUrl"
            name="contentUrl"
            value={profile.contentUrl}
            onChange={handleProfileChange}
            placeholder="https://www.youtube.com/yourchannel"
            required
            className="mt-1 block w-full bg-white/10 border border-white/20 text-white rounded-lg shadow-sm p-3 focus:ring-white/50 focus:border-white/50 placeholder-gray-300"
          />
        </div>
        <button
          type="submit"
          className="w-full py-3 px-4 border border-transparent rounded-lg shadow-md text-white bg-purple-600 hover:bg-purple-700 transition-colors font-medium text-lg"
        >
          Update Profile
        </button>
      </form>
      {profileStatus && (
        <p className={`mt-4 text-center font-medium ${profileStatus.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
          {profileStatus}
        </p>
      )}

      {/* Admin Test Button - Calculate Winner Manually */}
      {user && (
        <div className="mt-8 bg-yellow-500/20 backdrop-blur-sm p-6 rounded-xl border-2 border-yellow-500/50">
          <h3 className="text-lg font-semibold text-yellow-300 mb-2">⚠️ Admin Test Function</h3>
          <p className="text-white/80 text-sm mb-4">
            Test the winner calculation function manually. Enter a cycle ID (e.g., 2025-11-10-18:00) or leave blank for yesterday's cycle.
          </p>
          <input
            type="text"
            id="testCycleId"
            placeholder="2025-11-10-18:00 (optional)"
            className="w-full mb-3 bg-white/10 border border-white/20 text-white rounded-lg shadow-sm p-3 focus:ring-yellow-500/50 focus:border-yellow-500/50 placeholder-gray-400"
          />
          <button
            onClick={async () => {
              try {
                const cycleIdInput = document.getElementById('testCycleId').value;
                const manualCalculateWinner = httpsCallable(functions, 'manualCalculateCycleWinner');
                const result = await manualCalculateWinner({ cycleId: cycleIdInput || undefined });
                alert(`Success! Winner: ${result.data.winnerName} with ${result.data.finalScore} points for cycle ${result.data.cycleId}`);
              } catch (error) {
                alert(`Error: ${error.message}`);
              }
            }}
            className="w-full py-3 px-4 bg-yellow-500 hover:bg-yellow-600 text-black font-bold rounded-lg transition-colors"
          >
            🧪 Test Calculate Winner Now
          </button>
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
      <h2 className="text-xl md:text-3xl font-extrabold text-white border-b border-white/20 pb-2">Creator Leaderboard</h2>

      {creators.length === 0 ? (
        <p className="text-white/60 text-sm md:text-base">No creators registered yet. Be the first!</p>
      ) : (
        <div className="bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-3 md:p-6 border border-white/20">
          <h3 className="text-base md:text-xl font-semibold text-white mb-3 md:mb-4">Top Creator of the Day (Based on Points)</h3>
          <div className="border-2 border-yellow-400/50 bg-yellow-500/10 backdrop-blur-sm p-3 md:p-4 rounded-lg flex items-center shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-8 md:w-8 text-yellow-400 mr-2 md:mr-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-8V7a1 1 0 112 0v3h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2z" clipRule="evenodd" />
            </svg>
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
                
                {/* Points and Button */}
                <div className="flex flex-col md:flex-row items-end md:items-center gap-2 md:gap-3 ml-2 md:ml-4">
                  <span className="text-lg md:text-2xl font-extrabold text-yellow-400">{creator.points || 0}</span>
                  <button
                    onClick={() => handlePickCreator(creator.id)}
                    disabled={selectedCreator === creator.id}
                    className={`px-3 md:px-4 py-1.5 md:py-2 font-semibold rounded-full shadow-lg transition-colors text-xs md:text-sm whitespace-nowrap ${
                      selectedCreator === creator.id 
                        ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white cursor-default' 
                        : 'bg-gradient-to-r from-purple-600 to-purple-700 text-white hover:from-purple-500 hover:to-purple-600'
                    }`}
                    title={selectedCreator === creator.id ? 'Currently supporting!' : 'Pick this creator'}
                  >
                    {selectedCreator === creator.id ? '✓ Supporting' : 'Pick'}
                  </button>
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
      // Calculate yesterday's cycle ID
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const year = yesterday.getFullYear();
      const month = String(yesterday.getMonth() + 1).padStart(2, '0');
      const day = String(yesterday.getDate()).padStart(2, '0');
      const yesterdayCycleId = `${year}-${month}-${day}-18:00`;

      // Call cloud function to track click and apply pity point
      const clickWinnerLink = httpsCallable(functions, 'clickWinnerLink');
      const result = await clickWinnerLink({
        cycleId: yesterdayCycleId,
        winnerUrl: cycleWinner.promotionalURL
      });

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
            <span className="text-lg md:text-xl font-bold text-gray-100 bg-gradient-to-br from-yellow-500 to-yellow-600 px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-lg flex items-center gap-1 md:gap-2">
              <span className="text-xl md:text-2xl">🪙</span>
              <span>{playerPoints}</span>
            </span>
            {selectedCreator && (
              <span className="text-xs md:text-sm text-white bg-white/20 backdrop-blur-sm px-2 py-1 md:p-2 rounded-lg truncate max-w-[100px] md:max-w-none">
                <span className="hidden md:inline">Supporting: </span>{creators.find(c => c.id === selectedCreator)?.name || 'Creator'}
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
          <NavItem view="creatorhub" currentView={view} setView={setView} icon="🧑‍💻" label="Creator Hub" />
          <NavItem view="creatorprofile" currentView={view} setView={setView} icon="⭐" label="My Profile" />
        </div>
      </footer>
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
