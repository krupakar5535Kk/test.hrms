import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPostAuthDestination } from '../lib/domainRules';
import { BrandIntroScreen } from '../components/BrandIntroScreen';

export const HomePage: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [shouldShowIntro] = useState<boolean>(() => {
    try {
      // Play once per browser session by default
      return sessionStorage.getItem('kmaccs_intro_played') !== 'true';
    } catch {
      return false;
    }
  });

  const [introFinished, setIntroFinished] = useState(false);

  if (loading) {
    return null;
  }

  // Authenticated user sessions are strictly preserved and never interrupted
  if (user) {
    return <Navigate to={getPostAuthDestination(user.role)} replace />;
  }

  // First-time session opening experience
  if (shouldShowIntro && !introFinished) {
    return (
      <BrandIntroScreen
        onComplete={() => {
          try {
            sessionStorage.setItem('kmaccs_intro_played', 'true');
          } catch {
            // Storage access graceful fallback
          }
          setIntroFinished(true);
          navigate('/login', { replace: true });
        }}
      />
    );
  }

  return <Navigate to="/login" replace />;
};
