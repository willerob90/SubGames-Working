import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';

// Initialize Firebase Messaging
let messaging = null;

export const initializeMessaging = (app) => {
  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error('Error initializing messaging:', error);
    return null;
  }
};

// Request notification permission and get FCM token
export const requestNotificationPermission = async (userId) => {
  try {
    // Check if browser supports notifications
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return null;
    }

    // Check if service worker is supported
    if (!('serviceWorker' in navigator)) {
      console.log('Service workers are not supported');
      return null;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    
    if (permission === 'granted') {
      console.log('Notification permission granted');
      
      if (!messaging) {
        console.error('Messaging not initialized');
        return null;
      }

      // Get FCM token
      const token = await getToken(messaging, {
        vapidKey: 'BKf5mpEld8sBatCLGoqdzHQ4TPqnfR-LQ9Li2MWnPnYf6gUIx84Cs0ORj4IwTnhF3ixP1NDXOuEQNQh_8ut_c9Y'
      });

      if (token) {
        console.log('FCM Token:', token);
        
        // Save token to Firestore for this user
        if (userId) {
          await saveTokenToFirestore(userId, token);
        }
        
        return token;
      } else {
        console.log('No registration token available');
        return null;
      }
    } else {
      console.log('Notification permission denied');
      return null;
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return null;
  }
};

// Save FCM token to Firestore
const saveTokenToFirestore = async (userId, token) => {
  try {
    const tokenRef = doc(db, 'users', userId);
    await setDoc(tokenRef, {
      fcmToken: token,
      tokenUpdatedAt: new Date()
    }, { merge: true });
    console.log('FCM token saved to Firestore');
  } catch (error) {
    console.error('Error saving token to Firestore:', error);
  }
};

// Listen for foreground messages
export const onMessageListener = () => {
  return new Promise((resolve) => {
    if (!messaging) {
      console.error('Messaging not initialized');
      return;
    }

    onMessage(messaging, (payload) => {
      console.log('Foreground message received:', payload);
      resolve(payload);
    });
  });
};

// Show a local notification (for foreground messages)
export const showLocalNotification = (title, body, options = {}) => {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/manifest.json', // Add your icon path
      badge: '/manifest.json',
      ...options
    });
  }
};
