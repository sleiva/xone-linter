# xone-linter

Validador y simulador ligero de aplicaciones XOne, pensado para agentes autónomos
que generan o modifican proyectos XOne sin necesidad de un simulador iOS. Publica
el binario `xone-simulator` con comandos `validate`, `smoke`, `run` y `render`.

## Alcance actual

### Fase 1 — Validador estático

- XML bien formado y encoding correcto (`iso-8859-15` en `.xne`).
- Atributos obligatorios (`progid`, `name`, `type`, `id`, ...).
- Unicidad de nombres dentro de una colección.
- Tipos de propiedad válidos.
- `progid` correcto.
- Ficheros incluidos y estilos existen.
- Sintaxis JavaScript válida (subconjunto XOne).
- Referencias cruzadas (`mapcol`, `inherits`, `contents`, `openEditView`).
- Anti-patrones documentados de XOne.

### Fase 2 — Ejecutor headless de scripts JS

- Motor `node:vm` (sin dependencias nativas).
- Objetos runtime simulados: `self`, `selfDataColl`, `appData`, `ui`, `$http`, `crypto`, `deviceInfo`, `systemSettings`, `console`, `createObject`.
- Ejecución de eventos a nivel de coll (`before-edit`, `create`, `onback`) y eventos inline de props (`onclick`, `onchange`).
- Registro de side-effects (`RuntimeLog`): navegación, mensajes, refrescos, HTTP, cambios de datos, etc.
- API y CLI para ejecutar eventos y obtener estado + log.

### Fase 3 — Estado de UI abstracto ✅

- Árbol UI por pantalla: `coll` > `group` > `frame` > `prop`.
- Stack de ventanas navegable (`ViewStack`).
- `runtime.getCurrentView()` y `runtime.renderCurrentView()`.
- `runtime.simulateTap(coll, prop)` y `runtime.simulateChange(coll, prop, value)`.
- Refleja visibilidad, editabilidad y valores actuales del `DataObject`.

### Fase 4 — Persistencia SQLite ✅

- Soporte nativo de SQLite vía `better-sqlite3` (dependencia opcional).
- Fallback en memoria cuando `better-sqlite3` no está disponible.
- `PersistenceManager` crea tablas automáticamente desde las colecciones XOne.
- `self.save()` inserta/actualiza filas reales y devuelve el `ID` autogenerado.
- `SqlManager`, `appData.executeSql()` y `selfDataColl` usan la misma conexión.
- Los datos persisten entre ejecuciones si se indica `--db-path <fichero.db>`.

## Instalación

### Desde npm (recomendado)

```bash
npm install -g xone-linter
```

### Desde el código

```bash
npm install
npm run build
```

## Uso

### CLI

```bash
# Validar una app XOne
npm run validate -- /Users/projects/project2026/xone_app/AITest

# Salida JSON para consumo automatizado por agentes
node ./dist/cli.js validate /Users/projects/project2026/xone_app/AITest --json

# Ejecutar un evento XOne (headless)
node ./dist/cli.js run /Users/projects/project2026/xone_app/AITest \
  --coll EntradaApp --event before-edit

# Ejecutar onclick de un botón con datos iniciales y salida JSON
node ./dist/cli.js run /ruta/a/tu/app/XOne \
  --coll EntradaApp --event onclick --prop MAP_BT_CLIENTES \
  --data '{"MAP_TITULO":"Hola"}' --json

# Ejecutar con persistencia SQLite real (los datos se guardan en el .db)
node ./dist/cli.js run /ruta/a/tu/app/XOne \
  --coll Clientes --event onclick --prop MAP_BT_GUARDAR \
  --data '{"NOMBRE":"Acme","ACTIVO":1}' \
  --db-path ./data/gestion.db

# Smoke-run de la app completa (todas las colls, lifecycle) — salida JSON para agentes
node ./dist/cli.js smoke /Users/projects/project2026/xone_app/AITest --json
```

### Smoke-run de app completa

`smoke` es el comando para que un **agente** obtenga, en una sola llamada, feedback
consolidado de **toda** la app tras cambiar código XOne — sin cablear coll por coll ni
diseñar un recorrido manual. Dispara el ciclo de vida (`create`/`before-edit`/
`after-edit`) + render con flow de cada coll (o del subconjunto de `--coll`); con
`--interact` además tapea los props con `onclick`/`method=ExecuteNode(...)` (máx.
`--max-taps`, default 20). Una coll rota no aborta el resto: cada fallo queda en el
informe con su **fase** y **stack truncado**.

```bash
# Resumen coloreado (totals + colls fallidas + primeros 3 errores por coll, con fase)
node ./dist/cli.js smoke /Users/projects/project2026/xone_app/AliviaApp

# JSON completo (SmokeReport), para consumo automatizado por agentes
node ./dist/cli.js smoke /Users/projects/project2026/xone_app/AliviaApp --json

# Solo una coll, con interacción (tapea onclick/method)
node ./dist/cli.js smoke /Users/projects/project2026/xone_app/AliviaApp --interact --coll Home --max-taps 5
```

Exit code **1** si `failures.length > 0` (encadenable en CI/hooks de agente). Entorno
siempre seguro: el runtime interno es `network:'mock'` e in-memory (sin `dbPath`), nunca
toca red ni SQLite reales. Los globals/singletons documentados (`user`, `err`, `replica`,
`wifiManager`, etc. — fase 53/F10) y objetos como `ui.getView(x)` están envueltos en
autostub: una API real invocada de verdad no revienta el script, pero un método NO
implementado tampoco falla — aparece en `warnings` con `kind: 'stub-method'` (agregado en
`totals.stubWarnings`) en vez de como error. Una coll con `failed:0` puede tener
`stubWarnings > 0`: pasó el smoke, pero algún método invocado no está implementado de
verdad (fue absorbido por el stub genérico) — útil para priorizar qué cubrir a
continuación sin que bloquee el resultado binario passed/failed. También disponible en
proceso vía la API de agente:

```typescript
const sim = await XoneSimulator.load('/ruta/a/tu/app/XOne', { network: 'mock' });
const report = await sim.smoke();      // SmokeReport; no toca la sesión interactiva de sim
console.log(report.totals, report.failures);
sim.close();
```

### API

```typescript
import { XoneProject, Validator, XoneRuntime } from 'xone-linter';

const project = await XoneProject.load('/Users/projects/project2026/xone_app/AITest');

// Validación
const validation = new Validator().validate(project.model);
console.log(validation.errors);

// Ejecución headless
const runtime = new XoneRuntime(project.model);
const result = await runtime.runEvent({
  collName: 'EntradaApp',
  eventName: 'before-edit',
  initialData: { MAP_TITULO: '' },
});

console.log(result.context.self.MAP_TITULO); // valor tras la ejecución
console.log(runtime.log.all);               // side-effects registrados

// UI abstracta
const view = runtime.getCurrentView();      // árbol JSON de la pantalla
console.log(runtime.renderCurrentView());     // representación textual

// Simular interacciones
await runtime.simulateTap('EntradaApp', 'MAP_BT_CLIENTES');
await runtime.simulateChange('Clientes', 'NOMBRE', 'Acme');

// Persistencia SQLite real
const runtime2 = new XoneRuntime(project.model, undefined, { dbPath: './data/gestion.db' });
await runtime2.runEvent({
  collName: 'Clientes',
  eventName: 'onclick',
  propName: 'MAP_BT_GUARDAR',
  initialData: { NOMBRE: 'Acme', ACTIVO: 1 },
});
// El ID autogenerado y los datos quedan guardados en ./data/gestion.db
runtime2.close();
```

### API de agente — `XoneSimulator` (recomendada)

`XoneSimulator` es un **facade nativo en proceso** pensado para que un **agente** (harness
TS/Node) abra y opere una app XOne sin cablear `XoneProject`/`XoneRuntime`/`Validator` a mano y
sin servidor (no es MCP ni stdio). Cada acción devuelve un **`SimResult`** con los campos que el
LLM necesita ver.

```typescript
import { XoneSimulator } from 'xone-linter';

// 1) Abrir la app: carga + runtime + vista de entrada lista (network:'mock' = sin red real)
const sim = await XoneSimulator.load('/ruta/a/tu/app/XOne', { network: 'mock' });

// 2) (Opcional) validar antes de operar
const v = await sim.validate();          // { pass, errors, warnings, issues }
if (!v.pass) console.warn('Validación:', v.issues);

// 3) Estado inicial para el LLM
let r = sim.view();
//   r.html   → render HTML de la pantalla (para que el LLM juzgue el diseño)
//   r.render → la misma pantalla en texto
//   r.view   → árbol compacto { collName, title, controls: [{name,type,value,visible,editable}] }
//   r.log    → side-effects desde la última acción (vacío al abrir)

// 4) El agente decide una acción; el SimResult devuelto es legible por el LLM
r = await sim.tap('EntradaApp', 'MAP_BT_CLIENTES');   // pulsar un botón (onclick)
//   r.success → ¿ok?   r.error → mensaje si falló (no lanza)
//   r.log     → p.ej. [{ type: 'navigate', description: '...' }]
//   r.html    → la pantalla resultante, para el siguiente turno del LLM

r = await sim.set('Clientes', 'NOMBRE', 'Acme');      // escribir en un campo (onchange)
r = await sim.run('Clientes', 'before-edit');         // disparar un evento de ciclo de vida
r = sim.enter('Clientes');                            // navegar a otra coll

// 5) Datos / escape hatch
const clientes = sim.getCollection('Clientes');       // DataCollection (consultas)
sim.render('Clientes', { flow: true });               // html crudo de una coll concreta
// sim.runtime / sim.model                            // acceso de bajo nivel si hace falta

sim.close();   // libera SQLite/ficheros temporales (idempotente)
```

**`SimResult`** (lo que devuelven `view`/`enter`/`run`/`tap`/`set`/`push`):

| Campo     | Tipo                | Para qué |
|-----------|---------------------|----------|
| `success` | `boolean`           | si la acción fue OK (errores de lógica → `false`, no lanza) |
| `error`   | `string?`           | mensaje de error si lo hubo |
| `html`    | `string`            | render HTML de la pantalla (juicio de diseño del LLM) |
| `render`  | `string`            | la pantalla en texto |
| `view`    | `CompactView\|null` | árbol jerárquico: grupos (page/fixed/drawer, con página activa y drawers abiertos) → frames anidados → controles visibles |
| `log`     | `CompactLogEntry[]` | side-effects de **esa** acción: `navigate`/`message`/`dataChange`/`http`/`warning`/`error` |

Métodos: `static load(appPath, { dbPath?, network?, filesPath? })`, `validate()`, `view()`,
`enter(coll)`, `render(coll?, { flow? })`, `run(coll, event, { prop?, data?, params? })`,
`tap(coll, prop)`, `set(coll, prop, value)`, `push(payload, coll?)`, `getCollection(name)`,
`log`, `runtime`/`model` (escape hatch), `close()`. Las acciones limpian el log antes de
ejecutarse, así que `log` refleja solo esa acción. Internamente reutiliza el runtime calibrado
contra el simulador iOS (render fiel: orden documental, tabs/páginas, fechas, colores,
imágenes, visibilidad/editabilidad condicional).

## Estructura

```
src/
├── project/    # Carga de proyectos XOne
├── xml/        # Parser XML y AST
├── model/      # Modelo de dominio XOne
├── validator/  # Reglas de validación
├── runtime/    # Simulación de runtime (fases 2-4)
│   └── persistence/  # SQLite e in-memory DB
└── vm/         # Adaptadores de ejecución JS
```

## Roadmap

**Fases 1-55 completadas** (564/564 tests verdes en 75 suites). Resumen:

- **1-4** — Validador estático · ejecutor headless de scripts JS · UI abstracta y
  navegación · SQLite y persistencia real.
- **5-10** — Cobertura de APIs XOne + auto-stub · tools LangChain vía REPL · motor de
  consulta `DataCollection` (SQLite/JSON) · `FileManager` + transacciones · `$http` fiel
  (mock + red real) · stubs de dispositivo (GPS/cámara/push).
- **11-26** — Render HTML de la coll para juicio de diseño del LLM, con flujo y macros,
  calibrado contra el simulador iOS (visibilidad/editabilidad condicional, colores,
  `newline`, listas `Z` maestro-detalle, `imgbk`/imágenes, orden documental, fechas,
  tabs/páginas).
- **27-41** — `XoneSimulator` (clase nativa de agente) · `executeNode`/nodos custom ·
  `onfocus` y tab activo de grupo · paginación fiel + `notab` · drawers
  (`drawer-orientation`) + `ui.showGroup`/`hideGroup` · `CompactView` jerárquico
  (grupos/páginas/drawers + frames anidados) · siembra de datos (`mock/<coll>.json` +
  `XoneSimulator.seed`) para listas/menús data-driven · regresión automatizada contra apps
  reales (smoke + snapshot de validate por issue + snapshot de render del `<body>`, sin y
  con flow) ·
  validador más profundo: handlers a funciones/nodos inexistentes (`HandlerReferenceRule`)
  + refs de campo `mapfld`/`linkedfield` contra la coll del `mapcol`.
- **43** — Fidelidad estructural del render (fase 1 de
  `2026-07-13-fidelidad-app-completa-design.md`): escala de longitudes `p` por
  `resolution-width` de la app, filas `newline="false"` sin `gap` (anchos suman 100%) y
  `align="h|v"` con componente vertical real (flex).
- **44** — F3: control llena su caja (fase 2 del mismo spec, a partir del catálogo de gaps
  `2026-07-13-f2-catalogo-gaps-fidelidad.md`): botones/inputs heredan la caja de su
  `<div class="xone-prop">` (BASE_CSS), campos multilínea (`lines`/`fixed-lines`) como
  `<textarea rows=N>`, botón sin `title` ya no pinta el `name` interno y `body{font-size:17px}`
  como default tipográfico.
- **45** — F4: viewport de altura y `%` verticales (fase 3 del mismo spec): `.xone-coll` gana
  `height:RENDER_HEIGHT` (420×`resolution-height`/`resolution-width`, default 892px) +
  `display:flex;flex-direction:column`, y cada racha de páginas se envuelve en un
  `<div class="xone-viewport">` con scroll interno (`overflow-y:auto`) para que `height:%`
  resuelva contra un padre real hasta grupo/tabs/frames directos (el nivel fila/prop sigue
  colapsando → G2-bis del catálogo); márgenes/longitudes `p` negativos ya escalan en vez de
  perderse (solo `-1`/`-2` quedan como sentinelas de herencia); el ×scale de `fontsize` de F3
  se revierte (el device no encoge tipografía con la resolución); y el checkbox gana
  `align-self:flex-start` para no estirarse al ancho del wrapper.
- **46** — F5: toolbar fiel (fase 4 del mismo spec, cierra **G3** del catálogo): el `<h1>`
  sintético se condiciona a `show-toolbar` con precedencia atributo de la coll > `coll{}`
  del CSS del proyecto > default (visible; solo el literal `"false"` lo apaga), y con la
  barra visible `toolbar-bgcolor`/`toolbar-forecolor` (misma precedencia) sustituyen el azul
  fijo `#1565C0` vía `xoneColorToCss`.
- **47** — Smoke-run agregado de app completa: motor `runSmoke` (lifecycle de todas las colls
  + `interact` opt-in, fase+stack por fallo, sin abortar el resto) expuesto como
  `sim.smoke()` en la API de agente y comando `smoke` en la CLI; regresión por app
  (`{failures, totals}` snapshot) contra las 4 apps reales del repo.
- **48** — Superficie Python/LangGraph completa (corte P): 6 métodos REPL nuevos
  (`render`/`seed`/`enter`/`focusGroup`/`push`/`smoke`, este último reexpone el motor de
  la fase 47 sin sesión) + `XoneSimClient.request(..., timeout=None)` por-request (necesario
  para el timeout largo de `smoke`) + 6 tools LangChain nuevas en `clients/python/`
  (`xone_render_html`, `xone_seed`, `xone_enter`, `xone_focus_group`, `xone_push`,
  `xone_smoke`) — el cliente Python pasa de **7 a 13 tools** (ver
  `clients/python/README.md`).
- **49** — F6: labels en línea por `labelwidth` (fase 5 del mismo spec, cierra **G5** del
  catálogo): el título del campo pasa de bloque-encima a `<label style="width:Nch">` en
  línea a la izquierda (default 10ch; `labelwidth="0"`/`title` vacío → sin etiqueta;
  excluido el tipo `B`, cuyo `title` es el texto del botón), `tooltip`/`caption` se
  convierten en `placeholder` de inputs/textarea de texto, y el `align` horizontal de un
  frame/grupo **contenedor** ahora posiciona también a sus hijos
  (`display:flex;flex-direction:column;align-items:…`), no solo su propio texto.
- **50** — F7: cadena de altura nivel 2 (fase 6 del mismo spec, cierra **G2-bis** del
  catálogo): la fila de un solo hijo se vuelve transparente al layout
  (`.xone-row:has(> :only-child){display:contents}`, CSS puro) para que `height:%` de su
  hijo resuelva contra el frame/section; la fila multi-hijo (tiles) gana
  `style="height:{max%}"` con cada hijo re-escalado a `{hijo/max*100}%`; los hijos fijos
  del coll ganan `flex-shrink:0` y el estilo inline del coll gana `overflow:hidden`
  (clipping como el device). Verificado con `getBoundingClientRect` que la cadena `%`
  fila/frame resuelve al píxel correcto de punta a punta; el onboarding de AliviaApp
  mejora (textarea/botón con dimensiones reales) pero sigue sin mostrar la foto de fondo
  ni el bloque superior por **G2-ter** (nuevo, causa distinta: `margin-top:%` se resuelve
  por spec CSS contra el ancho del contenedor, no la altura, y el `<img>` de fondo declara
  `xheight` — atributo con prefijo `x` = inactivo en XOne — sin `height` real aplicado),
  candidato a un corte futuro.
- **51** — F8: `elevation`→`box-shadow` Material escalado (cierra **G11**, reportado por el
  usuario sobre LoginColl: cards/inputs/logo sin sombra) + resolución de rutas de imagen
  contra el árbol real de la app (cierra **G8**: `imageIndex` basename→ruta indexado en
  `XoneProject.load`, `resolveImg` roscado por `imgbk`/IMG·PH `path`/valor/botón `img`, orden
  determinista ante basenames duplicados entre carpetas — p. ej. `basicos.png` en
  `files/`/`icons/` de MyAllXOne). Evidencia: AliviaApp gana la foto del onboarding
  (`sliderImg1.png`/`slide1.png`, vía `<img src>`); LoginColl gana las sombras bajo
  cards/inputs/logo Y el fondo fotográfico: el hallazgo de las comillas (`url("…")` anidaba
  dobles dentro de `style="…"` y el navegador truncaba el atributo entero, bug latente
  desde la fase 20) se diagnosticó con `--dump-dom` y se **corrigió en este mismo corte**
  (`url('…')`) — LoginColl ya pinta `FondoLogin.png` con la card translúcida encima.
- **52** — F9: márgenes `%` verticales (`tmargin`/`bmargin`) resueltos en px contra la
  ALTURA real del padre, fiel al oráculo `EditPropertyControl.mm:3504` (`TopMargin`:
  `'%' → getParentHeight(superview)·pct/100`) — cierra la causa **(a)** de **G2-ter** — y
  IMG/PH con `scale-type="center_crop"|"fit_xy"` sin `height` real activo ganan
  `object-fit:cover|fill` + wrapper `height:100%` (gate endurecido vía `xoneLengthToCss`:
  `height="-1"`/inválido cuentan como inactivo) — cierra la causa **(b)**. Evidencia
  `ts9-AliviaApp-EntradaApp.png` (comparada contra `ios-AliviaApp-EntradaApp.png`): la
  paginación y el botón "Saltar" ya viven en la franja superior como el device (antes
  desplazados ~321px fuera del viewport) y la foto de fondo es full-bleed recortada por
  aspecto en vez de colapsar a su tamaño intrínseco — el objetivo visual central de **G2**
  queda cerrado (ya no hay pantallas en blanco). Residuos honestos sin cerrar: el texto del
  slide no se pinta (candidato a un corte futuro de cobertura de flow/API) y el residuo de
  **fila mixta** (causa **(c)** de G2-ter, heredada de G2-bis) sigue abierto.
- **53** — F10: cobertura de API del sandbox — globals `user` (Proxy sobre
  `appData.getCurrentUser()`, memoizado; divergencia doc anotada: la doc dice `null` sin
  login-coll, el sandbox da un objeto con heurística de campo/método) + `err`/`error`
  simplificados + 19 singletons (`replica`/`clipboard`/`packageManager`/
  `biometricsManager`/`fingerprintManager`/`bleManager`/`sensorManager`/`paymentManager`/
  `appBroadcastManager`/`live`/`smsService`/`serial`/`bluetoothSerial`/`bleSerial`/`ml`/`ai`/
  `wifiManager`/`efiDiagItv`/`push`) vía `withAutoStub`; `ui.getView(x)` con `refresh(...)`
  real y cualquier otro método → stub (antes `TypeError`); `self.getContents(name).count()`
  resuelve el `<contents>` real (antes coll vacía); `DataCollection.setVariables/getVariables`
  (plural, firma real de las apps) y `self.ownerCollection`/`self.getVariables` como
  miembros reales del dataobject (patrón `LoginColl`). Smoke de regresión: AliviaApp 12→11
  y MyAllXOne 6→1 failures (colls recuperadas por `user`/singleton/autostub-de-vista/
  `getContents.count`/`ownerCollection` — ver `docs/roadmap/2026-06-13-estado-general.md`
  fase 53 para el detalle por coll). Extensión del mismo corte: `EventExecutor` expone
  constructores creables `new X()` (`FileManager`, `GpsTools`, `SqlManager`, `WifiManager`,
  `Animation`, `Worker`, `Socket`/`WebSocket`, etc. — doc §5) delegando en la factory
  `createObject` ya existente — cierra el residuo: el titular de AliviaApp ("Recupera el
  control de tu vida financiera") **SE VE** ya en el render (antes `new FileManager()` sin
  exponer abortaba el `<create>` antes de asignarlo); AliviaApp 11→10 failures (`EntradaApp`
  recuperada). Fix del residuo: `createObject` (`src/runtime/objects/createObject.ts`) ahora
  envuelve TODO objeto que construye con `withAutoStub` (incluida la instancia con estado de
  `FileManager`) en vez de devolver literales crudos — `MenuWifiManager.xne` (MyAllXOne) hace
  `createObject("WifiManager").isWifiAdapterEnabled()`, método ausente del literal
  `{connect,disconnect}` que antes lanzaba `TypeError`; **MyAllXOne 1→0 failures (98/98)**.
- **54** — F11: máquina JS persistente **por app** en vez de sandbox nuevo por evento. `VmSession`
  en `VmAdapter`/`NodeVmAdapter` (`createSession` + `execute({wrap})` + `dispose`, sobre
  `node:vm` `runInContext`): los includes de `app.xml` (orden real vía `orderedJsFiles`) se
  cargan **una sola vez** por runtime con `wrap:false` (sus `var`/`function` top-level
  persisten, filename real en los stacks); las `var` top-level de un script de EVENTO siguen
  locales vía el wrapper IIFE (`wrap:true`), fiel a la doc topic 03a §1.5-1.7. `EventExecutor`
  se cachea por runtime (`XoneRuntime.defaultExecutor`) con `beginEvent()` llamado en cada
  entry-point TOP-LEVEL (`runEvent`, `prepareView` por cada evento del ciclo create/before-edit/
  after-edit, `focusGroup`) para que `err`/`error` sigan siendo per-evento aunque el executor ya
  no se reconstruya por evento; `pushMessage` pasa de valor fijo a **provider** (`() => unknown`,
  se lee por ejecución). Decisión de simulador: un include que lanza al cargar se loguea como
  `js-error` con su filename y **se continúa** con el resto de includes/colls (el device real
  abortaría el arranque entero; aquí se prioriza que el resto de la app siga explorable por el
  agente). El smoke (`sim.smoke()`/CLI `smoke`) procesa el **entry-point primero** (boot fiel al
  device: su `<create>` corre `startApp()`/equivalente y fija el estado global de sesión antes de
  que el resto de colls lo necesite). Resultado: **AliviaApp 34/44 → 44/44** en el smoke — las 10
  colls que fallaban leían `apponlineconfig`/`.url` (`online.js`/`authFunctions.js`), estado que
  antes de F11 no sobrevivía entre `runEvent`/`prepareView` distintos del mismo runtime y que
  ahora `startApp()` (disparado por el `<create>` de `EntradaApp`, que corre primero gracias al
  boot del smoke) deja fijado para el resto de la app. Nota de fidelidad: como efecto colateral
  esperado de que la máquina JS ya sea persistente por app, una asignación GLOBAL sin `var` hecha
  desde un script de evento ahora persiste toda la sesión (antes se perdía al reconstruirse el
  sandbox en el siguiente evento) — más fiel al comportamiento real del device. Suite 536→559
  (559/559 en 75 suites; Tasks 1-6). Fix post-review-final del mismo corte (Fix 2, ver
  `docs/roadmap/2026-06-13-estado-general.md` fase 54): `ensureSession()` fijaba
  `sessionReady = true` antes de invocar `vm.createSession(...)` — un adaptador que lanzara ahí
  dejaba `session=undefined` para siempre de forma silenciosa (caída al modo legacy sin log);
  ahora corre en `try/catch` y el `catch` deja un `warning` explícito. Suite final 536→560
  (560/560 en 75 suites).
- **55** — F12: fila mixta — cierra **G2-ter causa (c)** (heredada de G2-bis/F7): la fila
  multi-hijo dejaba de medir a sus hijos SIN `%` (fijos/auto) al calcular `row=max%` (solo
  entre los hijos con `%`), pudiendo desbordarse y solaparse con el siguiente elemento — el
  device (oráculo `EditPageRow.mm:275`) mide la fila por el máximo de TODOS los hijos. Con
  `parentPx` trazado (el mismo de F9), cada hijo `%` se convierte a **px absoluto**
  (`resolveHeightPx(pct, parentPx, scale)`) y la fila pasa a **auto** (sin `height` propio),
  dejando que el motor de caja mida el máximo real; sin `parentPx`, fallback F7 intacto
  byte-a-byte. Evidencia `ts12-AliviaApp-EntradaApp.png` (overlay `getBoundingClientRect`
  ad-hoc): la fila "Saltar" mide `47px` (máximo real entre botón `39+8margin=47` e imagen
  `5.95+8margin=13.95`) — gate cumplido: `47px ≥ 5.95px` (altura de fila ≥ imagen por
  aspecto) y sin solape con el título siguiente (`bottom=127.95px ≤ top=567.86px`). Las
  otras 3 apps regeneradas (`ts12-{FontIconsApp,AITest,MyAllXOne}-*.png`, lección F6/F7 de
  no saltarse ninguna): `AITest`/`MyAllXOne` byte-idénticas a la evidencia previa;
  `FontIconsApp` con los tiles en la MISMA altura (`126px`). Hallazgo colateral honesto, NO
  bloqueante (candidato a un corte futuro, ver catálogo): el mismo fix hace que la fila-auto
  de FontIconsApp incluya el `margin-top` de sus hijos en la altura total apilada, lo
  bastante para que la fila "Salida IA" quede fuera de la caja de la coll
  (`overflow:hidden`) — los tiles individuales no cambian. Suite 560→564 (564/564 en 75
  suites; Tasks 1-2).

Estado detallado, decisiones y líneas de trabajo abiertas (validador más profundo,
regresión automatizada con apps reales, fidelidad de UI diferida, etc.) en
**`docs/roadmap/2026-06-13-estado-general.md`** (fuente autoritativa).
