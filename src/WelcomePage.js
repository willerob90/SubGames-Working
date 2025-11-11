import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './WelcomePage.css';

function WelcomePage({ onContinue }) {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signingInAs, setSigningInAs] = useState('user'); // 'user' or 'creator'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        <h1 className="welcome-title">
          <span className="title-the">The</span>
          <span className="title-subgames">SubGames</span>
        </h1>

        <div className="welcome-buttons">
          <button 
            onClick={() => handleSignInClick('user')} 
            className="btn-player"
          >
            Sign In as Player
          </button>

          <button 
            onClick={() => handleSignInClick('creator')} 
            className="btn-creator"
          >
            Sign In as Creator
          </button>
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
