/**
 * Tipos de propiedad válidos en XOne.
 *
 * LA FUENTE es la tabla completa de `xone-help-docs`
 * (`topics/02-xml-ui-complete-guide.md`), que es la que el resto de su documentación señala
 * como «la tabla completa de tipos y sus variantes», más lo confirmado por el equipo de XOne.
 *
 * **Y esta lista estaba corta, con consecuencias.** Le faltaban ONCE tipos —`C`, `M`, `A`,
 * `F`, `S`, `P`, `E`, `R`, `H`, `CAM` y `N1`— así que `INVALID_PROP_TYPE` marcaba como error
 * un `<prop type="C" mapcol="Empresas" mapfld="ID">` que es exactamente el ejemplo que la
 * documentación pone para un combo. La causa está en otra skill: `xone-development` afirma en
 * `references/tipos-de-prop.md` que esos once «no existen», y de ahí salió la lista. Los
 * niega la skill de ayuda en dos documentos y los desmiente el equipo.
 *
 * **La dirección del error importa en una lista que va a decidir si se ESCRIBE un fichero.**
 * Un tipo válido que falte aquí rechaza una escritura correcta: cuesta trabajo perdido y
 * confianza. Un tipo inválido que sobre solo deja pasar un error que otro sensor puede coger
 * después. Así que ante la duda, entra.
 */
export const VALID_PROP_TYPES = new Set([
  'T',      // texto editable
  'TN', 'TN2', 'TN3', 'TN4', 'TN5', 'TN6', // texto numérico
  'N', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', // número
  'F',      // decimal / flotante (con `mask`)
  'D',      // fecha
  'DT',     // fecha y hora
  'TT',     // hora
  'B',      // botón
  'L',      // label
  'TL',     // label de solo lectura
  'NC',     // checkbox/toggle/radio/switch
  'R',      // radio
  'S',      // slider
  'P',      // barra de progreso
  'X',      // password
  'E',      // email
  'C',      // combo (desplegable; va con `mapcol` y `mapfld`)
  'A',      // autocompletado
  'IMG',    // imagen
  'PH',     // foto
  'VD',     // video / escáner QR
  'CAM',    // cámara directa
  'DR',     // dibujo/firma
  'M',      // mapa
  'WEB',    // webview
  'H',      // HTML renderizado
  'AT',     // adjunto
  'O',      // sub-objeto JS (no persiste)
  'THTML',  // texto HTML
  'Z',      // contenedor de lista embebida
]);

// Valores permitidos de progid según la documentación.
export const PROGID_EMPRESA = 'ASGestion.CASEmpresa';
export const PROGID_USUARIO = 'ASGestion.CASUser';
export const PROGID_GENERIC = 'ASData.CASBasicDataObj';

export const VALID_PROGIDS = new Set([PROGID_EMPRESA, PROGID_USUARIO, PROGID_GENERIC]);

// Visibilidad (bitmask)
export const VISIBILITY_FORM = 1;
export const VISIBILITY_LIST = 2;
export const VISIBILITY_CONTENTS = 4;
export const VISIBILITY_ALL = 7;
