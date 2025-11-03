import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './WelcomePage.css';

function WelcomePage({ onContinue }) {
  const { continueAsGuest, signInWithGoogle, signInWithApple } = useAuth();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signingInAs, setSigningInAs] = useState('user'); // 'user' or 'creator'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGuestMode = () => {
    console.log('User selected guest mode');
    continueAsGuest();
    onContinue();
  };

  const handleSignInClick = (type) => {
    console.log('Opening sign-in modal as:', type);
    setSigningInAs(type);
    setShowSignInModal(true);
    setError('');
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError('');
      const isCreator = signingInAs === 'creator';
      await signInWithGoogle(isCreator);
      onContinue();
    } catch (error) {
      console.error('Sign-in error:', error);
      setError(error.message || 'Failed to sign in with Google. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      setError('');
      const isCreator = signingInAs === 'creator';
      await signInWithApple(isCreator);
      onContinue();
    } catch (error) {
      console.error('Sign-in error:', error);
      setError(error.message || 'Failed to sign in with Apple. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="welcome-container">
      <div className="welcome-content">
        <h1 className="welcome-title">Welcome to The Subgames</h1>
        <p className="welcome-subtitle">
          Play fun minigames and support your favorite creators!
        </p>

        <div className="welcome-options">
          {/* Option 1: Guest Mode */}
          <div className="welcome-card">
            <div className="card-icon">🎮</div>
            <h2>Play as Guest</h2>
            <p>Jump right in and play games without signing in</p>
            <ul className="feature-list">
              <li>✓ Play all games</li>
              <li>✓ Browse leaderboards</li>
              <li>✗ Points don't track to creators</li>
            </ul>
            <button onClick={handleGuestMode} className="btn-primary">
              Continue as Guest
            </button>
          </div>

          {/* Option 2: Sign In as User */}
          <div className="welcome-card">
            <div className="card-icon">👤</div>
            <h2>Sign In as Player</h2>
            <p>Create an account to support your favorite creators</p>
            <ul className="feature-list">
              <li>✓ Play all games</li>
              <li>✓ Support creators with your points</li>
              <li>✓ Track your personal stats</li>
            </ul>
            <button 
              onClick={() => handleSignInClick('user')} 
              className="btn-primary"
            >
              Sign In as Player
            </button>
          </div>

          {/* Option 3: Sign In as Creator */}
          <div className="welcome-card featured">
            <div className="card-icon">⭐</div>
            <h2>Sign In as Creator</h2>
            <p>Are you a content creator? Get your own profile page!</p>
            <ul className="feature-list">
              <li>✓ Everything players get</li>
              <li>✓ Your own creator profile</li>
              <li>✓ View analytics & referral stats</li>
              <li>✓ Track your win/loss history</li>
            </ul>
            <button 
              onClick={() => handleSignInClick('creator')} 
              className="btn-creator"
            >
              Sign In as Creator
            </button>
          </div>
        </div>
      </div>

      {/* Sign-In Modal */}
      {showSignInModal && (
        <div className="modal-overlay" onClick={() => setShowSignInModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close" 
              onClick={() => setShowSignInModal(false)}
            >
              ×
            </button>
            
            <h2>Sign In as {signingInAs === 'creator' ? 'Creator' : 'Player'}</h2>
            <p className="modal-subtitle">
              Choose your sign-in method
            </p>

            {error && <div className="error-message">{error}</div>}

            <div className="sign-in-buttons">
              <button 
                onClick={handleGoogleSignIn} 
                className="btn-google"
                disabled={loading}
              >
                <span className="btn-icon">🔵</span>
                {loading ? 'Signing in...' : 'Continue with Google'}
              </button>

              <button 
                onClick={handleAppleSignIn} 
                className="btn-apple"
                disabled={loading}
              >
                <span className="btn-icon">🍎</span>
                {loading ? 'Signing in...' : 'Continue with Apple'}
              </button>
            </div>

            <p className="terms-text">
              By signing in, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default WelcomePage;
