const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

// Rate limiting helper function
const checkRateLimit = async (userId, action, maxRequests, windowMinutes) => {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const rateLimitRef = db.collection('rateLimits').doc(`${userId}_${action}`);
  
  const rateLimitDoc = await rateLimitRef.get();
  
  if (rateLimitDoc.exists) {
    const data = rateLimitDoc.data();
    const windowStart = data.windowStart;
    const requestCount = data.requestCount;
    
    // Check if we're still in the same time window
    if (now - windowStart < windowMs) {
      if (requestCount >= maxRequests) {
        const timeLeft = Math.ceil((windowMs - (now - windowStart)) / 1000 / 60);
        throw new functions.https.HttpsError(
          'resource-exhausted',
          `Rate limit exceeded. Please try again in ${timeLeft} minute(s).`
        );
      }
      
      // Increment counter
      await rateLimitRef.update({
        requestCount: admin.firestore.FieldValue.increment(1),
        lastRequest: now
      });
    } else {
      // New window
      await rateLimitRef.set({
        windowStart: now,
        requestCount: 1,
        lastRequest: now
      });
    }
  } else {
    // First request
    await rateLimitRef.set({
      windowStart: now,
      requestCount: 1,
      lastRequest: now
    });
  }
  
  return true;
};

// Helper function to get current cycle ID
const getCycleId = (daysAgo = 0) => {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}-18:00`;
};

// Game validation constants
const GAME_VALIDATION = {
  'whackAMole': { minSeconds: 3, maxSeconds: 120, points: 3 },
  'blockBlast': { minSeconds: 2, maxSeconds: 180, points: 5 },
  'memoryFlip': { minSeconds: 5, maxSeconds: 150, points: 6 },
  'colorMatch': { minSeconds: 8, maxSeconds: 200, points: 8 },
  'patternPro': { minSeconds: 10, maxSeconds: 240, points: 10 },
  'reaction': { minSeconds: 0.05, maxSeconds: 60, points: 1 } // Fast reactions are expected!
};

// Function 1: Start Game Session (Anti-cheat)
exports.startGameSession = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in to start a game session.');
  }
  
  const userId = context.auth.uid;
  const { gameType, difficulty } = data;
  
  // Validate game type
  if (!GAME_VALIDATION[gameType]) {
    throw new functions.https.HttpsError('invalid-argument', `Invalid game type: ${gameType}`);
  }
  
  // Rate limit: 30 game sessions per hour per user
  await checkRateLimit(userId, 'startGameSession', 30, 60);
  
  const sessionRef = db.collection('gameSessions').doc();
  const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes
  
  await sessionRef.set({
    userId,
    gameType,
    difficulty: difficulty || 'easy',
    startTime: admin.firestore.FieldValue.serverTimestamp(),
    used: false,
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
    expectedPointValue: GAME_VALIDATION[gameType].points
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
  
  // Rate limit: 30 submissions per hour per user
  await checkRateLimit(userId, 'submitGameResult', 30, 60);
  
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
  
  // NEW: Validate game completion time
  const gameType = session.gameType;
  const validation = GAME_VALIDATION[gameType];
  
  if (!validation) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown game type: ${gameType}`);
  }
  
  // Calculate actual time taken (server-side, not client-provided)
  const startTime = session.startTime.toMillis();
  const actualTimeTaken = Date.now() - startTime;
  const actualSeconds = actualTimeTaken / 1000;
  
  // Validate time is within acceptable range
  if (actualSeconds < validation.minSeconds) {
    console.warn(`Suspicious fast completion: ${userId} completed ${gameType} in ${actualSeconds}s (min: ${validation.minSeconds}s)`);
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Game completed too quickly. Minimum time is ${validation.minSeconds} seconds.`
    );
  }
  
  if (actualSeconds > validation.maxSeconds) {
    throw new functions.https.HttpsError(
      'deadline-exceeded',
      `Game took too long. Maximum time is ${validation.maxSeconds} seconds.`
    );
  }
  
  const cycleId = getCycleId();
  
  // Use validated points from server config, not client data
  const pointsAwarded = validation.points;
  
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

// Helper function to calculate winner for a cycle
async function calculateWinnerForCycle(cycleId) {
  // Get all leaderboard entries for the cycle
  const leaderboardSnapshot = await db.collection('cycles')
    .doc(cycleId)
    .collection('leaderboard')
    .orderBy('totalPoints', 'desc')
    .orderBy('firstToReachCurrentScore', 'asc')
    .limit(1)
    .get();
  
  if (leaderboardSnapshot.empty) {
    console.log('No entries for cycle:', cycleId);
    return { success: false, message: 'No entries for this cycle' };
  }
  
  const winnerDoc = leaderboardSnapshot.docs[0];
  const winnerData = winnerDoc.data();
  const winnerId = winnerData.creatorId;
  
  // Get winner's user profile
  const winnerProfile = await db.collection('users').doc(winnerId).get();
  const profile = winnerProfile.data();
  
  // Record winner
  await db.collection('cycleWinners').doc(cycleId).set({
    winnerId,
    winnerName: profile.displayName || 'Unknown',
    winnerPhotoURL: profile.photoURL || '',
    promotionalURL: profile.promotionalURL || '',
    finalScore: winnerData.totalPoints,
    supporterCount: winnerData.supporterCount,
    firstToReachScore: winnerData.firstToReachCurrentScore,
    announcedAt: admin.firestore.FieldValue.serverTimestamp(),
    cycleStartTime: admin.firestore.Timestamp.fromDate(new Date(cycleId.replace('-18:00', 'T18:00:00-06:00'))),
    cycleEndTime: admin.firestore.FieldValue.serverTimestamp()
  });
  
  console.log('Winner calculated for cycle:', cycleId, 'Winner:', winnerId);
  return { success: true, cycleId, winnerId, winnerName: profile.displayName };
}

// Function 3: Calculate Cycle Winner (run at 6pm CST daily)
exports.calculateCycleWinner = functions.pubsub.schedule('0 18 * * *')
  .timeZone('America/Chicago')
  .onRun(async (context) => {
    // Get the cycle that is ending RIGHT NOW (current cycle ID at 6pm)
    const currentCycleId = getCycleId(0);
    await calculateWinnerForCycle(currentCycleId);
    return null;
  });

// Manual trigger function for admin use
exports.manualCalculateWinner = functions.https.onCall(async (data, context) => {
  // Optional: Add admin check here
  const cycleId = data.cycleId || getCycleId(0);
  return await calculateWinnerForCycle(cycleId);
});

// Manual trigger for pity points (admin use)
exports.manualAwardPityPoints = functions.https.onCall(async (data, context) => {
  const cycleId = data.cycleId || getCycleId(0);
  
  // Get winner data
  const winnerSnap = await db.collection('cycleWinners').doc(cycleId).get();
  if (!winnerSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Winner not found for this cycle');
  }
  
  const winnerData = winnerSnap.data();
  const winnerId = winnerData.winnerId;
  
  // Get all picks for this cycle where user didn't pick the winner
  const picksSnapshot = await db.collection('cycles')
    .doc(cycleId)
    .collection('picks')
    .where('creatorId', '!=', winnerId)
    .get();
  
  const batch = db.batch();
  let count = 0;
  
  picksSnapshot.forEach((doc) => {
    const userId = doc.id;
    const pickData = doc.data();
    
    const pityPointRef = db.collection('cycles')
      .doc(cycleId)
      .collection('pityPointsEligible')
      .doc(userId);
    
    batch.set(pityPointRef, {
      userId,
      eligibleForPityPoint: true,
      clickedWinnerLink: false,
      winnerId,
      theirCreatorId: pickData.creatorId
    });
    count++;
  });
  
  await batch.commit();
  
  return {
    success: true,
    cycleId,
    eligibleUsers: count,
    message: `Pity point eligibility set for ${count} users`
  };
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
        .collection('pityPointsEligible')
        .doc(userId);
      
      batch.set(pityPointRef, {
        userId,
        eligibleForPityPoint: true,
        clickedWinnerLink: false,
        winnerId,
        theirCreatorId: pickData.creatorId
      });
    });
    
    await batch.commit();
    console.log('Pity point eligibility tracked for cycle:', cycleId);
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

// Function 6.5: Click Winner Link (with pity point)
exports.clickWinnerLink = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in');
  }
  
  const { cycleId, winnerUrl } = data;
  const userId = context.auth.uid;
  
  // Check if user is eligible for pity point
  const eligibilityRef = db.collection('cycles')
    .doc(cycleId)
    .collection('pityPointsEligible')
    .doc(userId);
  
  const eligibilityDoc = await eligibilityRef.get();
  
  if (!eligibilityDoc.exists) {
    // User is not eligible (maybe they picked the winner)
    return { success: true, pityPointApplied: false, message: 'Not eligible for pity point' };
  }
  
  const eligibilityData = eligibilityDoc.data();
  
  if (!eligibilityData.eligibleForPityPoint) {
    return { success: true, pityPointApplied: false, message: 'Not eligible for pity point' };
  }
  
  if (eligibilityData.clickedWinnerLink) {
    return { success: true, pityPointApplied: false, message: 'Already claimed pity point' };
  }
  
  // Get user's current pick to apply the pity point
  const userPickRef = db.collection('cycles')
    .doc(cycleId)
    .collection('picks')
    .doc(userId);
  
  const userPickDoc = await userPickRef.get();
  
  if (!userPickDoc.exists) {
    return { success: true, pityPointApplied: false, message: 'No creator pick found' };
  }
  
  const creatorId = userPickDoc.data().creatorId;
  
  // Apply pity point to the leaderboard
  await db.runTransaction(async (transaction) => {
    const leaderboardRef = db.collection('cycles')
      .doc(cycleId)
      .collection('leaderboard')
      .doc(creatorId);
    
    // Update leaderboard
    transaction.update(leaderboardRef, {
      totalPoints: admin.firestore.FieldValue.increment(1)
    });
    
    // Update user's pick points
    transaction.update(userPickRef, {
      pointsEarned: admin.firestore.FieldValue.increment(1)
    });
    
    // Mark as clicked
    transaction.update(eligibilityRef, {
      clickedWinnerLink: true,
      clickedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  return { success: true, pityPointApplied: true, pointsAwarded: 1 };
});

// Function 7: Track Referral Click
exports.trackReferralClick = functions.https.onCall(async (data, context) => {
  const { creatorId } = data;
  
  if (!creatorId) {
    throw new functions.https.HttpsError('invalid-argument', 'Creator ID required');
  }
  
  // Rate limit referral clicks (even for anonymous users)
  // Use IP address or user ID for tracking
  const identifier = context.auth ? context.auth.uid : context.rawRequest.ip;
  await checkRateLimit(identifier, `referralClick_${creatorId}`, 10, 60);
  
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

// Function 8: Get Twitch Channel Data (Server-side OAuth)
exports.getTwitchChannelData = functions.https.onCall(async (data, context) => {
  const { channelUrl } = data;
  
  if (!channelUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Channel URL required');
  }
  
  // Rate limit: 5 Twitch lookups per 10 minutes (even anonymous users can't spam)
  const identifier = context.auth ? context.auth.uid : context.rawRequest.ip;
  await checkRateLimit(identifier, 'getTwitchChannelData', 5, 10);
  
  try {
    // Get Twitch credentials from environment variables
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('Twitch API credentials not configured');
      throw new functions.https.HttpsError('failed-precondition', 'Twitch API not configured');
    }

    // Extract username from Twitch URL
    const usernameMatch = channelUrl.match(/twitch\.tv\/([^\/\?]+)/i);
    if (!usernameMatch) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid Twitch URL format');
    }
    const username = usernameMatch[1];

    // Get OAuth token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    });

    if (!tokenResponse.ok) {
      throw new functions.https.HttpsError('internal', 'Failed to get Twitch OAuth token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get user data
    const userResponse = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      throw new functions.https.HttpsError('internal', 'Failed to fetch Twitch user data');
    }

    const userData = await userResponse.json();

    if (!userData.data || userData.data.length === 0) {
      throw new functions.https.HttpsError('not-found', 'Twitch channel not found');
    }

    const user = userData.data[0];
    
    return {
      success: true,
      displayName: user.display_name,
      photoURL: user.profile_image_url,
      description: user.description || ''
    };
  } catch (error) {
    console.error('Error fetching Twitch data:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to fetch Twitch channel data');
  }
});

// Function 9: Get YouTube Channel Data (Server-side API)
exports.getYouTubeChannelData = functions.https.onCall(async (data, context) => {
  const { channelUrl } = data;
  
  if (!channelUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Channel URL required');
  }
  
  // Rate limit: 5 YouTube lookups per 10 minutes
  const identifier = context.auth ? context.auth.uid : context.rawRequest.ip;
  await checkRateLimit(identifier, 'getYouTubeChannelData', 5, 10);
  
  try {
    // Get YouTube API key from environment variables
    const apiKey = process.env.YOUTUBE_API_KEY;
    
    if (!apiKey) {
      console.error('YouTube API key not configured');
      throw new functions.https.HttpsError('failed-precondition', 'YouTube API not configured');
    }

    // Extract channel ID or username from URL
    let channelId = null;
    let username = null;

    const handleMatch = channelUrl.match(/youtube\.com\/@([^\/\?]+)/i);
    if (handleMatch) {
      username = handleMatch[1];
    }

    const channelMatch = channelUrl.match(/youtube\.com\/channel\/([^\/\?]+)/i);
    if (channelMatch) {
      channelId = channelMatch[1];
    }

    const customMatch = channelUrl.match(/youtube\.com\/c\/([^\/\?]+)/i);
    if (customMatch) {
      username = customMatch[1];
    }

    let apiUrl;
    if (channelId) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`;
    } else if (username) {
      apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${username}&key=${apiKey}`;
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid YouTube URL format');
    }

    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new functions.https.HttpsError('internal', 'Failed to fetch YouTube data');
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      throw new functions.https.HttpsError('not-found', 'YouTube channel not found');
    }

    const channel = data.items[0];
    
    return {
      success: true,
      displayName: channel.snippet.title,
      photoURL: channel.snippet.thumbnails.medium?.url || channel.snippet.thumbnails.default?.url,
      description: channel.snippet.description || '',
      subscriberCount: channel.statistics.subscriberCount || '0',
      channelId: channel.id
    };
  } catch (error) {
    console.error('Error fetching YouTube data:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Failed to fetch YouTube channel data');
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
