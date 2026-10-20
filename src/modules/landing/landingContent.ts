/**
 * Textos y medios de la landing page, tomados de itgresults.com (sitio actual del
 * cliente). Se editan aqui sin tocar el diseño (LandingView solo los pinta).
 */
export interface LandingItem {
  title: string;
  text: string;
}

/**
 * Video de portada: es el del sitio actual (alojado en Wix). Si el cliente deja
 * Wix, hay que subir el video a este proyecto (public/) y cambiar la ruta aqui.
 */
export const LANDING_MEDIA = {
  heroVideo: 'https://video.wixstatic.com/video/ba0541_780f19a68c4a49f5a0e9fb1c7e9fe5c7/1080p/mp4/file.mp4',
  heroPoster:
    'https://static.wixstatic.com/media/ba0541_780f19a68c4a49f5a0e9fb1c7e9fe5c7f000.jpg/v1/fill/w_1425,h_616,al_c,q_85,usm_0.33_1.00_0.00/file.jpg',
};

export const LANDING_INTRO = {
  text: 'Integrated Results is a web-based platform built for small businesses to manage purchases, sales, invoices, and accounting in one secure system',
  highlight: '— without spreadsheets or paperwork chaos.',
};

export const LANDING_HIGHLIGHTS = {
  title: 'Empowering Your Business with',
  titleHighlight: 'Integrated Results',
  text: 'A live demo shows how Integrated Results simplifies commercial and trading operations by bringing purchases, sales, accounting, and documentation into one secure platform.',
  items: [
    'Managing sales orders, purchase orders, and invoices',
    'Automated document generation and email delivery',
    'Real-time visibility into A/R, A/P, sales, and purchases',
  ],
};

export const LANDING_FEATURES: { title: string; titleHighlight: string; items: LandingItem[] } = {
  title: 'Web Based',
  titleHighlight: 'Features',
  items: [
    {
      title: 'Easy CRM & Client Communications',
      text: 'Integrated Results includes a purpose-built CRM with a central dashboard, branded invoicing and built-in client messaging, so every customer conversation lives next to its orders.',
    },
    {
      title: 'Advanced Reporting & Analytics',
      text: 'Integrated Results gives you real-time reporting on sales, purchases, expenses, accounts receivable and accounts payable.',
    },
    {
      title: 'Reduce Manual Workload',
      text: 'Integrated Results automates orders, invoices, reports and document delivery, cutting paperwork and repetitive data entry.',
    },
  ],
};

/** Valores del grafico de la tarjeta de reportes (los mismos porcentajes del sitio). */
export const LANDING_REPORT_BARS = [32, 44, 53, 21, 27];

export const LANDING_BENEFITS: Array<LandingItem & { highlight: string }> = [
  {
    title: 'Clarity Over',
    highlight: 'Chaos',
    text: 'Commerce operations generate a lot of moving parts. One centralized system replaces scattered spreadsheets, emails and paperwork.',
  },
  {
    title: 'Built to',
    highlight: 'Protect',
    text: 'Locked records, controlled access and a complete audit trail keep your data intact.',
  },
  {
    title: 'Do More With',
    highlight: 'Less Effort',
    text: 'Document generation and email outreach run on their own, so your team focuses on the business.',
  },
];

export const LANDING_CTA = {
  lines: ['Are You Ready to', 'Transform Your'],
  highlight: 'Customer Relationships?',
  text: 'Create your company account in minutes, or book a free demo with our team.',
};
