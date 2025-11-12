const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

// Helper function to get current cycle ID
const getCycleId = (daysAgo = 0) => {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}-18:00`;
};

// Function 1: Start Game Session (Anti-cheat)
exports.startGameSession = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in to start a game session.');
  }
  
  const userId = context.auth.uid;
  const { gameType, difficulty } = data;
  
  const sessionRef = db.collection('gameSessions').doc();
  await sessionRef.set({
    userId,
    gameType,
    difficulty: difficulty || 'easy',
    startTime: admin.firestore.FieldValue.serverTimestamp(),
    used: false,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    expectedPointValue: 1
  });
  
  return { sessionId: sessionRef.id };
});

// Function 2: Submit Game Result (Validate & Award Points)
exports.submitGameResult = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in to submit game results.');
  }
  
  const userId = context.auth.uid;
  const { sessionId, timeTaken } = data;
  
  // Validate session
  const sessionDoc = await db.collection('gameSessions').doc(sessionId).get();
  
  if (!sessionDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Session not found');
  }
  
  const session = sessionDoc.data();
  
  if (session.used) {
    throw new functions.https.HttpsError('already-exists', 'Session already used');
  }
  
  if (session.userId !== userId) {
    throw new functions.https.HttpsError('permission-denied', 'Not your session');
  }
  
  const now = admin.firestore.Timestamp.now();
  if (session.expiresAt < now) {
    throw new functions.https.HttpsError('deadline-exceeded', 'Session expired');
  }
  
  const cycleId = getCycleId();
  const pointsAwarded = 1;
  
  // Get user's pick for this cycle
  const pickDoc = await db.collection('cycles').doc(cycleId).collection('picks').doc(userId).get();
  
  if (!pickDoc.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Must pick a creator first');
  }
  
  const pick = pickDoc.data();
  const creatorId = pick.creatorId;
  
  // Run transaction to update points
  await db.runTransaction(async (transaction) => {
    const pickRef = db.collection('cycles').doc(cycleId).collection('picks').doc(userId);
    const leaderboardRef = db.collection('cycles').doc(cycleId).collection('leaderboard').doc(creatorId);
    const userRef = db.collection('users').doc(userId);
    
    // CRITICAL: All reads must happen BEFORE any writes in a Firestore transaction
    const leaderboardDoc = await transaction.get(leaderboardRef);
    
    // Now do all the writes
    // Update user's pick points
    transaction.update(pickRef, {
      pointsEarned: admin.firestore.FieldValue.increment(pointsAwarded)
    });
    
    // Update leaderboard
    if (!leaderboardDoc.exists) {
      transaction.set(leaderboardRef, {
        creatorId,
        totalPoints: pointsAwarded,
        supporterCount: 1,
        supporters: [userId],
        firstToReachCurrentScore: admin.firestore.FieldValue.serverTimestamp(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      const supporters = leaderboardDoc.data().supporters || [];
      const updates = {
        totalPoints: admin.firestore.FieldValue.increment(pointsAwarded),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
      
      if (!supporters.includes(userId)) {
        updates.supporters = admin.firestore.FieldValue.arrayUnion(userId);
        updates.supporterCount = admin.firestore.FieldValue.increment(1);
      }
      
      transaction.update(leaderboardRef, updates);
    }
    
    // Update user stats
    transaction.update(userRef, {
      totalGamesPlayed: admin.firestore.FieldValue.increment(1),
      totalPointsEarned: admin.firestore.FieldValue.increment(pointsAwarded)
    });
  });
  
  // Mark session as used
  await sessionDoc.ref.update({ used: true });
  
  // Record result
  await db.collection('gameResults').add({
    userId,
    sessionId,
    cycleId,
    gameType: session.gameType,
    pointsAwarded,
    timeTaken,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    validated: true,
    tippedToCreator: creatorId
  });
  
  return { success: true, pointsAwarded, creatorId };
});

// Function 3: Calculate Cycle Winner (run at 6pm CST daily)
exports.calculateCycleWinner = functions.pubsub.schedule('0 18 * * *')
  .timeZone('America/Chicago')
  .onRun(async (context) => {
    const yesterdayCycleId = getCycleId(1);
    
    // Get all leaderboard entries for yesterday
    const leaderboardSnapshot = await db.collection('cycles')
      .doc(yesterdayCycleId)
      .collection('leaderboard')
      .orderBy('totalPoints', 'desc')
      .orderBy('firstToReachCurrentScore', 'asc')
      .limit(1)
      .get();
    
    if (leaderboardSnapshot.empty) {
      console.log('No entries for cycle:', yesterdayCycleId);
      return null;
    }
    
    const winnerDoc = leaderboardSnapshot.docs[0];
    const winnerData = winnerDoc.data();
    const winnerId = winnerData.creatorId;
    
    // Get winner's user profile
    const winnerProfile = await db.collection('users').doc(winnerId).get();
    const profile = winnerProfile.data();
    
    // Record winner
    await db.collection('cycleWinners').doc(yesterdayCycleId).set({
      winnerId,
      winnerName: profile.displayName || 'Unknown',
      winnerPhotoURL: profile.photoURL || '',
      promotionalURL: profile.promotionalURL || '',
      finalScore: winnerData.totalPoints,
      supporterCount: winnerData.supporterCount,
      firstToReachScore: winnerData.firstToReachCurrentScore,
      announcedAt: admin.firestore.FieldValue.serverTimestamp(),
      cycleStartTime: admin.firestore.Timestamp.fromDate(new Date(yesterdayCycleId.replace('-18:00', 'T18:00:00-06:00'))),
      cycleEndTime: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('Winner calculated for cycle:', yesterdayCycleId, 'Winner:', winnerId);
    return null;
  });

// Function 4: Award Pity Points (run after winner calculation)
exports.awardPityPoints = functions.firestore
  .document('cycleWinners/{cycleId}')
  .onCreate(async (snap, context) => {
    const cycleId = context.params.cycleId;
    const winnerData = snap.data();
    const winnerId = winnerData.winnerId;
    
    // Get all picks for this cycle
    const picksSnapshot = await db.collection('cycles')
      .doc(cycleId)
      .collection('picks')
      .where('creatorId', '!=', winnerId)
      .get();
    
    const batch = db.batch();
    
    picksSnapshot.forEach((doc) => {
      const userId = doc.id;
      const pickData = doc.data();
      
      const pityPointRef = db.collection('cycles')
        .doc(cycleId)
        .collection('pityPoints')
        .doc(userId);
      
      batch.set(pityPointRef, {
        userId,
        earnedPityPoint: true,
        clickedWinnerLink: false,
        winnerId,
        theirCreatorId: pickData.creatorId,
        appliedToNextCycle: false
      });
    });
    
    await batch.commit();
    console.log('Pity points awarded for cycle:', cycleId);
  });

// Function 5: Apply Pity Points to Next Cycle
exports.applyPityPoints = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  
  const { previousCycleId, winnerId } = data;
  const userId = context.auth.uid;
  
  // Verify pity point exists
  const pityPointDoc = await db.collection('cycles')
    .doc(previousCycleId)
    .collection('pityPoints')
    .doc(userId)
    .get();
  
  if (!pityPointDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'No pity point found');
  }
  
  const pityPoint = pityPointDoc.data();
  
  if (pityPoint.appliedToNextCycle) {
    throw new functions.https.HttpsError('already-exists', 'Pity point already applied');
  }
  
  const currentCycleId = getCycleId();
  
  // Get user's current pick
  const currentPickDoc = await db.collection('cycles')
    .doc(currentCycleId)
    .collection('picks')
    .doc(userId)
    .get();
  
  if (!currentPickDoc.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Must pick a creator in current cycle first');
  }
  
  const currentPick = currentPickDoc.data();
  const currentCreatorId = currentPick.creatorId;
  
  // Apply pity point
  await db.runTransaction(async (transaction) => {
    const leaderboardRef = db.collection('cycles')
      .doc(currentCycleId)
      .collection('leaderboard')
      .doc(currentCreatorId);
    
    const bonusRef = db.collection('cycles')
      .doc(currentCycleId)
      .collection('startingBonuses')
      .doc(currentCreatorId);
    
    const pityRef = pityPointDoc.ref;
    
    // Update leaderboard
    transaction.update(leaderboardRef, {
      totalPoints: admin.firestore.FieldValue.increment(1)
    });
    
    // Record bonus
    const bonusDoc = await transaction.get(bonusRef);
    if (!bonusDoc.exists) {
      transaction.set(bonusRef, {
        creatorId: currentCreatorId,
        pityPointsReceived: 1,
        fromSupporters: [userId]
      });
    } else {
      transaction.update(bonusRef, {
        pityPointsReceived: admin.firestore.FieldValue.increment(1),
        fromSupporters: admin.firestore.FieldValue.arrayUnion(userId)
      });
    }
    
    // Mark pity point as applied
    transaction.update(pityRef, {
      appliedToNextCycle: true,
      clickedWinnerLink: true,
      clickedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  return { success: true, pointsApplied: 1, toCreator: currentCreatorId };
});

// Function 7: Track Referral Click
exports.trackReferralClick = functions.https.onCall(async (data, context) => {
  const { creatorId } = data;
  
  if (!creatorId) {
    throw new functions.https.HttpsError('invalid-argument', 'Creator ID required');
  }
  
  try {
    // Increment referral click count in creator's profile
    await db.collection('users').doc(creatorId).update({
      'creatorProfile.referralClicks': admin.firestore.FieldValue.increment(1)
    });
    
    // Log the referral event
    await db.collection('referralClicks').add({
      creatorId,
      clickedBy: context.auth ? context.auth.uid : 'anonymous',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error tracking referral:', error);
    throw new functions.https.HttpsError('internal', 'Failed to track referral');
  }
});
// Function 6: Clean Up Old Sessions (run hourly)
exports.cleanupExpiredSessions = functions.pubsub.schedule('0 * * * *')
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    
    const expiredSessions = await db.collection('gameSessions')
      .where('expiresAt', '<', now)
      .where('used', '==', false)
      .get();
    
    const batch = db.batch();
    expiredSessions.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log('Cleaned up', expiredSessions.size, 'expired sessions');
    return null;
  });
