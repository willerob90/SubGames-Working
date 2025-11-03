import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db, functions } from './firebaseConfig';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './CreatorProfile.css';

function CreatorProfile() {
  const { currentUser, userProfile, updateCreatorProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [channelUrl, setChannelUrl] = useState('');
  const [bio, setBio] = useState('');
  const [gameHistory, setGameHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (userProfile?.creatorProfile) {
        setChannelUrl(userProfile.creatorProfile.channelUrl || '');
        setBio(userProfile.creatorProfile.bio || '');
      }
      await loadGameHistory();
    };
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  const loadGameHistory = async () => {
    if (!currentUser) return;

    try {
      setLoading(true);
      // Get recent game results for this user
      const resultsQuery = query(
        collection(db, 'gameResults'),
        where('userId', '==', currentUser.uid),
        orderBy('timestamp', 'desc'),
        limit(20)
      );

      const snapshot = await getDocs(resultsQuery);
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(),
      }));

      setGameHistory(history);
      console.log('Loaded game history:', history.length, 'games');
    } catch (error) {
      console.error('Error loading game history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setSaving(true);
      await updateCreatorProfile({
        channelUrl,
        bio,
      });
      setIsEditing(false);
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTrackReferral = async (channelUrl) => {
    if (!channelUrl || !currentUser) return;
    
    try {
      // Track the click using Cloud Function
      const trackReferral = httpsCallable(functions, 'trackReferralClick');
      await trackReferral({ creatorId: currentUser.uid });
      
      console.log('Referral click tracked to:', channelUrl);
    } catch (error) {
      console.error('Error tracking referral:', error);
    }
    
    // Open in new tab
    window.open(channelUrl, '_blank');
  };

  if (!userProfile?.isCreator) {
    return (
      <div className="creator-profile-container">
        <div className="error-box">
          <h2>Access Denied</h2>
          <p>This page is only available to creators.</p>
        </div>
      </div>
    );
  }

  const winRate = userProfile.gamesPlayed > 0 
    ? ((userProfile.gamesWon / userProfile.gamesPlayed) * 100).toFixed(1) 
    : 0;

  return (
    <div className="creator-profile-container">
      <div className="profile-header">
        <div className="profile-avatar">
          {userProfile.photoURL ? (
            <img src={userProfile.photoURL} alt={userProfile.displayName} />
          ) : (
            <div className="avatar-placeholder">
              {userProfile.displayName?.charAt(0) || '?'}
            </div>
          )}
        </div>
        <div className="profile-info">
          <h1>{userProfile.displayName}</h1>
          <p className="profile-email">{userProfile.email}</p>
          <span className="creator-badge">⭐ Creator</span>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🎮</div>
          <div className="stat-value">{userProfile.gamesPlayed || 0}</div>
          <div className="stat-label">Games Played</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏆</div>
          <div className="stat-value">{userProfile.gamesWon || 0}</div>
          <div className="stat-label">Games Won</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-value">{winRate}%</div>
          <div className="stat-label">Win Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⭐</div>
          <div className="stat-value">{userProfile.totalPointsEarned || 0}</div>
          <div className="stat-label">Total Points</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔗</div>
          <div className="stat-value">
            {userProfile.creatorProfile?.referralClicks || 0}
          </div>
          <div className="stat-label">Channel Visits</div>
        </div>
      </div>

      {/* Creator Profile Section */}
      <div className="profile-section">
        <div className="section-header">
          <h2>Creator Profile</h2>
          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} className="btn-edit">
              Edit Profile
            </button>
          ) : (
            <div className="edit-buttons">
              <button onClick={handleSaveProfile} className="btn-save" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button 
                onClick={() => {
                  setIsEditing(false);
                  setChannelUrl(userProfile.creatorProfile?.channelUrl || '');
                  setBio(userProfile.creatorProfile?.bio || '');
                }} 
                className="btn-cancel"
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="profile-fields">
          <div className="field-group">
            <label>Channel URL</label>
            {isEditing ? (
              <input
                type="url"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                placeholder="https://youtube.com/@yourchannel"
                className="input-field"
              />
            ) : (
              <div className="field-value">
                {channelUrl ? (
                  <button 
                    onClick={() => handleTrackReferral(channelUrl)}
                    className="channel-link"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {channelUrl}
                  </button>
                ) : (
                  <span className="empty-value">Not set</span>
                )}
              </div>
            )}
          </div>

          <div className="field-group">
            <label>Bio</label>
            {isEditing ? (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell viewers about yourself..."
                className="input-field textarea"
                rows="4"
              />
            ) : (
              <div className="field-value">
                {bio || <span className="empty-value">No bio yet</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game History */}
      <div className="profile-section">
        <h2>Recent Game History</h2>
        {loading ? (
          <div className="loading">Loading game history...</div>
        ) : gameHistory.length === 0 ? (
          <div className="empty-state">
            <p>No games played yet. Go play some minigames!</p>
          </div>
        ) : (
          <div className="game-history">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Time</th>
                  <th>Points</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {gameHistory.map((game) => (
                  <tr key={game.id}>
                    <td>
                      {game.timestamp.toLocaleDateString()} {game.timestamp.toLocaleTimeString()}
                    </td>
                    <td>{game.gameType || 'Reaction Test'}</td>
                    <td>{game.timeTaken}ms</td>
                    <td>{game.pointsAwarded || 0}</td>
                    <td>
                      <span className={`result-badge ${game.isWin ? 'win' : 'loss'}`}>
                        {game.isWin ? '✓ Win' : '✗ Loss'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreatorProfile;
