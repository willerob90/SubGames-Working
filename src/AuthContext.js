import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from './firebaseConfig';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  OAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('=== AUTH STATE CHANGED ===', user?.uid);
      setCurrentUser(user);
      
      if (user && !user.isAnonymous) {
        // Fetch user profile from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const profile = userDoc.data();
            setUserProfile(profile);
            console.log('User profile loaded:', profile);
          } else {
            console.log('No user profile found');
            setUserProfile(null);
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Sign in with Google
  const signInWithGoogle = async (asCreator = false) => {
    try {
      console.log('=== SIGNING IN WITH GOOGLE ===', { asCreator });
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Create or update user profile
      await createUserProfile(user, asCreator);
      
      return user;
    } catch (error) {
      console.error('Error signing in with Google:', error);
      
      // Provide user-friendly error messages
      let errorMessage = 'Failed to sign in with Google. ';
      
      switch (error.code) {
        case 'auth/operation-not-allowed':
          errorMessage += 'Google sign-in is not enabled. Please contact support.';
          break;
        case 'auth/popup-blocked':
          errorMessage += 'Popup was blocked by your browser. Please allow popups and try again.';
          break;
        case 'auth/popup-closed-by-user':
          errorMessage += 'Sign-in was cancelled.';
          break;
        case 'auth/unauthorized-domain':
          errorMessage += 'This domain is not authorized. Please contact support.';
          break;
        case 'auth/cancelled-popup-request':
          errorMessage += 'Only one popup allowed at a time.';
          break;
        default:
          errorMessage += error.message;
      }
      
      throw new Error(errorMessage);
    }
  };

  // Sign in with Apple
  const signInWithApple = async (asCreator = false) => {
    try {
      console.log('=== SIGNING IN WITH APPLE ===', { asCreator });
      const provider = new OAuthProvider('apple.com');
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Create or update user profile
      await createUserProfile(user, asCreator);
      
      return user;
    } catch (error) {
      console.error('Error signing in with Apple:', error);
      
      // Provide user-friendly error messages
      let errorMessage = 'Failed to sign in with Apple. ';
      
      switch (error.code) {
        case 'auth/operation-not-allowed':
          errorMessage += 'Apple sign-in is not enabled. Please contact support.';
          break;
        case 'auth/popup-blocked':
          errorMessage += 'Popup was blocked by your browser. Please allow popups and try again.';
          break;
        case 'auth/popup-closed-by-user':
          errorMessage += 'Sign-in was cancelled.';
          break;
        case 'auth/cancelled-popup-request':
          errorMessage += 'Only one popup allowed at a time.';
          break;
        default:
          errorMessage += error.message;
      }
      
      throw new Error(errorMessage);
    }
  };

  // Create or update user profile in Firestore
  const createUserProfile = async (user, isCreator = false) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      const existingData = userDoc.exists() ? userDoc.data() : null;

      const profileData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        accountType: existingData?.accountType || (isCreator ? 'creator' : 'player'),
        isCreator: isCreator, // Keep for backward compatibility
        createdAt: existingData?.createdAt || new Date(),
        lastLogin: new Date(),
        totalPointsEarned: existingData?.totalPointsEarned || 0,
        gamesPlayed: existingData?.gamesPlayed || 0,
        gamesWon: existingData?.gamesWon || 0,
      };

      // Additional fields for creators
      if (isCreator) {
        profileData.creatorProfile = {
          channelUrl: existingData?.creatorProfile?.channelUrl || '',
          promotionalUrl: existingData?.creatorProfile?.promotionalUrl || '',
          platform: existingData?.creatorProfile?.platform || '',
          contentType: existingData?.creatorProfile?.contentType || '',
          bio: existingData?.creatorProfile?.bio || '',
          referralClicks: existingData?.creatorProfile?.referralClicks || 0,
          profileComplete: existingData?.creatorProfile?.profileComplete || false,
        };
      }

      await setDoc(userRef, profileData, { merge: true });
      setUserProfile(profileData);
      
      console.log('User profile created/updated:', profileData);
      return profileData;
    } catch (error) {
      console.error('Error creating user profile:', error);
      throw error;
    }
  };

  // Sign out
  const signOut = async () => {
    try {
      console.log('=== SIGNING OUT ===');
      setCurrentUser(null);
      setUserProfile(null);
      await firebaseSignOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  // Update creator profile
  const updateCreatorProfile = async (updates) => {
    if (!currentUser || (userProfile?.accountType !== 'creator' && !userProfile?.isCreator)) {
      throw new Error('Only creators can update their profile');
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, {
        creatorProfile: {
          ...(userProfile?.creatorProfile || {}),
          ...updates,
        }
      }, { merge: true });

      const updatedProfile = {
        ...userProfile,
        creatorProfile: {
          ...(userProfile?.creatorProfile || {}),
          ...updates,
        }
      };
      setUserProfile(updatedProfile);
      
      console.log('Creator profile updated:', updates);
      return updatedProfile;
    } catch (error) {
      console.error('Error updating creator profile:', error);
      throw error;
    }
  };

  // Complete creator onboarding
  const completeCreatorOnboarding = async (channelUrl, promotionalUrl, platform, contentType) => {
    if (!currentUser) {
      throw new Error('Must be signed in to complete onboarding');
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      
      // Extract channel name from URL if possible
      let channelName = userProfile?.displayName || currentUser.displayName || 'Creator';
      if (channelUrl) {
        // Simple extraction - you can make this more sophisticated
        const urlMatch = channelUrl.match(/(?:youtube\.com\/(?:c\/|channel\/|@)?|twitch\.tv\/|kick\.com\/)([^\/\?]+)/i);
        if (urlMatch) {
          channelName = urlMatch[1];
        }
      }

      const updates = {
        displayName: channelName,
        creatorProfile: {
          ...(userProfile?.creatorProfile || {}),
          channelUrl,
          promotionalUrl,
          platform: platform || '',
          contentType: contentType || '',
          profileComplete: true,
        }
      };

      await setDoc(userRef, updates, { merge: true });

      // Auto-register creator to current cycle's leaderboard
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const currentCycleId = `${year}-${month}-${day}-18:00`;

      const leaderboardRef = doc(db, 'cycles', currentCycleId, 'leaderboard', currentUser.uid);
      const leaderboardSnap = await getDoc(leaderboardRef);
      
      if (!leaderboardSnap.exists()) {
        await setDoc(leaderboardRef, {
          creatorId: currentUser.uid,
          totalPoints: 0,
          supporterCount: 0,
          supporters: [],
          firstToReachCurrentScore: Date.now(),
          lastUpdated: Date.now()
        });
      }

      const updatedProfile = {
        ...(userProfile || {}),
        ...updates,
      };
      setUserProfile(updatedProfile);
      
      console.log('Creator onboarding completed and added to leaderboard:', updates);
      return updatedProfile;
    } catch (error) {
      console.error('Error completing creator onboarding:', error);
      throw error;
    }
  };

  const value = {
    currentUser,
    userProfile,
    loading,
    signInWithGoogle,
    signInWithApple,
    signOut,
    updateCreatorProfile,
    completeCreatorOnboarding,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
