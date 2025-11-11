import React, { useState, useEffect } from 'react';
import { auth, db, functions } from './firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

function CreatorSettings() {
  const [settings, setSettings] = useState({
    displayName: '',
    primaryPlatform: '',
    photoURL: '',
    followerCount: 0,
    socialLinks: {
      youtube: '',
      twitch: '',
      tiktok: '',
      instagram: ''
    }
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  
  const PLATFORMS = [
    { id: 'youtube', name: 'YouTube', icon: '▶️', color: 'red-500' },
    { id: 'twitch', name: 'Twitch', icon: '📺', color: 'purple-500' },
    { id: 'tiktok', name: 'TikTok', icon: '🎵', color: 'pink-500' },
    { id: 'instagram', name: 'Instagram', icon: '📷', color: 'pink-600' }
  ];
  
  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const loadSettings = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setSettings({
          displayName: data.displayName || '',
          primaryPlatform: data.primaryPlatform || '',
          photoURL: data.photoURL || '',
          followerCount: data.followerCount || 0,
          socialLinks: data.socialLinks || {
            youtube: '',
            twitch: '',
            tiktok: '',
            instagram: ''
          }
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showMessage('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };
  
  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };
  
  const fetchPlatformProfile = async (platform) => {
    const url = settings.socialLinks[platform];
    
    if (!url) {
      showMessage(`Please enter your ${platform} URL first`, 'error');
      return;
    }
    
    setFetching(true);
    try {
      const fetchProfile = httpsCallable(functions, 'fetchCreatorProfile');
      const result = await fetchProfile({ platform, url });
      
      if (result.data.success) {
        const profile = result.data.profile;
        setSettings(prev => ({
          ...prev,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          followerCount: profile.followerCount || 0,
          primaryPlatform: platform
        }));
        showMessage(`Profile fetched from ${platform} successfully!`, 'success');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      showMessage(error.message || 'Failed to fetch profile. Please try manual upload.', 'error');
    } finally {
      setFetching(false);
    }
  };
  
  const handleSaveSettings = async () => {
    if (!settings.displayName) {
      showMessage('Display name is required', 'error');
      return;
    }
    
    if (!settings.primaryPlatform) {
      showMessage('Please select a primary platform', 'error');
      return;
    }
    
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) return;
      
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: settings.displayName,
        primaryPlatform: settings.primaryPlatform,
        photoURL: settings.photoURL,
        followerCount: settings.followerCount,
        socialLinks: settings.socialLinks
      });
      
      showMessage('Settings saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      showMessage('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-xl">Loading settings...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8 text-center">Creator Settings</h1>
        
        {message.text && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
          }`}>
            {message.text}
          </div>
        )}
        
        {/* Profile Preview */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Profile Preview</h2>
          <div className="flex items-center space-x-4">
            {settings.photoURL ? (
              <img 
                src={settings.photoURL} 
                alt={settings.displayName}
                className="w-20 h-20 rounded-full border-2 border-purple-500"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-3xl text-gray-400">
                {settings.displayName.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div>
              <h3 className="text-xl font-bold text-white">
                {settings.displayName || 'Your Name'}
              </h3>
              {settings.primaryPlatform && (
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-2xl">
                    {PLATFORMS.find(p => p.id === settings.primaryPlatform)?.icon}
                  </span>
                  <span className={`text-${PLATFORMS.find(p => p.id === settings.primaryPlatform)?.color} font-semibold`}>
                    {PLATFORMS.find(p => p.id === settings.primaryPlatform)?.name} Creator
                  </span>
                </div>
              )}
              {settings.followerCount > 0 && (
                <div className="text-gray-400 text-sm mt-1">
                  {settings.followerCount.toLocaleString()} {settings.primaryPlatform === 'youtube' ? 'subscribers' : 'followers'}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Display Name */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <label className="block text-white font-semibold mb-2">Display Name</label>
          <input
            type="text"
            value={settings.displayName}
            onChange={(e) => setSettings(prev => ({ ...prev, displayName: e.target.value }))}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border-2 border-gray-600 focus:border-purple-500 focus:outline-none"
            placeholder="Enter your display name"
          />
        </div>
        
        {/* Social Media Platforms */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Connect Your Platforms</h2>
          <p className="text-gray-400 mb-4">
            Enter your channel URLs and click "Fetch Profile" to automatically import your profile picture and info.
          </p>
          
          {PLATFORMS.map(platform => (
            <div key={platform.id} className="mb-6 last:mb-0">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-2xl">{platform.icon}</span>
                <label className="text-white font-semibold">{platform.name}</label>
                {settings.primaryPlatform === platform.id && (
                  <span className="px-2 py-1 bg-yellow-500 text-xs font-bold rounded">PRIMARY</span>
                )}
              </div>
              
              <div className="flex space-x-2">
                <input
                  type="url"
                  value={settings.socialLinks[platform.id]}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    socialLinks: { ...prev.socialLinks, [platform.id]: e.target.value }
                  }))}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border-2 border-gray-600 focus:border-purple-500 focus:outline-none"
                  placeholder={`https://${platform.id}.com/yourchannel`}
                />
                <button
                  onClick={() => fetchPlatformProfile(platform.id)}
                  disabled={fetching || !settings.socialLinks[platform.id] || platform.id === 'instagram' || platform.id === 'tiktok'}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                    fetching || !settings.socialLinks[platform.id] || platform.id === 'instagram' || platform.id === 'tiktok'
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : `bg-${platform.color} text-white hover:opacity-80`
                  }`}
                  title={(platform.id === 'instagram' || platform.id === 'tiktok') ? 'Manual setup required - paste profile picture URL below' : ''}
                >
                  {fetching ? 'Fetching...' : (platform.id === 'instagram' || platform.id === 'tiktok') ? 'Manual Setup' : 'Fetch Profile'}
                </button>
                <button
                  onClick={() => setSettings(prev => ({ ...prev, primaryPlatform: platform.id }))}
                  disabled={!settings.socialLinks[platform.id]}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                    settings.primaryPlatform === platform.id
                      ? 'bg-yellow-500 text-black'
                      : !settings.socialLinks[platform.id]
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-gray-700 text-white hover:bg-gray-600'
                  }`}
                >
                  Set Primary
                </button>
              </div>
              
              {platform.id === 'instagram' && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-xs text-yellow-400 mb-2">
                    ⚠️ Instagram requires manual setup:
                  </p>
                  <ol className="text-xs text-gray-400 space-y-1 ml-4 list-decimal">
                    <li>Open your Instagram profile in a web browser</li>
                    <li>Right-click on your profile picture</li>
                    <li>Select "Copy Image Address" or "Open Image in New Tab"</li>
                    <li>Paste the image URL in the "Profile Picture URL" field below</li>
                  </ol>
                </div>
              )}
              
              {platform.id === 'tiktok' && (
                <div className="mt-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-xs text-yellow-400 mb-2">
                    ⚠️ TikTok requires manual setup:
                  </p>
                  <ol className="text-xs text-gray-400 space-y-1 ml-4 list-decimal">
                    <li>Open your TikTok profile in a web browser</li>
                    <li>Right-click on your profile picture</li>
                    <li>Select "Copy Image Address" or "Open Image in New Tab"</li>
                    <li>Paste the image URL in the "Profile Picture URL" field below</li>
                  </ol>
                </div>
              )}
              
              {platform.id === 'youtube' && (
                <p className="text-xs text-gray-500 mt-1">
                  Example: https://youtube.com/@YourChannel or https://youtube.com/channel/UC...
                </p>
              )}
            </div>
          ))}
        </div>
        
        {/* Profile Picture URL (Manual) */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <label className="block text-white font-semibold mb-2">
            Profile Picture URL (Optional - Manual Override)
          </label>
          <input
            type="url"
            value={settings.photoURL}
            onChange={(e) => setSettings(prev => ({ ...prev, photoURL: e.target.value }))}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border-2 border-gray-600 focus:border-purple-500 focus:outline-none"
            placeholder="https://example.com/your-photo.jpg"
          />
          <p className="text-xs text-gray-500 mt-1">
            If automatic fetch doesn't work, you can manually paste a direct link to your profile picture.
          </p>
        </div>
        
        {/* Save Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={handleSaveSettings}
            disabled={saving || !settings.displayName || !settings.primaryPlatform}
            className={`px-8 py-3 rounded-lg font-bold text-lg transition-all ${
              saving || !settings.displayName || !settings.primaryPlatform
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700'
            }`}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {/* Account Information */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Account Information</h2>
          <div className="space-y-3">
            <div>
              <label className="text-gray-400 text-sm">User ID</label>
              <div className="text-white font-mono bg-gray-700 px-3 py-2 rounded mt-1 break-all">
                {auth.currentUser?.uid || 'Not available'}
              </div>
            </div>
          </div>
        </div>

        {/* Legal Links */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-2xl font-bold text-white mb-4">Legal & Privacy</h2>
          <div className="space-y-3">
            <a 
              href="/privacy-policy.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              📄 Privacy Policy
            </a>
            <a 
              href="/terms-of-service.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              📋 Terms of Service
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreatorSettings;
