import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db, functions, auth } from './firebaseConfig';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import './CreatorProfile.css';

function CreatorProfile() {
  const { currentUser, userProfile, updateCreatorProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' or 'settings'
  const [isEditing, setIsEditing] = useState(false);
  const [channelUrl, setChannelUrl] = useState('');
  const [bio, setBio] = useState('');
  const [gameHistory, setGameHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Settings state
  const [displayName, setDisplayName] = useState('');
  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [connectedPlatforms, setConnectedPlatforms] = useState([]);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (userProfile?.creatorProfile) {
        setChannelUrl(userProfile.creatorProfile.channelUrl || '');
        setBio(userProfile.creatorProfile.bio || '');
      }
      
      // Load settings data
      if (userProfile) {
        setDisplayName(userProfile.displayName || '');
        setProfilePictureUrl(userProfile.photoURL || '');
      }
      
      await loadGameHistory();
      await loadConnectedPlatforms();
    };
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile]);

  const loadConnectedPlatforms = async () => {
    if (!currentUser) return;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        const platforms = [];
        
        if (data.socialLinks) {
          Object.entries(data.socialLinks).forEach(([platform, url]) => {
            if (url) {
              platforms.push({
                platform,
                url,
                status: data.platformStatus?.[platform] || 'pending'
              });
            }
          });
        }
        
        setConnectedPlatforms(platforms);
      }
    } catch (error) {
      console.error('Error loading connected platforms:', error);
    }
  };

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

  const handleSaveSettings = async () => {
    if (!currentUser) return;
    
    try {
      setSettingsSaving(true);
      
      const userRef = doc(db, 'users', currentUser.uid);
      const updates = {};
      
      if (displayName) updates.displayName = displayName;
      if (profilePictureUrl) updates.photoURL = profilePictureUrl;
      
      await updateDoc(userRef, updates);
      
      alert('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings: ' + error.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleConnectPlatform = async () => {
    if (!selectedPlatform || !currentUser) {
      alert('Please select a platform');
      return;
    }
    
    const platformUrl = prompt(`Enter your ${selectedPlatform} URL:`);
    if (!platformUrl) return;
    
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        [`socialLinks.${selectedPlatform}`]: platformUrl,
        [`platformStatus.${selectedPlatform}`]: 'pending'
      });
      
      await loadConnectedPlatforms();
      setSelectedPlatform('');
      alert(`${selectedPlatform} connected! Status: Pending verification`);
    } catch (error) {
      console.error('Error connecting platform:', error);
      alert('Failed to connect platform');
    }
  };

  const handleRemovePlatform = async (platform) => {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm(`Remove ${platform} connection?`)) return;
    
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        [`socialLinks.${platform}`]: '',
        [`platformStatus.${platform}`]: ''
      });
      
      await loadConnectedPlatforms();
      alert(`${platform} removed`);
    } catch (error) {
      console.error('Error removing platform:', error);
      alert('Failed to remove platform');
    }
  };

  const handleSignOut = async () => {
    // eslint-disable-next-line no-restricted-globals
    if (!confirm('Are you sure you want to sign out?')) return;
    
    try {
      await signOut(auth);
      // Redirect handled by AuthContext
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Failed to sign out: ' + error.message);
    }
  };

  const openPrivacyPolicy = () => {
    window.open('/privacy-policy.html', '_blank');
  };

  const openTermsOfService = () => {
    window.open('/terms-of-service.html', '_blank');
  };

  const winRate = userProfile?.gamesPlayed > 0 
    ? ((userProfile.gamesWon / userProfile.gamesPlayed) * 100).toFixed(1) 
    : 0;

  return (
    <div className="creator-profile-container">
      {/* Tab Navigation */}
      <div className="profile-tabs">
        <button
          className={`tab-button ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          👤 Profile
        </button>
        <button
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Profile Tab Content */}
      {activeTab === 'profile' && (
        <>
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
        </>
      )}

      {/* Settings Tab Content */}
      {activeTab === 'settings' && (
        <div className="settings-content">
          {/* Display Name */}
          <div className="profile-section">
            <h3>Display Name</h3>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input-field"
              placeholder="Your display name"
            />
          </div>

          {/* Connect Platforms */}
          {userProfile?.accountType === 'creator' && (
            <div className="profile-section">
              <h3>Connect Your Platforms</h3>
              <p className="section-description">
                Link your content platforms. This will automatically import your profile picture and info.
              </p>
              
              <div className="platform-selector">
                <label>Which platform do you use?</label>
                <select
                  value={selectedPlatform}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select a platform...</option>
                  <option value="youtube">YouTube</option>
                  <option value="twitch">Twitch</option>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">Instagram</option>
                </select>
                {selectedPlatform && (
                  <button onClick={handleConnectPlatform} className="btn-connect">
                    Connect {selectedPlatform}
                  </button>
                )}
              </div>

              {/* Connected Platforms */}
              {connectedPlatforms.length > 0 && (
                <div className="connected-platforms">
                  <h4>Connected Platforms:</h4>
                  {connectedPlatforms.map((platform) => (
                    <div key={platform.platform} className="platform-item">
                      <span className="platform-icon">
                        {platform.platform === 'youtube' && '▶️'}
                        {platform.platform === 'twitch' && '📺'}
                        {platform.platform === 'tiktok' && '🎵'}
                        {platform.platform === 'instagram' && '📷'}
                      </span>
                      <span className="platform-name">
                        {platform.platform.charAt(0).toUpperCase() + platform.platform.slice(1)}
                      </span>
                      <span className={`platform-status ${platform.status}`}>
                        {platform.status.toUpperCase()}
                      </span>
                      <button
                        onClick={() => handleRemovePlatform(platform.platform)}
                        className="btn-remove"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Profile Picture URL */}
          <div className="profile-section">
            <h3>Profile Picture URL (Optional)</h3>
            <input
              type="url"
              value={profilePictureUrl}
              onChange={(e) => setProfilePictureUrl(e.target.value)}
              className="input-field"
              placeholder="https://example.com/your-picture.jpg"
            />
          </div>

          {/* Save Settings Button */}
          <div className="profile-section">
            <button
              onClick={handleSaveSettings}
              className="btn-save-settings"
              disabled={settingsSaving}
            >
              {settingsSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Account Information */}
          <div className="profile-section">
            <h3>Account Information</h3>
            <div className="account-info">
              <input
                type="text"
                value={currentUser?.uid || ''}
                className="input-field"
                disabled
              />
            </div>
          </div>

          {/* Legal & Privacy */}
          <div className="profile-section">
            <h3>Legal & Privacy</h3>
            <div className="legal-buttons">
              <button onClick={openPrivacyPolicy} className="btn-legal">
                📄 Privacy Policy
              </button>
              <button onClick={openTermsOfService} className="btn-legal">
                📋 Terms of Service
              </button>
            </div>
          </div>

          {/* Account Actions */}
          <div className="profile-section">
            <h3>Account Actions</h3>
            <button onClick={handleSignOut} className="btn-signout">
              🚪 Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CreatorProfile;
