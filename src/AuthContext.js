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
  const [isGuest, setIsGuest] = useState(false);

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
            setIsGuest(false);
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

  // Guest mode - no authentication
  const continueAsGuest = () => {
    console.log('=== CONTINUING AS GUEST ===');
    setIsGuest(true);
    setCurrentUser(null);
    setUserProfile(null);
    setLoading(false);
  };

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

      const profileData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        isCreator: isCreator,
        createdAt: userDoc.exists() ? userDoc.data().createdAt : new Date(),
        lastLogin: new Date(),
        totalPointsEarned: userDoc.exists() ? userDoc.data().totalPointsEarned : 0,
        gamesPlayed: userDoc.exists() ? userDoc.data().gamesPlayed : 0,
        gamesWon: userDoc.exists() ? userDoc.data().gamesWon : 0,
      };

      // Additional fields for creators
      if (isCreator) {
        profileData.creatorProfile = {
          channelUrl: userDoc.exists() ? userDoc.data().creatorProfile?.channelUrl : '',
          bio: userDoc.exists() ? userDoc.data().creatorProfile?.bio : '',
          referralClicks: userDoc.exists() ? userDoc.data().creatorProfile?.referralClicks : 0,
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
      setIsGuest(false);
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
    if (!currentUser || !userProfile?.isCreator) {
      throw new Error('Only creators can update their profile');
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, {
        creatorProfile: {
          ...userProfile.creatorProfile,
          ...updates,
        }
      }, { merge: true });

      const updatedProfile = {
        ...userProfile,
        creatorProfile: {
          ...userProfile.creatorProfile,
          ...updates,
        }
      };
      setUserProfile(updatedProfile);
      
      console.log('Creator profile updated:', updates);
    } catch (error) {
      console.error('Error updating creator profile:', error);
      throw error;
    }
  };

  const value = {
    currentUser,
    userProfile,
    loading,
    isGuest,
    continueAsGuest,
    signInWithGoogle,
    signInWithApple,
    signOut,
    updateCreatorProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
