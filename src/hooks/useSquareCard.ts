import { useEffect, useRef, useState } from 'react';
import type { SquareConfig } from '../services/squareBillingService';

/* Tipos minimos del Web Payments SDK de Square (se carga como script, no como paquete). */
interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: { message?: string }[];
}

interface SquareCardField {
  attach(selector: string): Promise<void>;
  tokenize(): Promise<SquareTokenResult>;
  destroy(): Promise<boolean>;
}

interface SquarePayments {
  card(): Promise<SquareCardField>;
}

declare global {
  interface Window {
    Square?: { payments(applicationId: string, locationId: string): SquarePayments };
  }
}

const SDK_URLS: Record<SquareConfig['environment'], string> = {
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js',
  production: 'https://web.squarecdn.com/v1/square.js',
};

/* El script se carga una sola vez por pagina. */
let sdkLoading: Promise<void> | null = null;

const loadSdk = (environment: SquareConfig['environment']): Promise<void> => {
  if (window.Square) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URLS[environment];
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkLoading = null;
      reject(new Error('The payment form could not be loaded. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return sdkLoading;
};

export type SquareCardStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Campo de tarjeta de Square dentro de `#containerId`. La tarjeta la captura Square en su propio
 * iframe: el app solo recibe un token de un solo uso (`tokenize`) que se manda al Worker.
 */
export function useSquareCard(config: SquareConfig | null, containerId: string) {
  const cardRef = useRef<SquareCardField | null>(null);
  const [status, setStatus] = useState<SquareCardStatus>('idle');
  const [error, setError] = useState('');

  /* Monta el campo de tarjeta cuando hay configuracion y lo destruye al salir. */
  useEffect(() => {
    if (!config) return undefined;
    let cancelled = false;
    const mountCard = async () => {
      try {
        await loadSdk(config.environment);
        if (!window.Square) throw new Error('The payment form could not be loaded.');
        const card = await window.Square.payments(config.applicationId, config.locationId).card();
        if (cancelled) {
          void card.destroy();
          return;
        }
        await card.attach(`#${containerId}`);
        cardRef.current = card;
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || 'The payment form could not be loaded.');
        setStatus('error');
      }
    };
    void mountCard();
    return () => {
      cancelled = true;
      void cardRef.current?.destroy();
      cardRef.current = null;
    };
  }, [config, containerId]);

  /** Token de la tarjeta escrita; lanza error con el motivo si falta algun dato. */
  const tokenize = async (): Promise<string> => {
    if (!cardRef.current) throw new Error('The payment form is not ready yet.');
    const result = await cardRef.current.tokenize();
    if (result.status === 'OK' && result.token) return result.token;
    throw new Error(result.errors?.[0]?.message ?? 'Check the card details.');
  };

  /* Mientras se monta (hay config pero aun no termina) se ve como "loading". */
  const shownStatus: SquareCardStatus = config && status === 'idle' ? 'loading' : status;

  return { status: shownStatus, error, tokenize };
}
