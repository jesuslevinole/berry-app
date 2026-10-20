import { useEffect, useState } from 'react';

/** Paginas publicas (sin sesion): landing, login y registro de empresa. */
export type PublicPage = 'landing' | 'login' | 'signup';

const pageFromHash = (): PublicPage => {
  if (window.location.hash === '#login') return 'login';
  if (window.location.hash === '#signup') return 'signup';
  return 'landing';
};

/**
 * Pagina publica actual segun el hash de la URL (#login, #signup). Con el hash,
 * el boton "atras" del navegador vuelve a la landing y se puede compartir el enlace.
 */
export const usePublicPage = (): PublicPage => {
  const [page, setPage] = useState<PublicPage>(pageFromHash);

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return page;
};

export const goToPublicPage = (page: PublicPage): void => {
  window.location.hash = page === 'landing' ? '' : page;
  window.scrollTo({ top: 0 });
};

/** Al entrar al app se limpia el hash, para no volver al registro al cerrar sesion. */
export const clearPublicPage = (): void => {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
};
