# Notas de código (decisiones y pendientes)

Formato: `## AAAA-MM-DD — tema` y viñetas cortas. Escribir siempre al final.

## 2026-10-07 — Configurator / Company Info escuchan la empresa activa
- `AppConfigProvider` y `useCompany` se suscriben con `useActiveCompanyId()`. Antes se suscribían una sola vez al montar (sin empresa todavía) y nunca veían lo guardado.

## 2026-10-08 — Sincronización por cambios (control de lecturas)
- Colecciones completas: carga inicial desde cache + listener `where('updatedAt', '>=', max - 2 min)`; borrados por lápidas en `BD_DELETED`; resync completo cada 7 días (`berry-sync-v1:` en localStorage).
- Cache de Firestore con `CACHE_SIZE_UNLIMITED`: si se limita, el LRU borra documentos que ya no se vuelven a pedir.
- Requisito: toda escritura pasa por `services/firestore.ts` (pone `updatedAt` y lápida).

## 2026-10-08 — Liquidación
- Usa el precio del Purchase Order por producto (promedio ponderado si hay varias líneas); comisión = % del lote sobre ese subtotal.
- Solo gastos con `DEDUCT === true` se descuentan.

## 2026-10-13 — Pagos desde AR / AP
- `QuickPayModal`: si el documento tiene pagado guardado (AppSheet) pero sin registros, crea primero un registro "Paid before" para no perder ese monto al recalcular.
- `paymentsAudit` detecta pagos al grower por el monto exacto de un gasto pendiente del lote ("Bill paid as grower payment"); se mueven uno por uno, nunca en "Fix all".

## 2026-10-20 — Multi-empresa y marca
- Membresías pendientes con id `pending_<companyId>__<email>`: con `pending_<email>` la segunda empresa que agregaba el mismo correo pisaba la membresía de la primera.
- Al enviar la invitación, si el uid ya es membresía de otra empresa, la nueva queda como `uid__companyId` (no se pisa la otra).
- Color de marca en `settings_company/company.brandColor`; la paleta `--green-*` se genera en `utils/brandTheme.ts`. Vacío = paleta original de Berry en `brand.css`.
- La última marca usada (nombre, logo, color) se guarda en localStorage (`berry-last-brand`) solo para pintar el login antes de saber la empresa.

## 2026-10-20 — La empresa se elige en el login
- Login en dos pasos en la misma tarjeta: email + contraseña → "Continue" (valida con Firebase Auth) → campo "Company" (texto si hay una, lista si hay varias) → "Sign In". Sin consultas públicas email→empresa ni cambios en las reglas.
- `berry-company-override` = empresa confirmada; `login()` y `logout()` la borran, así cada entrada la vuelve a confirmar. Recargar la página no la pide de nuevo.
- Se quitaron el selector de empresa de la barra superior (`CompanySwitcher`) y `CompanyChooser`. En Companies, "Open" solo aparece sin empresa activa (primera configuración).
- Membresías `Inactive` no se ofrecen en el paso "Company".
- La migración de datos legados pasó a `services/legacyMigrationService.ts` (misma lógica: copia, nunca borra).

## 2026-10-20 — Registro de empresas con aprobación
- La empresa registrada nace `Pending` (con `ownerUid`) y el dueño `Pending Approval`; `isActive()` en las reglas los excluye, así que no leen ni escriben datos de negocio hasta **Approve** (Companies). No quitar: sin pagos, el formulario público dejaría usar el app gratis y gastaría las lecturas del plan Spark de todas las empresas.
- Approve activa primero al dueño y después la empresa: al ver el cambio de la ficha, el app del dueño se recarga (`AuthContext`) y ya debe poder entrar.
- El registro no pone prueba gratuita: con la prueba vencida `billingInfoOf` bloquea y aún no hay forma de pagar.
- Reglas: el auto-alta en `system_users` solo vale en una empresa `Pending` cuyo `ownerUid` es el mismo usuario (antes cualquiera podía darse de alta en una empresa existente conociendo su id); el propio usuario ya no puede cambiarse el `status`.
- `signupService` escribe directo (no `services/firestore.ts`): la empresa aún no es la activa y el dueño pendiente no puede escribir el historial.
- "Subscription not set" en la barra superior solo lo ve el admin de plataforma; Berry Source se marca **Exempt** en Companies → Edit.

## 2026-10-20 — Admin Panel y vencimiento
- Approve ahora inicia la prueba gratuita (antes no ponía fechas): sin fechas la empresa queda "Subscription not set" y nunca se bloquea, contrario a lo pedido.
- Registrar un pago suma 30 días por mes desde el fin vigente si aún le quedan días (no pierde lo pagado); si está vencida, desde hoy (`nextPaidThrough`).
- El bloqueo es de pantalla (`App.tsx` + `useToday`); quien use la API de Firestore directo aún podría leer. Bloquearlo en las reglas cuesta una lectura extra por consulta: decidir junto con Stripe.
- `PLATFORM_VIEW_IDS` no va en `MODULE_DEFS` a propósito: no debe salir en la matriz de roles de las empresas.

## 2026-10-20 — Admin Panel fuera de las empresas
- El Admin Panel es una consola aparte (`PlatformConsole`), elegida en el login como si fuera otra "empresa" (`__platform__`); dentro de una empresa ya no hay Admin Panel ni Companies en el menú.
- Admin por email exige `email_verified` (reglas y app): sin eso, cualquiera podía registrarse con el correo de un dueño que todavía no tuviera cuenta y quedar como admin de plataforma.
- `platform_admins` se lee con getDoc/getDocs puntuales y se escribe directo (no por `services/firestore.ts`): es global, diminuta, y sin empresa activa no hay donde poner lápidas ni historial.
- `logActivity` no escribe sin empresa activa: antes, una acción del admin sin empresa creaba documentos en `companies/__none__`.
- Se quitó `companies` de `MODULE_DEFS`: no es un módulo de empresa (los roles guardados con esa entrada no se rompen).

## 2026-10-20 — Dashboard de ingresos y "No payment required"
- "No payment required" reutiliza el campo `exempt` (no es un estado nuevo): ya significaba vía libre y no bloqueo; solo cambió el nombre visible y se puede marcar desde Subscriptions.
- Ingresos desde `platform_payments`: los pagos registrados antes de este cambio solo quedaron en `lastPayment*` de la empresa y no salen en las gráficas.
- Gráficas en HTML/CSS (sin librería nueva): altura y largo por variable CSS `--level`; tooltip con `:hover`/`:focus-visible`, sin estado de React.

## 2026-10-20 — Landing page y marca de la plataforma
- Landing con el contenido de itgresults.com; "Request a demo" abre un correo a info@itgresults.com (el formulario y la agenda del sitio no se copiaron).
- El registro (`#signup`) se elige antes que el paso "Company" en `PublicSite`: al crear la cuenta la sesión se inicia sola y el formulario debe seguir montado hasta terminar.
- Al entrar a una empresa o al Admin Panel se borra el hash: al cerrar sesión se vuelve a la landing.
- El login ya no muestra la última empresa usada: siempre la marca de la plataforma.

## 2026-10-20 — Landing con el diseño de itgresults.com
- Paleta del sitio del cliente en `brand.css` (`--ir-*`, no cambia por empresa) y tipografía Sora (Google Fonts en `index.html`).
- El video de portada se toma del Wix del cliente (`LANDING_MEDIA` en `landingContent.ts`): si dejan Wix hay que subirlo a `public/` y cambiar la ruta.
- Las tarjetas usan ilustraciones en CSS en lugar de las capturas del sitio (no se pudieron descargar). Animaciones solo con CSS + `Reveal` (IntersectionObserver); se apagan con "reducir movimiento".

## 2026-10-20 — Login y registro con la línea de la landing
- Login, paso "Company" y registro usan los colores `--ir-*` y Sora, igual que la landing. El selector de color del registro sigue con la paleta de la empresa (es la que se está eligiendo).

## 2026-10-21 — Cheque: memo alineado con la firma
- La línea del memo y la de la firma son ahora el borde inferior de su caja (antes la firma usaba borde superior), así quedan a la misma altura; el memo se estira hasta la firma. "Signature" cuelga debajo de la línea en el padding de `.bottom`, para no mover la línea de la firma sobre el papel preimpreso.

## 2026-10-21 — Prueba gratuita con límite y borrado; planes
- El borrado de pruebas vencidas es manual (botón en Subscriptions, hay que escribir el nombre de la empresa): decisión del desarrollador para que nada se borre sin confirmación. Automatizarlo requiere una cuenta de servicio de Firebase en el Worker.
- Bloqueo de 3 días antes del borrado (`TRIAL_GRACE_DAYS`): la pantalla de suscripción vencida avisa la fecha en que se borra.
- El límite de 10 por formulario cuenta los registros actuales (si borra uno, puede crear otro). Líneas de órdenes, pagos y configuración no cuentan. Es control del app, no de las reglas.
- El borrado no elimina las cuentas de Firebase Auth (no se puede desde el navegador): ese email no podrá volver a registrarse con el mismo correo hasta borrar la cuenta en la consola de Firebase.
- Planes en `platform_plans` con lectura pública en las reglas (la landing no tiene sesión). Lecturas puntuales, no por sincronización.

## Pendientes
- Pasarela de pago (Stripe propuesto): el webhook en el Worker escribiría `paidThrough` como hoy lo hace "Record payment"; el pago reemplazaría al botón Approve.
- Registro con un email que ya tiene cuenta: hoy muestra "inicia sesión"; falta crear la empresa desde adentro.
- Avisar por correo al admin de plataforma cuando se registra una empresa.
- Automatizar el borrado de pruebas vencidas (Worker + cuenta de servicio) y borrar las cuentas de Auth de esas empresas.
- Pasar a plan Blaze antes de tener empresas cliente reales (las 50 k lecturas/día son de todo el proyecto).
- Convertir a services el acceso directo a Firestore de `AuthContext`.
- `utils/format.ts` `todayISO()` usa `toISOString()` (fecha UTC): en Texas cambia de día a las 6–7 p. m.
