/** Variables y secretos del Worker (wrangler.jsonc + wrangler secret put). */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Secret: wrangler secret put RESEND_API_KEY */
  RESEND_API_KEY: string;
  /** Var: "Berry Source <noreply@tudominio.com>" (dominio verificado en Resend). */
  MAIL_FROM: string;
  /** Var: id del proyecto de Firebase (berry-app-7021e). */
  FIREBASE_PROJECT_ID: string;
  /** Secret: JSON de la cuenta de servicio de Firebase (escrituras de la plataforma: pagos). */
  FIREBASE_SERVICE_ACCOUNT: string;

  /* ---- Square (cobro de suscripciones) ---- */
  /** Var: "sandbox" o "production". */
  SQUARE_ENV: string;
  /** Var: Application ID (lo usa el formulario de tarjeta en el navegador). */
  SQUARE_APPLICATION_ID: string;
  /** Var: Location ID donde se registran las suscripciones. */
  SQUARE_LOCATION_ID: string;
  /** Secret: wrangler secret put SQUARE_ACCESS_TOKEN */
  SQUARE_ACCESS_TOKEN: string;
  /** Secret: Signature Key del webhook (Developer Console > Webhooks). */
  SQUARE_WEBHOOK_SIGNATURE_KEY: string;
  /** Var: URL del webhook EXACTAMENTE como se registro en Square (entra en la firma). */
  SQUARE_WEBHOOK_URL: string;
}
