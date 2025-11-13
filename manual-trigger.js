const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBGBjn7dUJO9RhFLJcfJaUg2NfCl9mPzns",
  authDomain: "gemini-subgames-prototype.firebaseapp.com",
  projectId: "gemini-subgames-prototype",
  storageBucket: "gemini-subgames-prototype.firebasestorage.app",
  messagingSenderId: "185534952809",
  appId: "1:185534952809:web:f0c43d4bfe2d1f2fa42dc5"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
const auth = getAuth(app);

async function manuallyTriggerPity() {
  try {
    // Sign in first
    console.log('Signing in...');
    await signInWithEmailAndPassword(auth, 'ironwillerob@gmail.com', 'YOUR_PASSWORD');
    
    console.log('\nCalling manualCalculateWinner for cycle 2025-11-12-18:00...');
    const manualCalculateWinner = httpsCallable(functions, 'manualCalculateWinner');
    const result = await manualCalculateWinner({ cycleId: '2025-11-12-18:00' });
    
    console.log('\n✅ Result:', result.data);
    console.log('\nThis should have triggered the awardPityPoints function.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

manuallyTriggerPity();
