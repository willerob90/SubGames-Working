const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

const firebaseConfig = {
  apiKey: "AIzaSyAXOmVDyJDLJgFfMjDvf0OfsCj5p-SqPqo",
  authDomain: "gemini-subgames-prototype.firebaseapp.com",
  projectId: "gemini-subgames-prototype",
  storageBucket: "gemini-subgames-prototype.firebasestorage.app",
  messagingSenderId: "185534952809",
  appId: "1:185534952809:web:3a8abf70eebcd21963c31c"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function triggerWinner() {
  try {
    console.log('Calling manualCalculateWinner for 2025-11-12-18:00 cycle...');
    const manualCalculateWinner = httpsCallable(functions, 'manualCalculateWinner');
    const result = await manualCalculateWinner({ cycleId: '2025-11-12-18:00' });
    console.log('Success!', result.data);
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

triggerWinner();
