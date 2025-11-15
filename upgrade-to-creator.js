const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');
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
const db = getFirestore(app);
const auth = getAuth(app);

async function upgradeToCreator() {
  try {
    console.log('Upgrading your account to creator...\n');
    
    // Sign in
    const email = process.argv[2];
    const password = process.argv[3];
    
    if (!email || !password) {
      console.log('Usage: node upgrade-to-creator.js <email> <password>');
      process.exit(1);
    }
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;
    
    console.log(`✅ Signed in as: ${email}`);
    console.log(`User ID: ${userId}\n`);
    
    // Update user document
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      accountType: 'creator',
      isCreator: true
    });
    
    console.log('✅ Account upgraded to creator!');
    console.log('\nYou can now:');
    console.log('1. Complete creator onboarding in the app');
    console.log('2. Add your YouTube/Twitch channel');
    console.log('3. Appear on the leaderboard\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

upgradeToCreator();
