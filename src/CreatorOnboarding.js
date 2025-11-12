import React, { useState } from 'react';
import { useAuth } from './AuthContext';

function CreatorOnboarding({ onComplete }) {
  const { completeCreatorOnboarding } = useAuth();
  const [step, setStep] = useState(1);
  const [channelUrl, setChannelUrl] = useState('');
  const [promotionalUrl, setPromotionalUrl] = useState('');
  const [platform, setPlatform] = useState('');
  const [contentType, setContentType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStep1Submit = (e) => {
    e.preventDefault();
    setError('');

    if (!channelUrl.trim()) {
      setError('Please enter your channel URL');
      return;
    }

    // Basic URL validation
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(channelUrl)) {
      setError('Please enter a valid URL (starting with http:// or https://)');
      return;
    }

    // Extract platform from URL
    let detectedPlatform = '';
    if (channelUrl.includes('youtube.com') || channelUrl.includes('youtu.be')) {
      detectedPlatform = 'YouTube';
    } else if (channelUrl.includes('twitch.tv')) {
      detectedPlatform = 'Twitch';
    } else if (channelUrl.includes('kick.com')) {
      detectedPlatform = 'Kick';
    } else if (channelUrl.includes('tiktok.com')) {
      detectedPlatform = 'TikTok';
    }
    
    setPlatform(detectedPlatform);
    setStep(2);
  };

  const handleStep2Submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await completeCreatorOnboarding(channelUrl, promotionalUrl, platform, contentType);
      onComplete();
    } catch (error) {
      console.error('Error completing onboarding:', error);
      setError(error.message || 'Failed to complete setup. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        {step === 1 ? (
          <>
            <h2 className="text-2xl font-bold mb-2">Welcome, Creator! 🎉</h2>
            <p className="text-gray-300 mb-6">Let's set up your profile</p>

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleStep1Submit}>
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  Channel URL *
                </label>
                <input
                  type="text"
                  value={channelUrl}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  placeholder="https://youtube.com/@yourchannel"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-gray-400 mt-2">
                  Your YouTube, Twitch, Kick, or TikTok channel URL
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-6 rounded-lg transition"
              >
                Next
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-2">Almost Done! 🚀</h2>
            <p className="text-gray-300 mb-6">Add your promotional link</p>

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleStep2Submit}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Promotional URL (Optional)
                </label>
                <input
                  type="text"
                  value={promotionalUrl}
                  onChange={(e) => setPromotionalUrl(e.target.value)}
                  placeholder="https://linktr.ee/yourprofile"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-gray-400 mt-2">
                  Linktree, Beacons, or other promotional link
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Platform
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select platform</option>
                  <option value="YouTube">YouTube</option>
                  <option value="Twitch">Twitch</option>
                  <option value="Kick">Kick</option>
                  <option value="TikTok">TikTok</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  Content Type
                </label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-purple-500"
                >
                  <option value="">Select type</option>
                  <option value="Gaming">Gaming</option>
                  <option value="IRL">IRL</option>
                  <option value="Music">Music</option>
                  <option value="Art">Art</option>
                  <option value="Talk">Talk/Podcast</option>
                  <option value="Education">Education</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-6 rounded-lg transition disabled:opacity-50"
                >
                  {loading ? 'Completing...' : 'Complete Setup'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default CreatorOnboarding;
