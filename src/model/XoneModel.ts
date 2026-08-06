export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface XoneAction {
  name: string;
  field?: string;
  value?: string;
  script?: string;
  scriptLanguage: string;
  params: Record<string, string>;
  location: SourceLocation;
}

export interface XoneProp {
  name: string;
  type: string;
  attributes: Record<string, string>;
  inlineEvents: XoneInlineEvent[];
  location: SourceLocation;
}

export interface XoneInlineEvent {
  name: string;      // onclick, onchange, onlongpress, etc.
  script: string;
  location: SourceLocation;
}

export interface XoneFrame {
  name?: string;
  attributes: Record<string, string>;
  frames: XoneFrame[];
  props: XoneProp[];
  childOrder?: ('frame' | 'prop')[];
  location: SourceLocation;
}

export interface XoneGroup {
  id?: string;
  name?: string;
  attributes: Record<string, string>;
  frames: XoneFrame[];
  props: XoneProp[];
  childOrder?: ('frame' | 'prop')[];
  location: SourceLocation;
}

export interface XoneColl {
  name: string;
  attributes: Record<string, string>;
  groups: XoneGroup[];
  props: XoneProp[];      // props de nivel coll, normalizadas desde grupos/frames
  events: XoneEvent[];
  macros: XoneMacro[];
  contents: XoneContents[];
  connections: XoneConnection[];
  nodes: XoneNode[];
  location: SourceLocation;
}

export interface XoneEvent {
  name: string;            // before-edit, create, onclick, onchange, onback, etc.
  triggerProp?: string;    // para onchange/selecteditem
  actions: XoneAction[];
  location: SourceLocation;
}

export interface XoneMacro {
  name: string;
  value?: string;
  default?: string;
  location: SourceLocation;
}

export interface XoneContents {
  name?: string;
  src?: string;
  filter?: string;
  sort?: string;
  location: SourceLocation;
}

export interface XoneStyle {
  url: string;
  encoding?: string;
  location: SourceLocation;
}

export interface XoneInclude {
  file: string;
  language?: string;
  encoding?: string;
  location: SourceLocation;
}

export interface XoneConnection {
  name: string;
  attributes: Record<string, string>;
  location: SourceLocation;
}

export interface XoneNode {
  name: string;
  actions: XoneAction[];
  location: SourceLocation;
}

export interface XoneAppConfig {
  attributes: Record<string, string>;
  connections: XoneConnection[];
  styles: XoneStyle[];
  includes: XoneInclude[];
  entryPoints: string[];
  loginColls: string[];
  location: SourceLocation;
}

export interface XoneProjectModel {
  app: XoneAppConfig;
  colls: XoneColl[];
  jsFiles: Map<string, string>;   // ruta relativa -> contenido
  cssFiles: Map<string, string>;  // ruta relativa -> contenido
  resources: string[];            // resto de ficheros
  rootPath: string;
  parseErrors: Array<{ file: string; message: string }>;
  /** basename en minúsculas -> todas las rutas relativas POSIX donde existe. Resuelve `imgbk`/
   *  `path`/`img` que el device busca en el árbol real de la app (p. ej. `icons/`); ver
   *  `pickImagePath` para cómo se elige entre varias rutas según el contexto (icono vs. data). */
  imageIndex: Record<string, string[]>;
  /** nombre de familia (basename SIN extensión, tal cual está en el fichero) -> ruta relativa
   *  POSIX del `.ttf`/`.otf`. La app EMBARCA sus fuentes (iOS las registra por `UIAppFonts` y
   *  `fontname` cita el nombre PostScript, que en la práctica es el basename) y el render las
   *  sirve con `@font-face` para que el navegador use SUS métricas — corte #33. */
  fontIndex: Record<string, string>;
}
