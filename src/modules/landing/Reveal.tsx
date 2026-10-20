import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './Reveal.css';

/** Retraso de la animacion (valor en tiempo de ejecucion). */
const delayStyle = (delayMs: number): CSSProperties => ({ '--reveal-delay': `${delayMs}ms` }) as CSSProperties;

/** Navegadores sin IntersectionObserver muestran todo de una vez. */
const canObserve = (): boolean => typeof window !== 'undefined' && 'IntersectionObserver' in window;

interface RevealProps {
  children: ReactNode;
  /** Milisegundos de espera (para escalonar elementos vecinos). */
  delay?: number;
  /** Clases del bloque que lo usa (van antes del modificador). */
  className?: string;
}

/**
 * Aparece al entrar en pantalla (sube y se desvanece). Solo anima una vez y
 * respeta "reducir movimiento" del sistema (ver Reveal.css).
 */
export const Reveal = ({ children, delay = 0, className = '' }: RevealProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => !canObserve());

  useEffect(() => {
    const node = ref.current;
    if (!node || !canObserve()) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const classes = ['reveal', className, visible ? 'reveal--visible' : ''].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={classes} style={delayStyle(delay)}>
      {children}
    </div>
  );
};
