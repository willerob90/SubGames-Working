import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, functions } from './firebaseConfig';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  OAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

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
            
            // If creator with channel URL but no custom photo, fetch channel data
            const isCreator = profile.accountType === 'creator' || profile.isCreator;
            if (isCreator && profile.creatorProfile?.channelUrl) {
              const channelUrl = profile.creatorProfile.channelUrl;
              
              // Check if we need to update (if using Google profile photo, always update)
              const needsUpdate = !profile.photoURL || 
                                  profile.photoURL.includes('googleusercontent.com');
              
              if (needsUpdate) {
                if (channelUrl.includes('youtube.com')) {
                  console.log('Fetching YouTube data for existing creator...');
                  await updateProfileFromYouTube(user.uid, channelUrl);
                } else if (channelUrl.includes('twitch.tv')) {
                  console.log('Fetching Twitch data for existing creator...');
                  await updateProfileFromTwitch(user.uid, channelUrl);
                }
              }
            }
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

      // If user is signing in as creator, upgrade them to creator
      // Otherwise, keep existing account type or set as player for new users
      const accountType = isCreator ? 'creator' : (existingData?.accountType || 'player');

      const profileData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        accountType: accountType,
        isCreator: isCreator || existingData?.isCreator || false, // Upgrade if signing in as creator
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

  // Fetch YouTube channel data and update profile
  const updateProfileFromYouTube = async (userId, channelUrl) => {
    try {
      // Call Cloud Function to get YouTube data (keeps API key secure)
      const getYouTubeData = httpsCallable(functions, 'getYouTubeChannelData');
      const result = await getYouTubeData({ channelUrl });

      if (result.data.success) {
        const { displayName, photoURL } = result.data;

        // Update Firestore profile
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
          displayName: displayName,
          photoURL: photoURL,
        }, { merge: true });

        // Update local state
        setUserProfile(prev => ({
          ...prev,
          displayName: displayName,
          photoURL: photoURL,
        }));

        console.log('Updated profile from YouTube:', { displayName, photoURL });
      }
    } catch (error) {
      console.error('Error updating profile from YouTube:', error);
    }
  };

  // Fetch Twitch channel data and update profile
  const updateProfileFromTwitch = async (userId, channelUrl) => {
    try {
      // Call Cloud Function to get Twitch data (keeps client secret secure)
      const getTwitchData = httpsCallable(functions, 'getTwitchChannelData');
      const result = await getTwitchData({ channelUrl });

      if (result.data.success) {
        const { displayName, photoURL } = result.data;

        // Update Firestore profile
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
          displayName: displayName,
          photoURL: photoURL,
        }, { merge: true });

        // Update local state
        setUserProfile(prev => ({
          ...prev,
          displayName: displayName,
          photoURL: photoURL,
        }));

        console.log('Updated profile from Twitch:', { displayName, photoURL });
      }
    } catch (error) {
      console.error('Error updating profile from Twitch:', error);
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
  const completeCreatorOnboarding = async (channelUrl, promotionalUrl, platform, contentType, youtubeData = null) => {
    if (!currentUser) {
      throw new Error('Must be signed in to complete onboarding');
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      
      // Use YouTube data if available, otherwise extract from URL
      let channelName = userProfile?.displayName || currentUser.displayName || 'Creator';
      let profilePhotoURL = userProfile?.photoURL || currentUser.photoURL || '';

      if (youtubeData && youtubeData.name) {
        channelName = youtubeData.name;
        profilePhotoURL = youtubeData.photoURL || profilePhotoURL;
      } else if (channelUrl) {
        // Simple extraction - you can make this more sophisticated
        const urlMatch = channelUrl.match(/(?:youtube\.com\/(?:c\/|channel\/|@)?|twitch\.tv\/|kick\.com\/)([^\/\?]+)/i);
        if (urlMatch) {
          channelName = urlMatch[1];
        }
      }

      const updates = {
        displayName: channelName,
        photoURL: profilePhotoURL,
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

  // Upgrade existing player account to creator
  const upgradeToCreator = async () => {
    if (!currentUser) {
      throw new Error('Must be signed in to upgrade to creator');
    }

    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, {
        accountType: 'creator',
        isCreator: true,
      }, { merge: true });

      const updatedProfile = {
        ...userProfile,
        accountType: 'creator',
        isCreator: true,
      };
      setUserProfile(updatedProfile);
      
      console.log('Account upgraded to creator');
      return updatedProfile;
    } catch (error) {
      console.error('Error upgrading to creator:', error);
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
    upgradeToCreator,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
