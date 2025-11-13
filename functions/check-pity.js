const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkPityPoints() {
  const cycleId = '2025-11-12-18:00';
  
  console.log(`\nChecking pity point eligibility for cycle: ${cycleId}\n`);
  
  const eligibilitySnap = await db.collection('cycles').doc(cycleId).collection('pityPointsEligible').get();
  
  if (eligibilitySnap.empty) {
    console.log('❌ NO eligibility documents found!');
  } else {
    console.log(`✅ Found ${eligibilitySnap.docs.length} eligibility document(s):\n`);
    eligibilitySnap.docs.forEach(doc => {
      console.log(`User ID: ${doc.id}`);
      console.log(`Data:`, doc.data());
      console.log('---');
    });
  }
}

checkPityPoints().then(() => process.exit());
