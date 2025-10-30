import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, increment, getDoc, runTransaction } from 'firebase/firestore';

// --- CONFIGURATION SETUP ---
// NOTE: Global variables (__app_id, etc.) are used here for compatibility 
// with the Canvas environment. They are safely checked for existence.

// Fallback configuration for running the app outside the Canvas (e.g., local VS Code)
const MOCK_FIREBASE_CONFIG = {
 apiKey: "AIzaSyCyDjOTCDt1NiOJxLJoqJGHrek0cmvfzVA",
  authDomain: "gemini-subgames-prototype.firebaseapp.com",
  projectId: "gemini-subgames-prototype",
  storageBucket: "gemini-subgames-prototype.firebasestorage.app",
  messagingSenderId: "185534952809",
  appId: "1:185534952809:web:9e03c2d97ccc35fa53f9f8",
  measurementId: "G-PJPJ5E89M5"
};

// Logic to load secure config from environment or fall back to mock
const firebaseConfig = (() => {
  try {
    let configString = null;
    
    // eslint-disable-next-line no-undef
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      // eslint-disable-next-line no-undef
      configString = __firebase_config;
    } 
    else if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_FIREBASE_CONFIG) {
      configString = process.env.REACT_APP_FIREBASE_CONFIG;
    }

    if (configString) {
      return JSON.parse(configString);
    }
    return MOCK_FIREBASE_CONFIG;
  } catch (e) {
    console.error("Failed to parse Firebase config, using mock. Error:", e.message); 
    return MOCK_FIREBASE_CONFIG;
  }
})();

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

const appId = getAppId();
// eslint-disable-next-line no-undef
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- UTILITY FUNCTIONS ---

// Helper function to get the Firestore path for public creators
const getCreatorCollectionRef = (db) => {
  return collection(db, 'artifacts', appId, 'public', 'data', 'creators');
};

// --- MAIN REACT COMPONENT ---

const App = () => {
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState('minigame'); // 'minigame', 'leaderboard', 'creatorhub'
  const [playerPoints, setPlayerPoints] = useState(0); // Points available for tipping
  const [creators, setCreators] = useState([]);
  const [reactionTestState, setReactionTestState] = useState('initial'); // 'initial', 'wait', 'go', 'result'
  const [reactionTime, setReactionTime] = useState(null);
  const [profile, setProfile] = useState({ name: '', contentUrl: '' });
  const [profileStatus, setProfileStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // 1. AUTHENTICATION EFFECT
  useEffect(() => {
    let isMounted = true; // Flag to prevent state updates after unmount

    // Initial sign-in logic (called only once)
    const initializeAuth = async () => {
      try {
        let authResult;

        // Note: initialAuthToken is null in local dev, so it should hit signInAnonymously
        if (initialAuthToken) {
          authResult = await signInWithCustomToken(auth, initialAuthToken);
        } else {
          // This must succeed for the app to work locally
          authResult = await signInAnonymously(auth);
        }
        
        if (authResult.user) {
             console.log("Firebase Anonymous Sign-in Successful!");
        }

      } catch (error) {
        console.error("Firebase Sign-In Error:", error);
      }
    };

    // Auth state change listener (Handles initial state and subsequent sign-outs)
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (isMounted) {
        setUser(currentUser);
        setIsAuthReady(true);
        setLoading(false);
        if (!currentUser) {
            // If we sign out or fail to sign in, try again
            initializeAuth(); 
        }
      }
    });

    // Start the process only if we are not authenticated yet
    if (!isAuthReady) {
       initializeAuth();
    }


    return () => {
        isMounted = false; // Cleanup flag
        unsubscribe(); // Cleanup listener
    }
  }, []); // Empty dependency array ensures it runs only ONCE on mount

  // 2. PLAYER DATA LISTENER (Tipping Points)
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const playerDocRef = doc(db, 'artifacts', appId, 'users', user.uid, 'playerData', 'wallet');

    const unsubscribe = onSnapshot(playerDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPlayerPoints(data.points || 0);
      } else {
        // Create initial wallet if it doesn't exist
        setDoc(playerDocRef, { points: 0, lastPlayed: 0 }).catch(e => console.error("Error setting initial wallet:", e));
        setPlayerPoints(0);
      }
    });

    return unsubscribe;
  }, [user, isAuthReady, db, appId]); // Added db and appId as dependencies

  // 3. CREATOR/LEADERBOARD DATA LISTENER (Public Data)
  useEffect(() => {
    if (!db || !isAuthReady) return; // Wait until auth is ready

    const creatorsRef = getCreatorCollectionRef(db);
    // Note: Firestore security rules allow public read on this path.

    const unsubscribe = onSnapshot(creatorsRef, (snapshot) => {
      const creatorList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort in-memory to find the winner (Firestore orderBy can require indices)
      creatorList.sort((a, b) => (b.points || 0) - (a.points || 0));

      setCreators(creatorList);

      // Pre-fill profile if user is already a creator
      const currentUserProfile = creatorList.find(c => c.id === user?.uid);
      if (currentUserProfile) {
        setProfile({ name: currentUserProfile.name, contentUrl: currentUserProfile.contentUrl });
      }
    }, (error) => {
      console.error("Error fetching creators:", error);
    });

    return unsubscribe;
  }, [user, db, isAuthReady]);

  // --- MINIGAME LOGIC (Reaction Test) ---

  const startReactionTest = useCallback(() => {
    setReactionTestState('wait');
    setReactionTime(null);
    const delay = Math.random() * 3000 + 2000; // 2 to 5 seconds
    const timerId = setTimeout(() => {
      setReactionTestState('go');
      // Start tracking time from this moment
      document.getElementById('reaction-box').dataset.startTime = Date.now();
    }, delay);
    return () => clearTimeout(timerId); // Cleanup function
  }, []);

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
      const startTime = parseInt(document.getElementById('reaction-box').dataset.startTime, 10);
      const timeElapsed = Date.now() - startTime;
      setReactionTime(`${timeElapsed} ms`);

      if (timeElapsed < 500 && user) { // Player won the mini-game (strict win condition)
        setReactionTestState('result');
        await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'playerData', 'wallet'), {
          points: increment(1),
        });
      } else {
        setReactionTestState('result');
      }
      return;
    }

    if (reactionTestState === 'initial' || reactionTestState === 'result') {
      startReactionTest();
    }
  }, [reactionTestState, user, view, appId, db, startReactionTest]);


  const miniGameContent = useMemo(() => {
    // Helper function to check for a win state (reaction time is valid and < 500ms)
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
        boxClass += ' bg-gray-200 text-gray-800';
        message = (
          <div className="text-center p-4">
            <p className="text-5xl mb-4">{reactionTime}</p>
            {reactionTime === 'Too Early!' && <p className="text-red-600">You lost this round: Too Early!</p>}
            {isWin && <p className="text-green-600">Success! You earned 1 Tipping Point!</p>}
            {!isWin && reactionTime !== 'Too Early!' && reactionTime !== null && <p className="text-orange-600">Too slow. Try again!</p>}
            <button
              onClick={startReactionTest}
              className="mt-6 px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-md"
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
      <div id="reaction-box" className={boxClass} onClick={handleReactionClick}>
        {message}
      </div>
    );
  }, [reactionTestState, reactionTime, startReactionTest, handleReactionClick]); // Added handleReactionClick dependency to fix ESLint warning

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

    const creatorRef = doc(getCreatorCollectionRef(db), user.uid);

    try {
      // Check if profile exists to determine if we need to set initial points
      const docSnap = await getDoc(creatorRef);
      const dataToSet = {
        name: profile.name,
        contentUrl: profile.contentUrl,
        lastUpdated: Date.now(),
      };

      if (!docSnap.exists()) {
        // Only set initial points (0) if the document is being created
        dataToSet.points = 0;
      }

      await setDoc(creatorRef, dataToSet, { merge: true });
      setProfileStatus('Profile Updated Successfully! You are now a registered creator.');
    } catch (error) {
      console.error('Error updating creator profile:', error);
      setProfileStatus('Error updating profile. Check console for details.');
    }
  };

  const creatorHubContent = (
    <div className="p-4 space-y-6">
      <h2 className="text-2xl font-semibold text-gray-800">Become a Subgames Creator</h2>
      <p className="text-gray-600">Register your profile here to start earning points from players' wins!</p>

      <form onSubmit={handleUpdateProfile} className="space-y-4 bg-white p-6 rounded-xl shadow-lg">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Creator Name</label>
          <input
            type="text"
            id="name"
            name="name"
            value={profile.name}
            onChange={handleProfileChange}
            placeholder="e.g., The Gaming Guru"
            required
            className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label htmlFor="contentUrl" className="block text-sm font-medium text-gray-700">Content URL (e.g., Twitch, YouTube)</label>
          <input
            type="url"
            id="contentUrl"
            name="contentUrl"
            value={profile.contentUrl}
            onChange={handleProfileChange}
            placeholder="https://www.youtube.com/yourchannel"
            required
            className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500"
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
        <p className={`mt-4 text-center font-medium ${profileStatus.includes('Error') ? 'text-red-500' : 'text-green-600'}`}>
          {profileStatus}
        </p>
      )}
    </div>
  );

  // --- LEADERBOARD LOGIC ---

  const handleTipCreator = useCallback(async (creatorId) => {
    if (!user || playerPoints < 1) {
      console.error("You need at least 1 Tipping Point to tip a creator.");
      setProfileStatus("You need at least 1 Tipping Point to tip a creator.");
      return;
    }

    const playerWalletRef = doc(db, 'artifacts', appId, 'users', user.uid, 'playerData', 'wallet');
    const creatorRef = doc(getCreatorCollectionRef(db), creatorId);

    try {
      await runTransaction(db, async (transaction) => {
        // 1. Read Player's Wallet
        const playerSnap = await transaction.get(playerWalletRef);
        const currentPoints = playerSnap.data()?.points || 0;

        if (currentPoints < 1) {
          throw new Error("Insufficient points to tip.");
        }

        // 2. Read Creator's Profile
        const creatorSnap = await transaction.get(creatorRef);
        if (!creatorSnap.exists()) {
           throw new Error("Creator profile not found.");
        }

        // 3. Update Player's Wallet (Subtract 1 point)
        transaction.update(playerWalletRef, { points: increment(-1) });

        // 4. Update Creator's Points (Add 1 point)
        transaction.update(creatorRef, { points: increment(1) });
      });

      setProfileStatus(`Successfully tipped 1 point to ${creators.find(c => c.id === creatorId)?.name || 'a creator'}!`);

    } catch (error) {
      console.error('Transaction failed:', error);
      setProfileStatus(`Transaction failed: ${error.message}`);
    }
  }, [user, playerPoints, creators, appId, db]);

  const leaderboardContent = (
    <div className="p-4 space-y-6">
      <h2 className="text-3xl font-extrabold text-purple-700 border-b pb-2">Creator Leaderboard</h2>

      {creators.length === 0 ? (
        <p className="text-gray-500">No creators registered yet. Be the first!</p>
      ) : (
        <div className="bg-white rounded-xl shadow-2xl p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Top Creator of the Day (Based on Points)</h3>
          <div className="border border-yellow-400 bg-yellow-50 p-4 rounded-lg flex items-center shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-500 mr-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-8V7a1 1 0 112 0v3h2a1 1 0 110 2h-2v2a1 1 0 11-2 0v-2H7a1 1 0 110-2h2z" clipRule="evenodd" />
            </svg>
            <p className="text-2xl font-bold text-yellow-700">
              {creators[0].name} ({creators[0].points || 0} Points)
            </p>
          </div>

          <ul className="mt-8 space-y-3">
            {creators.map((creator, index) => (
              <li
                key={creator.id}
                className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg shadow-sm transition-shadow"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-medium text-gray-900 truncate">
                    {index + 1}. {creator.name}
                  </p>
                  <a href={creator.contentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline truncate block">
                    {creator.contentUrl}
                  </a>
                </div>
                <div className="flex items-center space-x-3 ml-4">
                  <span className="text-2xl font-extrabold text-green-600">{creator.points || 0}</span>
                  <button
                    onClick={() => handleTipCreator(creator.id)}
                    disabled={playerPoints < 1}
                    className="px-4 py-2 bg-pink-500 text-white font-semibold rounded-full shadow-lg hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    title={playerPoints < 1 ? 'Earn points in the Mini-Game first!' : 'Tip 1 Point'}
                  >
                    Tip 1 Point
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
    return <div className="min-h-screen flex items-center justify-center bg-gray-100"><div className="text-xl font-medium">Loading The Subgames...</div></div>;
  }

  const currentViewContent = () => {
    switch (view) {
      case 'minigame':
        return miniGameContent;
      case 'leaderboard':
        return leaderboardContent;
      case 'creatorhub':
        return creatorHubContent;
      default:
        return <div>Select a view.</div>;
    }
  };

  const userId = user?.uid || 'Not Authenticated';
  const winner = creators[0];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-inter">
      {/* Header/Navbar */}
      <header className="bg-white shadow-md p-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-3xl font-black text-purple-700">The Subgames</h1>
          <div className="flex items-center space-x-4">
            <span className="text-lg font-bold text-gray-700 bg-yellow-100 p-2 rounded-lg shadow-inner">
              Tipping Points: {playerPoints}
            </span>
            <button onClick={() => signOut(auth)} className="text-sm text-red-500 hover:text-red-700 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4">
        {/* Winner Announcement */}
        {winner && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-4 rounded-xl shadow-xl mb-6 text-center">
            <p className="font-extrabold text-lg">
              Daily Winner: {winner.name} with {winner.points} points!
            </p>
            <p className="text-sm">Content is sent out to all players!</p>
          </div>
        )}

        {/* Dynamic Content */}
        <div className="bg-white p-6 rounded-xl shadow-2xl min-h-[500px]">
          {currentViewContent()}
        </div>
      </main>

      {/* Footer/Navigation */}
      <footer className="bg-gray-800 p-3 sticky bottom-0 w-full">
        <div className="max-w-4xl mx-auto flex justify-around items-center">
          <NavItem view="minigame" currentView={view} setView={setView} icon="🎮" label="Mini-Game" />
          <NavItem view="leaderboard" currentView={view} setView={setView} icon="🏆" label="Leaderboard" />
          <NavItem view="creatorhub" currentView={view} setView={setView} icon="🧑‍💻" label="Creator Hub" />
        </div>
        <div className="text-center text-xs text-gray-400 mt-2 truncate">
          User ID: {userId}
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

export default App;
