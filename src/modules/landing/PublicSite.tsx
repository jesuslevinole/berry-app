import { useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PLATFORM_BRAND } from '../../config/platformBrand';
import { goToPublicPage, usePublicPage } from '../../hooks/usePublicPage';
import { applyBrandTheme } from '../../utils/brandTheme';
import { LoginView } from '../auth/LoginView';
import { SignupView } from '../auth/SignupView';
import { LandingView } from './LandingView';

const handleHome = () => goToPublicPage('landing');
const handleLogin = () => goToPublicPage('login');
const handleSignup = () => goToPublicPage('signup');

/**
 * Parte publica del app (sin empresa abierta): landing page, login y registro.
 * Usa la marca de la plataforma; la de cada empresa aparece al entrar a ella.
 * El registro va primero: al crear la cuenta la sesion se inicia sola y el
 * formulario debe seguir montado hasta terminar.
 */
export const PublicSite = () => {
  const { firebaseUser } = useAuth();
  const page = usePublicPage();

  /* Colores de la plataforma, no los de la ultima empresa abierta en este navegador. */
  useEffect(() => {
    applyBrandTheme(undefined);
  }, []);

  useEffect(() => {
    document.title = PLATFORM_BRAND.name;
  }, []);

  if (page === 'signup') return <SignupView onBack={handleLogin} onHome={handleHome} />;
  /* Con sesion pero sin empresa confirmada, el login muestra el paso "Company". */
  if (page === 'login' || firebaseUser) return <LoginView onRegister={handleSignup} onHome={handleHome} />;
  return <LandingView />;
};
