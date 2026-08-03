// Tipos de propiedad válidos en XOne. Extraídos de xone-help-docs.
export const VALID_PROP_TYPES = new Set([
  'T',      // texto editable
  'TN', 'TN2', 'TN3', 'TN4', 'TN5', 'TN6', // texto numérico
  'N', 'N2', 'N3', 'N4', 'N5', 'N6',       // número
  'D',      // fecha
  'DT',     // fecha y hora
  'TT',     // hora
  'B',      // botón
  'L',      // label (forma preferida)
  'TL',     // alias legacy de L
  'NC',     // checkbox/toggle/radio/switch
  'X',      // password
  'IMG',    // imagen
  'PH',     // foto
  'VD',     // video / escáner QR
  'DR',     // dibujo/firma
  'WEB',    // webview
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
