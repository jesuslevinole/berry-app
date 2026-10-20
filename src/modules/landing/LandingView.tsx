import type { CSSProperties } from 'react';
import { DEMO_REQUEST_URL, PLATFORM_BRAND } from '../../config/platformBrand';
import { goToPublicPage } from '../../hooks/usePublicPage';
import {
  LANDING_BENEFITS,
  LANDING_CTA,
  LANDING_FEATURES,
  LANDING_HIGHLIGHTS,
  LANDING_INTRO,
  LANDING_MEDIA,
  LANDING_REPORT_BARS,
} from './landingContent';
import { Reveal } from './Reveal';
import './LandingView.css';

/** "01", "02"... para las listas numeradas. */
const stepNumber = (index: number): string => String(index + 1).padStart(2, '0');

/** Indice de un elemento repetido: escalona las animaciones con CSS (valor en tiempo de ejecucion). */
const indexStyle = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;

/** Altura y orden de una barra del grafico ilustrativo (valores en tiempo de ejecucion). */
const barStyle = (percent: number, index: number): CSSProperties =>
  ({ '--level': `${percent}%`, '--i': index }) as CSSProperties;

/** Franjas que se abren sobre el video de portada, como en el sitio actual. */
const HERO_STRIPES = Array.from({ length: 10 }, (_, index) => index);
/** Columnas animadas entre la introduccion y "Empowering"; las marcadas brillan en verde lima. */
const PILLARS = Array.from({ length: 16 }, (_, index) => index);
const LIT_PILLARS = new Set([1, 3, 4, 8, 13]);

const handleLogin = () => goToPublicPage('login');
const handleSignup = () => goToPublicPage('signup');

const LandingHeader = () => (
  <header className="landing__header">
    <div className="landing__container landing__header-inner">
      <img className="landing__header-logo" src={PLATFORM_BRAND.logoWhite} alt={PLATFORM_BRAND.name} />
      <nav className="landing__nav" aria-label="Main">
        <a className="landing__nav-link" href={PLATFORM_BRAND.website} target="_blank" rel="noreferrer">Company</a>
        <a className="landing__nav-link" href={`mailto:${PLATFORM_BRAND.email}`}>Support</a>
        <a className="landing__nav-link landing__nav-link--boxed" href={DEMO_REQUEST_URL}>Request a demo</a>
      </nav>
      <div className="landing__header-actions">
        <button type="button" className="landing__button landing__button--ghost" onClick={handleLogin}>
          Log in
        </button>
        <button type="button" className="landing__button landing__button--lime" onClick={handleSignup}>
          Sign up
        </button>
      </div>
    </div>
  </header>
);

/** Video de productos a todo lo ancho; las franjas azules se abren al cargar. */
const LandingHeroMedia = () => (
  <section className="landing__media" aria-label="Integrated Results">
    <video
      className="landing__media-video"
      src={LANDING_MEDIA.heroVideo}
      poster={LANDING_MEDIA.heroPoster}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
    />
    <div className="landing__stripes" aria-hidden="true">
      {HERO_STRIPES.map((index) => (
        <span key={index} className="landing__stripe" style={indexStyle(index)} />
      ))}
    </div>
  </section>
);

const LandingIntro = () => (
  <section className="landing__intro">
    <div className="landing__container">
      <Reveal>
        <h1 className="landing__intro-text">
          {LANDING_INTRO.text}
          <span className="landing__lime"> {LANDING_INTRO.highlight}</span>
        </h1>
      </Reveal>
      <Reveal delay={150} className="landing__actions">
        <a className="landing__pill" href={DEMO_REQUEST_URL}>
          Request a demo <span className="landing__pill-arrow" aria-hidden="true">&#9656;</span>
        </a>
        <button type="button" className="landing__button landing__button--lime landing__button--large" onClick={handleSignup}>
          Sign up
        </button>
        <button type="button" className="landing__button landing__button--outline landing__button--large" onClick={handleLogin}>
          Log in
        </button>
      </Reveal>
    </div>
  </section>
);

/** Fila de columnas que se encienden en cadena (decorativa). */
const LandingPillars = () => (
  <div className="landing__pillars" aria-hidden="true">
    {PILLARS.map((index) => (
      <span
        key={index}
        className={`landing__pillar${LIT_PILLARS.has(index) ? ' landing__pillar--lit' : ''}`}
        style={indexStyle(index)}
      />
    ))}
  </div>
);

/* ---- Ilustraciones de las tres tarjetas (CSS, decorativas) ---- */
const DocumentsArt = () => (
  <div className="landing-art landing-art--documents" aria-hidden="true">
    {['Sales order', 'Purchase order', 'Invoice'].map((label, index) => (
      <span key={label} className="landing-art__sheet" style={indexStyle(index)}>
        <span className="landing-art__sheet-head">
          <span className="landing-art__logo">YOUR LOGO</span>
          <span className="landing-art__sheet-title">{label}</span>
        </span>
        <span className="landing-art__line" />
        <span className="landing-art__line landing-art__line--short" />
        <span className="landing-art__line" />
      </span>
    ))}
  </div>
);

const EmailArt = () => (
  <div className="landing-art landing-art--email" aria-hidden="true">
    {['Invoice #46119', 'Purchase order #2087', 'Statement · October', 'Passing #46118'].map((subject, index) => (
      <span key={subject} className="landing-art__mail" style={indexStyle(index)}>
        <span className="landing-art__avatar" />
        <span className="landing-art__subject">{subject}</span>
        <span className="landing-art__sent">Sent</span>
      </span>
    ))}
  </div>
);

const LedgerArt = () => (
  <div className="landing-art landing-art--ledger" aria-hidden="true">
    {['Open', 'Paid', 'Open', 'Partial', 'Paid'].map((status, index) => (
      <span key={index} className="landing-art__row" style={indexStyle(index)}>
        <span className="landing-art__line" />
        <span className={`landing-art__status landing-art__status--${status.toLowerCase()}`}>{status}</span>
      </span>
    ))}
  </div>
);

const HIGHLIGHT_ART = [DocumentsArt, EmailArt, LedgerArt];

const LandingHighlights = () => (
  <section className="landing__section">
    <div className="landing__container">
      <div className="landing__split">
        <Reveal>
          <h2 className="landing__heading">
            {LANDING_HIGHLIGHTS.title}
            <span className="landing__lime landing__block">{LANDING_HIGHLIGHTS.titleHighlight}</span>
          </h2>
        </Reveal>
        <Reveal delay={150}>
          <p className="landing__copy">{LANDING_HIGHLIGHTS.text}</p>
        </Reveal>
      </div>
      <div className="landing__showcase">
        {LANDING_HIGHLIGHTS.items.map((item, index) => {
          const Art = HIGHLIGHT_ART[index];
          return (
            <Reveal key={item} delay={index * 140} className="landing__frame">
              <span className="landing__frame-tag">{stepNumber(index)}</span>
              <Art />
              <p className="landing__frame-caption">{item}</p>
            </Reveal>
          );
        })}
      </div>
    </div>
  </section>
);

/** Grafico de la tarjeta de reportes: las barras crecen al aparecer. */
const ReportArt = () => (
  <div className="landing-report" aria-hidden="true">
    {LANDING_REPORT_BARS.map((percent, index) => (
      <span key={index} className="landing-report__bar" style={barStyle(percent, index)}>
        <span className="landing-report__value">{percent}%</span>
      </span>
    ))}
  </div>
);

const LandingFeatures = () => (
  <section id="features" className="landing__section landing__section--features">
    <div className="landing__container">
      <Reveal className="landing__features-card">
        <span className="landing__frames" aria-hidden="true">
          <span className="landing__frame-outline" style={indexStyle(0)} />
          <span className="landing__frame-outline" style={indexStyle(1)} />
          <span className="landing__frame-outline" style={indexStyle(2)} />
        </span>
        <h2 className="landing__features-title">
          {LANDING_FEATURES.title} <span className="landing__green">{LANDING_FEATURES.titleHighlight}</span>
        </h2>
        <span className="landing__scroll-hint">
          Keep scrolling <span className="landing__scroll-dot" aria-hidden="true" />
        </span>
      </Reveal>

      <div className="landing__feature-list">
        {LANDING_FEATURES.items.map((item, index) => (
          <Reveal key={item.title} className="landing__feature">
            <div className="landing__feature-head">
              <span className="landing__feature-number">{stepNumber(index)}</span>
              <h3 className="landing__feature-title">{item.title}</h3>
            </div>
            <div className="landing__feature-body">
              <p className="landing__feature-text">{item.text}</p>
              {index === 1 && <ReportArt />}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

const LandingBenefits = () => (
  <section id="benefits" className="landing__section">
    <div className="landing__container landing__benefits">
      {LANDING_BENEFITS.map((benefit, index) => (
        <Reveal key={benefit.title} className="landing__benefit">
          <span className="landing__benefit-number">{stepNumber(index)}</span>
          <div>
            <h3 className="landing__benefit-title">
              {benefit.title} <span className="landing__lime">{benefit.highlight}</span>
            </h3>
            <p className="landing__copy">{benefit.text}</p>
          </div>
        </Reveal>
      ))}
    </div>
  </section>
);

const LandingCta = () => (
  <section id="contact" className="landing__section landing__section--cta">
    <div className="landing__container">
      <Reveal>
        <h2 className="landing__cta-title">
          {LANDING_CTA.lines.map((line) => (
            <span key={line} className="landing__block">{line}</span>
          ))}
          <span className="landing__lime landing__block">{LANDING_CTA.highlight}</span>
        </h2>
      </Reveal>
      <Reveal delay={150}>
        <p className="landing__copy landing__copy--wide">{LANDING_CTA.text}</p>
        <div className="landing__actions">
          <button type="button" className="landing__button landing__button--lime landing__button--large" onClick={handleSignup}>
            Sign up
          </button>
          <a className="landing__pill" href={DEMO_REQUEST_URL}>
            Book a free demo <span className="landing__pill-arrow" aria-hidden="true">&#9656;</span>
          </a>
        </div>
      </Reveal>
    </div>
  </section>
);

const LandingFooter = () => (
  <footer className="landing__footer">
    <div className="landing__container landing__footer-grid">
      <div>
        <p className="landing__footer-label">Contact</p>
        <a className="landing__footer-link" href={`mailto:${PLATFORM_BRAND.email}`}>{PLATFORM_BRAND.email}</a>
      </div>
      <nav aria-label="Footer">
        <p className="landing__footer-label">Menu</p>
        <a className="landing__footer-link" href={PLATFORM_BRAND.website} target="_blank" rel="noreferrer">Company</a>
        <a className="landing__footer-link" href={DEMO_REQUEST_URL}>Request a demo</a>
        <a className="landing__footer-link" href={`mailto:${PLATFORM_BRAND.email}`}>Support</a>
        <button type="button" className="landing__footer-link" onClick={handleLogin}>Log in</button>
      </nav>
      <div className="landing__footer-brand">
        <img className="landing__footer-logo" src={PLATFORM_BRAND.logoWhite} alt={PLATFORM_BRAND.name} />
        <p className="landing__copyright">
          &copy; {new Date().getFullYear()} by {PLATFORM_BRAND.legalName}
        </p>
      </div>
    </div>
  </footer>
);

/**
 * Pagina de inicio publica, con el diseño del sitio actual del cliente (itgresults.com):
 * azul marino, tipografia Sora y acentos verde lima. Animaciones con CSS; la entrada
 * al hacer scroll la da Reveal.
 */
export const LandingView = () => (
  <div className="landing">
    <LandingHeader />
    <main>
      <LandingHeroMedia />
      <LandingIntro />
      <LandingPillars />
      <LandingHighlights />
      <LandingFeatures />
      <LandingBenefits />
      <LandingCta />
    </main>
    <LandingFooter />
  </div>
);
