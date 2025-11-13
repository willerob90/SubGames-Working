const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAXOmVDyJDLJgFfMjDvf0OfsCj5p-SqPqo",
  authDomain: "gemini-subgames-prototype.firebaseapp.com",
  projectId: "gemini-subgames-prototype",
  storageBucket: "gemini-subgames-prototype.firebasestorage.app",
  messagingSenderId: "185534952809",
  appId: "1:185534952809:web:3a8abf70eebcd21963c31c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkWinner() {
  try {
    const cycleId = '2025-11-12-18:00';
    console.log('Checking for winner in cycle:', cycleId);
    
    const winnerRef = doc(db, 'cycleWinners', cycleId);
    const winnerSnap = await getDoc(winnerRef);
    
    if (winnerSnap.exists()) {
      console.log('Winner found!', winnerSnap.data());
    } else {
      console.log('No winner found for this cycle');
    }
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkWinner();
