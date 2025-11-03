import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Firebase configuration
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

export { app, auth, db, functions, firebaseConfig };
