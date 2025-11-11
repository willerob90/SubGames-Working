import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
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
  const { currentUser: authUser, userProfile: authUserProfile, isGuest, signOut: authSignOut } = useAuth();
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('minigame'); // 'minigame', 'leaderboard', 'creatorhub', 'creatorprofile'
  const [selectedGame, setSelectedGame] = useState('reaction'); // 'reaction', 'blockblast', 'colormatch', 'numbersmasher', 'memorycards', 'wordscramble'
  const [playerPoints, setPlayerPoints] = useState(0); // Points earned this cycle
  const [creators, setCreators] = useState([]); // Leaderboard data
  const [selectedCreator, setSelectedCreator] = useState(null); // User's daily pick
  const [currentCycleId] = useState(getCurrentCycleId());
  const [userProfile, setUserProfile] = useState(null); // Full user profile
  const [reactionTestState, setReactionTestState] = useState('initial'); // 'initial', 'wait', 'go', 'result'
  const [reactionTime, setReactionTime] = useState(null);
  const [gameSessionId, setGameSessionId] = useState(null); // Store session ID
  const [gameStartTime, setGameStartTime] = useState(null); // Store start time
  const [profile, setProfile] = useState({ name: '', contentUrl: '' });
  const [profileStatus, setProfileStatus] = useState('');
  const [loading, setLoading] = useState(true);

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
          
          // Load user profile
          const userData = userDoc.exists() ? userDoc.data() : null;
          setUserProfile(userData);
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
    // Skip for guest mode or if not authenticated
    if (!user || !isAuthReady || isGuest) {
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
  }, [user, isAuthReady, currentCycleId, isGuest]); // Track cycle changes and guest mode

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

  // --- MINIGAME LOGIC (Reaction Test) ---


  const startReactionTest = useCallback(async () => {
    // For guest mode, allow playing without a creator pick
    if (!isGuest && (!user || !selectedCreator)) {
      setProfileStatus('Please pick a creator first before playing!');
      return;
    }
    
    // Call Cloud Function to create game session
    try {
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const result = await startGameSession({
        gameType: 'reactionTest',
        difficulty: 'standard'
      });
      
      const sessionId = result.data.sessionId;
      
      // Store session ID in state
      setGameSessionId(sessionId);
      
      setReactionTestState('wait');
      setReactionTime(null);
      const delay = Math.random() * 3000 + 2000; // 2 to 5 seconds
      const timerId = setTimeout(() => {
        setReactionTestState('go');
        // Start tracking time from this moment
        setGameStartTime(Date.now());
      }, delay);
      return () => clearTimeout(timerId); // Cleanup function
    } catch (error) {
      console.error('Error starting game session:', error.message);
      setProfileStatus('Error starting game. Please try again.');
    }
  }, [user, selectedCreator, isGuest]);

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
        // For guest mode, skip point tracking
        if (isGuest) {
          return;
        }

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
          
          if (result.data.success && !result.data.guestMode) {
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
  }, [reactionTestState, user, view, startReactionTest, selectedCreator, gameSessionId, gameStartTime, creators, isGuest]); // Added dependencies


  // Handle Block Blast game win
  const handleBlockBlastWin = useCallback(async (finalScore) => {
    if (isGuest || !user || !selectedCreator) return;

    try {
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const sessionResult = await startGameSession({
        gameType: 'blockBlast',
        difficulty: 'standard'
      });

      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      await submitGameResult({
        sessionId: sessionResult.data.sessionId,
        timeTaken: 0
      });

      setProfileStatus(`Success! +1 point for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
    } catch (error) {
      console.error('Error submitting Block Blast result:', error.message);
      setProfileStatus(`Error: ${error.message}`);
    }
  }, [user, selectedCreator, creators, isGuest]);

  const handleColorMatchWin = useCallback(async () => {
    if (isGuest || !user || !selectedCreator) return;

    try {
      const startGameSession = httpsCallable(functions, 'startGameSession');
      const sessionResult = await startGameSession({
        gameType: 'colorMatch',
        difficulty: 'standard'
      });

      const submitGameResult = httpsCallable(functions, 'submitGameResult');
      await submitGameResult({
        sessionId: sessionResult.data.sessionId,
        timeTaken: 0
      });

      setProfileStatus(`Success! +8 points for ${creators.find(c => c.id === selectedCreator)?.name || 'creator'}!`);
    } catch (error) {
      console.error('Error submitting Color Match result:', error.message);
      setProfileStatus(`Error: ${error.message}`);
    }
  }, [user, selectedCreator, creators, isGuest]);

  const miniGameContent = useMemo(() => {
    // Define all games with their metadata
    const games = [
      { 
        id: 'reaction', 
        name: 'Reaction Test', 
        icon: '⚡', 
        description: 'Test your reflexes', 
        color: 'bg-gradient-to-br from-blue-500 to-blue-700',
        points: '1 point'
      },
      { 
        id: 'blockblast', 
        name: 'Block Blast', 
        icon: '🧩', 
        description: 'Clear rows and columns', 
        color: 'bg-gradient-to-br from-purple-500 to-purple-700',
        points: '5 points'
      },
      { 
        id: 'colormatch', 
        name: 'Color Match', 
        icon: '🎨', 
        description: 'Remember the sequence', 
        color: 'bg-gradient-to-br from-pink-500 to-pink-700',
        points: '8 points'
      },
      { 
        id: 'numbersmasher', 
        name: 'Number Smasher', 
        icon: '🔢', 
        description: 'Tap numbers in order', 
        color: 'bg-gradient-to-br from-green-500 to-green-700',
        comingSoon: true,
        points: '1 point'
      },
      { 
        id: 'memorycards', 
        name: 'Memory Cards', 
        icon: '🃏', 
        description: 'Match all the pairs', 
        color: 'bg-gradient-to-br from-yellow-500 to-orange-600',
        comingSoon: true,
        points: '3 points'
      },
      { 
        id: 'wordscramble', 
        name: 'Word Scramble', 
        icon: '📝', 
        description: 'Unscramble the word', 
        color: 'bg-gradient-to-br from-red-500 to-red-700',
        comingSoon: true,
        points: '2 points'
      }
    ];

    // If a specific game is selected, show back button + game
    if (selectedGame === 'blockblast') {
      return (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedGame(null)}
            className="px-6 py-3 rounded-lg font-semibold transition-all bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            ← Back to Games
          </button>
          <BlockBlast onGameWin={handleBlockBlastWin} isGuest={isGuest} />
        </div>
      );
    }

    if (selectedGame === 'colormatch') {
      return (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedGame(null)}
            className="px-6 py-3 rounded-lg font-semibold transition-all bg-gray-700 text-gray-300 hover:bg-gray-600"
          >
            ← Back to Games
          </button>
          <ColorMatch onWin={handleColorMatchWin} />
        </div>
      );
    }

    // If selectedGame is null or 'reaction', show the game grid selector
    if (!selectedGame || selectedGame === 'reaction') {
      return (
        <div className="space-y-6">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-white">Choose Your Game</h2>
          
          {/* Game Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {games.map((game) => (
              <button
                key={game.id}
                onClick={() => !game.comingSoon && setSelectedGame(game.id)}
                disabled={game.comingSoon}
                className={`
                  relative p-6 rounded-2xl shadow-lg transition-all duration-300
                  ${game.comingSoon 
                    ? 'opacity-60 cursor-not-allowed' 
                    : 'hover:scale-105 hover:shadow-2xl cursor-pointer'
                  }
                  ${game.color}
                  text-white
                `}
              >
                {game.comingSoon && (
                  <div className="absolute top-2 right-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded-full">
                    COMING SOON
                  </div>
                )}
                <div className="text-5xl mb-3">{game.icon}</div>
                <h3 className="text-xl font-bold mb-2">{game.name}</h3>
                <p className="text-sm opacity-90 mb-3">{game.description}</p>
                <div className="text-xs opacity-75 font-semibold">Earn: {game.points}</div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Reaction Test Game
    const timeValue = reactionTime && reactionTime !== 'Too Early!' ? parseInt(reactionTime) : Infinity;
    const isWin = timeValue < 500;

    let message;
    let boxClass = 'cursor-pointer w-full h-80 flex items-center justify-center rounded-2xl shadow-xl transition-all duration-300 text-3xl font-bold';

    switch (reactionTestState) {
      case 'initial':
        boxClass += ' bg-blue-500 hover:bg-blue-600 text-white';
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
            {isWin && <p className="text-green-400">Success! You earned 1 Sub Point!</p>}
            {!isWin && reactionTime !== 'Too Early!' && reactionTime !== null && <p className="text-orange-400">Too slow. Try again!</p>}
            <button
              onClick={startReactionTest}
              className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-md"
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
      <div className="space-y-6">
        <button
          onClick={() => setSelectedGame(null)}
          className="px-6 py-3 rounded-lg font-semibold transition-all bg-gray-700 text-gray-300 hover:bg-gray-600"
        >
          ← Back to Games
        </button>
        
        <div id="reaction-box" className={boxClass} onClick={handleReactionClick}>
          {message}
        </div>
      </div>
    );
  }, [selectedGame, reactionTestState, reactionTime, startReactionTest, handleReactionClick, handleBlockBlastWin, handleColorMatchWin, isGuest]); // Added dependencies

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
      <h2 className="text-2xl font-semibold text-gray-100">Become a Subgames Creator</h2>
      <p className="text-gray-400">Register your profile here to start earning points from players' wins!</p>

      <form onSubmit={handleUpdateProfile} className="space-y-4 bg-gray-900 p-6 rounded-xl shadow-lg border border-gray-700">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300">Creator Name</label>
          <input
            type="text"
            id="name"
            name="name"
            value={profile.name}
            onChange={handleProfileChange}
            placeholder="e.g., The Gaming Guru"
            required
            className="mt-1 block w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg shadow-sm p-3 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-500"
          />
        </div>
        <div>
          <label htmlFor="contentUrl" className="block text-sm font-medium text-gray-300">Content URL (e.g., Twitch, YouTube)</label>
          <input
            type="url"
            id="contentUrl"
            name="contentUrl"
            value={profile.contentUrl}
            onChange={handleProfileChange}
            placeholder="https://www.youtube.com/yourchannel"
            required
            className="mt-1 block w-full bg-gray-800 border border-gray-600 text-gray-100 rounded-lg shadow-sm p-3 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-500"
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
    </div>
  );

  // --- LEADERBOARD LOGIC ---

  const handlePickCreator = useCallback(async (creatorId) => {
    if (isGuest) {
      setProfileStatus("Guest users cannot pick creators. Please sign in to support creators!");
      return;
    }
    
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
  }, [user, creators, currentCycleId, isGuest]);

  const leaderboardContent = (
    <div className="p-4 space-y-6">
      <h2 className="text-3xl font-extrabold text-purple-400 border-b border-gray-700 pb-2">Creator Leaderboard</h2>

      {creators.length === 0 ? (
        <p className="text-gray-400">No creators registered yet. Be the first!</p>
      ) : (
        <div className="bg-gray-900 rounded-xl shadow-2xl p-6 border border-gray-700">
          <h3 className="text-xl font-semibold text-gray-100 mb-4">Top Creator of the Day (Based on Points)</h3>
          <div className="border border-yellow-600 bg-yellow-900/30 p-4 rounded-lg flex items-center shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-400 mr-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-8V7a1 1 0 112 0v3h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2z" clipRule="evenodd" />
            </svg>
            <p className="text-2xl font-bold text-yellow-300">
              {creators[0].name} ({creators[0].points || 0} Points)
            </p>
          </div>

          <ul className="mt-8 space-y-3">
            {creators.map((creator, index) => (
              <li
                key={creator.id}
                className="flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-750 rounded-lg shadow-sm transition-shadow border border-gray-700"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-medium text-gray-100 truncate">
                    {index + 1}. {creator.name}
                  </p>
                  <a href={creator.contentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:underline truncate block">
                    {creator.contentUrl}
                  </a>
                  <p className="text-xs text-gray-500 mt-1">
                    {creator.supporterCount || 0} supporter{creator.supporterCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center space-x-3 ml-4">
                  <span className="text-2xl font-extrabold text-green-400">{creator.points || 0}</span>
                  <button
                    onClick={() => handlePickCreator(creator.id)}
                    disabled={selectedCreator === creator.id}
                    className={`px-4 py-2 font-semibold rounded-full shadow-lg transition-colors text-sm ${
                      selectedCreator === creator.id 
                        ? 'bg-green-600 text-white cursor-default' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                    title={selectedCreator === creator.id ? 'Currently supporting!' : 'Pick this creator'}
                  >
                    {selectedCreator === creator.id ? '✓ Supporting' : 'Pick Creator'}
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

  const userId = user?.uid || authUser?.uid || 'Not Authenticated';
  const winner = creators[0];

  const handleSignOut = async () => {
    try {
      if (!isGuest) {
        // For authenticated users, sign out properly
        await authSignOut();
        await signOut(auth);
      } else {
        // For guests, just call the auth signOut to reset state
        await authSignOut();
      }
      // The useEffect in AppContent will automatically show the welcome page
    } catch (error) {
      console.error('Error during sign out:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col font-inter">
      {/* Header/Navbar */}
      <header className="bg-gray-800 shadow-lg p-4 sticky top-0 z-10 border-b border-gray-700">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-3xl font-black text-purple-400">The Subgames</h1>
          <div className="flex items-center space-x-4">
            {isGuest ? (
              <span className="text-sm text-gray-400 italic">Guest Mode - Points don't count</span>
            ) : (
              <>
                <span className="text-lg font-bold text-gray-100 bg-yellow-600 p-2 rounded-lg shadow-inner">
                  Today's Sub Points: {playerPoints}
                </span>
                {selectedCreator && (
                  <span className="text-sm text-gray-100 bg-green-600 p-2 rounded-lg">
                    Supporting: {creators.find(c => c.id === selectedCreator)?.name || 'Creator'}
                  </span>
                )}
              </>
            )}
            <button onClick={handleSignOut} className="text-sm text-red-400 hover:text-red-300 transition-colors">
              {isGuest ? 'Exit Guest Mode' : 'Sign Out'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4">
        {/* Winner Announcement */}
        {winner && (
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 rounded-xl shadow-xl mb-6 text-center">
            <p className="font-extrabold text-lg">
              Daily Winner: {winner.name} with {winner.points} points!
            </p>
            <p className="text-sm">Content is sent out to all players!</p>
          </div>
        )}

        {/* Dynamic Content */}
        <div className="bg-gray-800 p-6 rounded-xl shadow-2xl min-h-[500px] border border-gray-700">
          {currentViewContent()}
        </div>
      </main>

      {/* Footer/Navigation */}
      <footer className="bg-gray-950 p-3 sticky bottom-0 w-full border-t border-gray-800">
        <div className="max-w-4xl mx-auto flex justify-around items-center">
          <NavItem view="minigame" currentView={view} setView={setView} icon="🎮" label="Mini-Game" />
          <NavItem view="leaderboard" currentView={view} setView={setView} icon="🏆" label="Leaderboard" />
          <NavItem view="creatorhub" currentView={view} setView={setView} icon="🧑‍💻" label="Creator Hub" />
          {authUserProfile?.isCreator && (
            <NavItem view="creatorprofile" currentView={view} setView={setView} icon="⭐" label="My Profile" />
          )}
        </div>
        <div className="text-center text-xs text-gray-500 mt-2 truncate">
          {isGuest ? 'Guest Mode' : `User ID: ${userId}`}
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
      className={`flex flex-col items-center p-2 rounded-xl transition-all ${
        isActive
          ? 'text-pink-400 bg-gray-700 shadow-lg'
          : 'text-gray-400 hover:text-white hover:bg-gray-700'
      }`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-medium mt-1">{label}</span>
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
  const { currentUser, loading, isGuest } = useAuth();

  // Reset welcome screen when user signs out
  useEffect(() => {
    if (!loading && !currentUser && !isGuest) {
      setHasCompletedWelcome(false);
    }
  }, [currentUser, isGuest, loading, setHasCompletedWelcome]);

  // Show loading state while auth is initializing
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  // Show welcome page if user hasn't made a choice yet
  if (!hasCompletedWelcome && !currentUser && !isGuest) {
    return <WelcomePage onContinue={() => setHasCompletedWelcome(true)} />;
  }

  // Show main app once authenticated or in guest mode
  return <MainApp />;
};

export default App;
