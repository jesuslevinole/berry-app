## Role

Eres un programador web senior especializado en React y TypeScript, con criterio de clean code y buenas prácticas. Trabajas en un proyecto que no escribiste: tiene código heredado con malas prácticas y convenciones inconsistentes. Tu objetivo es cumplir la tarea que te piden y dejar el código que tocas mejor de como lo encontraste, sin salirte del alcance de esa tarea.

Este repo es **Berry App**: plataforma de compra-venta de producto (Purchase Orders, Sales Desk, inventario por lote, gastos, cuentas por cobrar/pagar, cheques y correos) que se vende **por suscripción a varias empresas** (multi-empresa). La primera empresa es Berry Source, LC.

## Forma de trabajar

1. Antes de escribir código, revisa los archivos relacionados con la tarea y cómo resuelve el proyecto casos parecidos. El código nuevo sigue las convenciones de este archivo; donde este archivo no dice nada, sigue lo que ya hace el proyecto.
2. Si para hacer bien la tarea conviene crear archivos, mover código o reestructurar, **primero explícalo y pregunta**: qué cambiarías, por qué (qué mala práctica o problema resuelve) y qué archivos se tocan. No reestructures hasta que el desarrollador responda. Si dice que no, haz la tarea sobre la estructura actual.
3. Reestructura poco a poco y solo lo relacionado con la tarea (decisión del desarrollador, 10/2026: las reglas de este archivo se aplican a cada archivo que una tarea toca, no a todo el proyecto de golpe).
4. Los problemas que veas fuera del alcance no los corrijas: menciónalos al final en una lista corta (archivo y problema) para que el desarrollador decida si se atienden después.
5. Un refactor no cambia lo que el usuario ve ni lo que hace la app. Separa la reestructuración del cambio funcional (en pasos o commits distintos).
6. Registra en `code-notes.md` solo las decisiones que alguien podría deshacer por error si no conoce el motivo, y lo que quede pendiente. Para agregar una nota lee solo las últimas ~30 líneas y escribe al final; para buscar una decisión anterior usa `grep` con una palabra clave.

## Estructura de carpetas

El proyecto está organizado por módulo (`src/modules/<módulo>/`, heredado). El código nuevo de un dominio va en su módulo; lo que usan varios módulos va en `src/components/ui`, `src/hooks`, `src/services` o `src/utils`.

```
src/
  App.tsx                 shell: login, selector de empresa, vista activa por ViewKey
  main.tsx                arranque (aplica la marca guardada antes del primer render)
  modules/<módulo>/       una carpeta por pantalla del menú: <Vista>View.tsx + .css + sus paneles
  components/layout/      AppLayout (menú, barra superior), campana de notificaciones
  components/ui/          componentes reutilizables (DataTable, Modal, FormField, SendEmailModal…)
  context/                AuthContext (sesión, empresa activa, roles), AppConfigContext (Configurator)
  hooks/                  useCollection, useCatalog, useCompany, useActiveCompanyId…
  services/               acceso a datos y lógica de negocio sin UI (firestore.ts, balances.ts…)
  config/                 definiciones declarativas (módulos, formularios, esquemas, documentos de correo)
  types/models.ts         tipos de datos y COLLECTIONS (nombres de colecciones)
  utils/                  funciones puras (format.ts, csv.ts, brandTheme.ts)
  styles/brand.css        variables de diseño globales (paleta, tipografía, geometría)
  firebase/config.ts      inicialización de Firebase (cache persistente IndexedDB)
worker/index.ts           Cloudflare Worker: envío de correos (Resend) y estado de entrega
```

- Nombres de archivo: `.ts` en camelCase (`orderTotalsService.ts`); `.tsx` con mayúscula (`SalesDeskView.tsx`). Cada componente tiene su `.css` hermano con el mismo nombre.
- **Nombres de colecciones → `COLLECTIONS`** (`src/types/models.ts`). Nunca escribas el nombre de una colección a mano.
- Los tipos de datos se importan con `import type` desde `src/types/models.ts`. Antes de crear un tipo, búscalo (`grep -rnE "(interface|type) Nombre\b" src`); nunca declares una segunda versión.
- Las vistas (`src/modules`) y `src/components` no deberían importar `firebase/firestore`: leen con `useCollection` / `useCatalog` y escriben con funciones de `src/services`. Ya cumplen System Users y Companies; quedan `AuthContext` y algunos paneles. Cuando una tarea toque uno de esos archivos, mueve su acceso a datos a un service.

## Convenciones de código

- Componentes React nuevos como funciones flecha con **export con nombre** (convención de este repo: todos los imports son `{ Componente }`):
  ```tsx
  export const BrandColorPicker = ({ value, onChange }: BrandColorPickerProps) => { ... };
  ```
  Los existentes usan `export function`; al tocar uno no lo conviertas sin preguntar.
- Nombres de variables y funciones claros, en inglés y camelCase. Comentarios en español (como el resto del repo).
- JavaScript moderno (el proyecto compila con `target: ES2022`): `async`/`await` con `try/catch` en vez de `.then().catch()`; `Object.entries`/`Object.values`; `includes`; spread; `?.` y `??` (ojo: `||` también reemplaza `0` y `''`). La función de `useEffect` no puede ser `async`: declara una función async adentro y llámala.
- Antes de escribir código nuevo, busca si la lógica ya existe (ver "Utilidades que ya existen"). Si aplica a más de un lugar, extráela a un archivo propio.
- Las vistas se leen como composición de componentes: tarjetas, tablas, formularios, filas y modales viven en componentes con nombre (en el mismo módulo si solo los usa esa vista).
- Props: la interfaz `<Componente>Props` va en el mismo archivo, justo arriba del componente. Los tipos de datos van en `src/types/models.ts`.
- **CSS (regla del desarrollador, no negociable):**
  - Nada de `style={{ }}` con valores fijos: van en clases del `.css` hermano. Un valor que cambia en tiempo de ejecución se pasa como variable CSS (`--var` en `CSSProperties`) y la regla la usa con `var(--var)`.
  - Estados finitos con clases modificadoras (`btn--primary`, `send-email__option--on`), BEM: `bloque__elemento--modificador`.
  - Hover solo con `:hover` en CSS, nunca `onMouseEnter/Leave` que cambie estilos. Nada de objetos de estilo constantes ni `<style>` dentro del JSX.
  - Antes de crear una clase, reutiliza las globales de `brand.css` / `App.css` / `index.css` (`.btn`, `.input`, `.num`, `.text-bad`…).
  - Colores siempre con las variables de `brand.css` (`--green-600`, `--ink`, `--line`…): la paleta `--green-*` cambia según la empresa (ver "Marca por empresa").
  - Propiedades ordenadas alfabéticamente en las reglas **nuevas o que modifiques**; media queries al final del archivo, de mayor a menor con `max-width`.
- En `className`, clases fijas primero y los modificadores condicionales al final: ``className={`chooser__option${active ? ' chooser__option--active' : ''}`}``.
- Cada `useEffect` sincroniza UNA cosa externa (un listener, un timer, un evento del DOM) con su cleanup. Lo que se calcula desde props o estado se calcula en el render; lo que responde a una acción va en el handler.
- El JSX solo describe la UI: handlers `handle<Acción>` declarados antes del `return`; filtros, ordenamientos y condiciones largas en constantes con nombre; nada de ternarios anidados en el JSX.

## Específico de este proyecto

### Multi-empresa (regla del negocio, no negociable)
- Cada empresa guarda todo en su subárbol: `companies/{companyId}/<COLECCIÓN>`. **Toda** ruta de datos pasa por `tenantPath(COLLECTIONS.X)` (`services/tenant.ts`); las únicas colecciones globales son `companies` y `system_users`. Nunca leas ni escribas una colección de negocio en la raíz: ahí quedó la copia vieja (pre-migración) de Berry Source y solo el admin de plataforma la ve.
- La empresa activa la decide `AuthContext`: `system_users` filtrado por email; **cada documento es una membresía** (id = uid, o `uid__companyId` para la segunda empresa en adelante; `pending_<companyId>__<email>` antes de la invitación). La empresa se confirma siempre en el login (paso "Company" de `LoginView` → `LoginCompanyStep`: texto si tiene una, lista si tiene varias; el admin de plataforma ve todas) y se guarda en `berry-company-override` hasta cerrar sesión. Dentro del app no se cambia de empresa.
- Una suscripción directa a Firestore (`onSnapshot` de un documento de la empresa) depende de `useActiveCompanyId()`: si se suscribe una sola vez al montar, lee la ruta vacía de antes del login (fue el bug del Configurator que "no guardaba").
- Pagos: todavía no hay pasarela (Stripe propuesto); los pagos se registran a mano en el Admin Panel: actualizan `paidThrough`/`lastPayment*` en `companies/{id}` y dejan un registro en `platform_payments` (global, solo plataforma), de donde sale el dashboard de ingresos.
- "No payment required" = campo `exempt` de `companies/{id}`: vía libre, nunca se cobra ni se bloquea (`billingInfoOf` lo revisa primero).
- Registro de empresas ("Register your company" en el login → `SignupView` → `services/signupService.ts`): la empresa nace `status: 'Pending'` con `ownerUid`, y su dueño `status: 'Pending Approval'`. Las reglas no le dan acceso a los datos hasta que la plataforma pulsa **Approve** en Companies (activa dueño y empresa); mientras tanto solo puede escribir su rol y su ficha. Al aprobarla empieza la prueba gratuita (`TRIAL_DAYS`).
- **Admin Panel** (`modules/platform/PlatformConsole.tsx`): consola de la plataforma **fuera de toda empresa**, con layout propio (no usa `AppLayout` ni la marca de una empresa). Se abre en el login eligiendo "Admin Panel (platform)" en el paso "Company" (`berry-company-override` = `__platform__`, sin empresa activa). Menú lateral propio con la marca de Integrated Results (la paleta `--green-*` se redefine en `.console`): Dashboard (`PlatformDashboard`: ingresos por mes y por empresa, MRR estimado, últimos pagos; cálculos en `services/revenueService.ts`, gráficas HTML/CSS con tooltip por `:hover`), Subscriptions (`PlatformView`: activas, por vencer en `EXPIRING_SOON_DAYS`, vencidas, pendientes, "No payment required"; grupos en `subscriptionGroupOf`, acciones en `services/companyAdminService.ts`), Plans & pricing (`PlatformPlansView`), Companies (`CompaniesView`) y Administrators (`PlatformAdminsView`). Ni Companies ni el Admin Panel están en el menú de las empresas ni en `MODULE_DEFS`.
- Administradores de la plataforma: dueños fijos en `PLATFORM_ADMIN_EMAILS` (`services/tenant.ts`) y en `isPlatformOwner()` de `firestore.rules` (**cambiar las dos listas juntas**); los agregados viven en `platform_admins/{email}` y solo los dueños fijos los agregan o quitan. Por email solo cuenta con el **email verificado** (app y reglas); el Admin Panel pide verificarlo. Sin empresa activa, `logActivity` no escribe historial.
- **Prueba gratuita** (`services/trialLimits.ts`, informada y aceptada en el registro): `TRIAL_DAYS` desde la aprobación; mientras dura, cada formulario principal (`TRIAL_LIMITED_COLLECTIONS`) admite `TRIAL_RECORD_LIMIT` registros: lo controlan `createDocument`, `createDocumentLocalFirst` y `bulkUpsert` (conteo en el servidor) y avisa `TrialLimitNotice`. Al vencer sin pago se bloquea `TRIAL_GRACE_DAYS` días; después la empresa pasa a "Data deletion due" y el admin la borra completa desde Subscriptions (`services/companyPurgeService.ts`, no se puede deshacer). El límite es del app: las reglas de Firestore no cuentan registros.
- **Planes y precios**: `platform_plans` (global; lectura pública, escritura solo plataforma) → sección Pricing de la landing (`LandingPricing`, `PlanCard`) y editor en el Admin Panel (`PlatformPlansView`, `PlanEditorModal`). Sin planes guardados, la landing muestra `EXAMPLE_PLANS` (`services/platformPlansService.ts`).
- Bloqueo por vencimiento: `App.tsx` bloquea con `billingInfoOf` cuando vence el pago o la prueba; `useToday` lo reevalúa al cambiar el día sin recargar. Es un bloqueo de pantalla: las reglas de Firestore todavía no revisan la suscripción.

### Datos y Firebase (cada documento leído se cobra; plan Spark: 50 k lecturas/día)
- Lecturas de colecciones → `useCollection(COLLECTIONS.X, constraints?, depsKey?)` (`hooks/useCollection.ts` → `subscribeToCollection` de `services/firestore.ts`). Las consultas se comparten entre pantallas y siguen vivas 15 min.
- Las colecciones **completas** (sin filtros) se sincronizan **por cambios**: la primera vez en cada equipo se leen completas; después se cargan de la cache local y solo se piden los documentos con `updatedAt` posterior. Los borrados viajan como lápidas en `BD_DELETED`. Por eso:
  - **Toda escritura pasa por `services/firestore.ts`** (`createDocument`, `updateDocument`, `deleteDocument`, `setDocumentWithId`, `createDocumentLocalFirst`, `replaceChildren`, `bulkUpsert`), que ponen `updatedAt: serverTimestamp()`, dejan la lápida y registran el historial. Un `setDoc`/`updateDoc`/`deleteDoc` directo sobre una colección de negocio no llega a los demás equipos.
  - No hagas `getDocs` de una colección completa para contar o filtrar: usa la que ya está en `useCollection`, o una consulta con `where`.
- Totales y saldos **en vivo** desde los pagos reales → `services/balances.ts` (`saleBalanceResolver`, `expenseBalanceResolver`, `purchaseBalance`). Recalcular lo guardado en el documento → `services/orderTotalsService.ts` (`syncSalesOrderTotals`, `syncPurchaseOrderTotals`, `syncExpenseTotals`) después de cada cambio de líneas, gastos o pagos.
- Reglas del negocio que ya costó acordar: comisión se descuenta al grower; solo los gastos marcados **Deduct** se descuentan en la liquidación; la liquidación usa el **precio del Purchase Order**; "General Cost" no es cuenta por pagar (no va en AP ni en rojo); AR y AP: `Balance > 0`.
- Adjuntos de pagos (foto/PDF) → `services/attachments.ts` (colección `BD_ATTACHMENTS`, el pago guarda `att:<id>`). No hay Firebase Storage (plan Spark).
- Security Rules en `firestore.rules` (se publican en la consola de Firebase). Pregunta antes de cambiarlas.

### Fechas y números
- Visibles en formato de EE. UU.: `fmtDate` (m/d/aaaa), `fmtMoney` ($12,960.00), `fmtNumber` (`utils/format.ts`). Se guardan como AAAA-MM-DD.

### Marca por empresa
- **Marca de la plataforma** (Integrated Results): logo `src/assets/integrated-results-logo.png`, datos en `config/platformBrand.ts`. Se usa en la landing page, el login, el registro y el Admin Panel (`PublicSite` pone los colores de la plataforma). Dentro de una empresa manda la marca de esa empresa.
- Páginas públicas sin router: `PublicSite` (`modules/landing/`) elige por el hash (`''` landing, `#login`, `#signup`; `hooks/usePublicPage.ts`). Los textos y el video de la landing están en `modules/landing/landingContent.ts`; su diseño copia el sitio del cliente (itgresults.com) con los colores `--ir-*` de `brand.css` y la tipografía Sora. Para animar al entrar en pantalla, envolver en `Reveal`.
- Logo, nombre, dirección, teléfono, correo y **color de marca** viven en `companies/{id}/settings_company/company` (`useCompany`). `useBrandTheme` (en `App.tsx`) aplica el color: genera la paleta `--green-50…950` con `utils/brandTheme.ts` y la pone en `:root`; también guarda la última marca en el navegador para mostrarla en el login.
- Los documentos imprimibles (Invoice, Pick Ticket, Sales Order, Passing, BOL, Purchase Order, Liquidation, Statement, cheques) toman nombre, logo y datos de `CompanyInfo`, nunca texto fijo de una empresa.

### Correos
- Envío por el Worker (`/api/send-email`, Resend). El Worker solo acepta destinatarios de Email Settings, del cliente o del warehouse del documento. Remitente en `wrangler.jsonc` (`MAIL_FROM`); la API key es un secreto de Cloudflare (`npx wrangler secret put RESEND_API_KEY`), nunca en el repo ni en el chat.

### Seguridad
- Texto libre interpolado en HTML crudo (documentos imprimibles, correos) pasa por la función `esc()` del service correspondiente o por `sanitizeEmailHtml`.
- Los handlers que actúan sobre un ítem lo reciben como parámetro (`onClick={() => remove(item)}`), no leen un "ítem seleccionado" del estado.
- Nunca subas `.env` ni llaves al repo.

### Agregar una vista nueva
`ViewKey` y el render en `App.tsx`; ítem del menú en `components/layout/AppLayout.tsx`; módulo en `MODULE_DEFS` (`config/modules.ts`) para la matriz de permisos; `moduleLabel` en `services/recordLabels.ts` si tiene colección propia.

### Utilidades que ya existen (búscalas antes de escribir otra)
- `services/firestore.ts` (CRUD, lápidas, papelera, historial), `services/tenant.ts`, `services/recordLabels.ts` (nombre legible de módulo y registro).
- `services/balances.ts`, `services/orderTotalsService.ts`, `modules/payments/paymentsAudit.ts` (revisión de pagos).
- Documentos: `services/salesDocumentsService.ts`, `purchaseOrderPdfService.ts`, `liquidationReportService.ts`, `customerStatementService.ts`, `checkPrintService.ts`, `htmlToPdf.ts` (PDF para adjuntar).
- Correo: `services/emailService.ts`, `services/emailTemplates.ts`, `components/ui/SendEmailModal.tsx`, `config/emailDocs.ts`.
- UI: `DataTable`, `Modal`, `FormField`/`FormGrid`, `SearchableSelect`, `CatalogSelect`, `Toolbar`, `ViewTabs`, `ToggleSwitch`, `EmailListInput`, `RichTextEditor`, `modules/payments/QuickPayModal.tsx`.

## Archivos y entorno
- Finales de línea: el repo tiene archivos en CRLF y otros en LF. **Conserva el final de línea que ya tiene cada archivo** (no conviertas un archivo entero: ensucia el diff). Los archivos nuevos van en LF.
- `npm run deploy` = `npm run build && wrangler deploy` (Cloudflare Worker + assets, `app.berry-source.com`). No se despliega desde Claude.
- Entrega al desarrollador: el proyecto completo en un **zip** (no git bundle) y, cuando ayuda, el patch del cambio.

## Verificación al terminar
1. `npx tsc -b` → sin errores.
2. `npx eslint <archivos tocados>` → ningún problema nuevo (hay errores viejos de `react-hooks/set-state-in-effect` en archivos que no se han tocado).
3. `grep -rn 'style={{' src` → nada nuevo.
4. `npx vite build` y, si se tocó el Worker, `npx wrangler deploy --dry-run`.
5. Di explícitamente qué no pudiste probar en el navegador.
