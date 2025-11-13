const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable, connectFunctionsEmulator } = require('firebase/functions');

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

async function retriggerPityPoints() {
  const cycleId = '2025-11-12-18:00';
  
  console.log(`\nManually awarding pity points for cycle: ${cycleId}\n`);
  
  try {
    const manualAwardPityPoints = httpsCallable(functions, 'manualAwardPityPoints');
    const result = await manualAwardPityPoints({ cycleId });
    
    console.log('✅ Success!');
    console.log(result.data);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

retriggerPityPoints();
