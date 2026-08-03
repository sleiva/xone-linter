import { promises as fs, existsSync, readdirSync } from 'node:fs';
import { join, relative, extname, resolve, sep } from 'node:path';
import { glob } from 'node:fs/promises';
import { parseXml, parseXmlOrdered, orderedTag, orderedKids, getAttributes, getText, type XoneXmlNode } from '../xml/XmlParser.js';
import { buildStylesheet } from '../runtime/css/orderedCss.js';
import { materializeCssAttributes } from '../runtime/css/materialize.js';
import type {
  XoneProjectModel,
  XoneAppConfig,
  XoneColl,
  XoneGroup,
  XoneFrame,
  XoneProp,
  XoneEvent,
  XoneAction,
  XoneMacro,
  XoneContents,
  XoneInlineEvent,
  XoneConnection,
  XoneNode,
  SourceLocation,
} from '../model/XoneModel.js';

export { type XoneProjectModel };

function loc(file: string): SourceLocation {
  return { file };
}

function asArray<T>(node: unknown): T[] {
  if (node === undefined || node === null) return [];
  if (Array.isArray(node)) return node as T[];
  return [node as T];
}

export class XoneProject {
  readonly model: XoneProjectModel;

  private constructor(model: XoneProjectModel) {
    this.model = model;
  }

  static async load(rootPath: string): Promise<XoneProject> {
    const resolved = resolve(rootPath);
    if (!existsSync(resolved)) {
      throw new Error(`No existe el directorio del proyecto: ${resolved}`);
    }

    const appPath = join(resolved, 'app.xml');
    if (!existsSync(appPath)) {
      throw new Error(`No se encontró app.xml en ${resolved}`);
    }

    const parseErrors: Array<{ file: string; message: string }> = [];

    let app: XoneAppConfig;
    try {
      app = await this.loadAppConfig(appPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      parseErrors.push({ file: appPath, message });
      app = {
        attributes: {},
        connections: [],
        styles: [],
        includes: [],
        entryPoints: [],
        loginColls: [],
        location: { file: appPath },
      };
    }

    // Buscar todos los .xne del proyecto.
    const xneFiles: string[] = [];
    for await (const entry of glob('**/*.xne', { cwd: resolved, withFileTypes: true })) {
      if (entry.isFile()) {
        xneFiles.push(join(resolved, entry.name));
      }
    }

    const colls: XoneColl[] = [];
    for (const xnePath of xneFiles) {
      try {
        const coll = await this.loadColl(xnePath);
        if (coll) colls.push(coll);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        parseErrors.push({ file: xnePath, message });
      }
    }

    // mappings.xne puede contener colecciones de sistema (Empresas, Usuarios, etc.)
    const mappingsPath = join(resolved, 'mappings.xne');
    if (existsSync(mappingsPath)) {
      try {
        const mappingColls = await this.loadMappingsColls(mappingsPath);
        colls.push(...mappingColls);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        parseErrors.push({ file: mappingsPath, message });
      }
    }

    const jsFiles = new Map<string, string>();
    const cssFiles = new Map<string, string>();
    const resources: string[] = [];

    for await (const entry of glob('**/*', { cwd: resolved, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = join(resolved, entry.name);
      const rel = relative(resolved, full);
      if (rel === 'app.xml' || extname(rel).toLowerCase() === '.xne') continue;

      if (extname(rel).toLowerCase() === '.js') {
        jsFiles.set(rel, await fs.readFile(full, 'utf-8'));
      } else if (extname(rel).toLowerCase() === '.css') {
        cssFiles.set(rel, await fs.readFile(full, 'utf-8'));
      } else {
        resources.push(rel);
      }
    }

    // F15: motor CSS fiel — estampa en attributes lo que resuelva la cadena de clases
    // (orden de <style url> de app.xml; el attr del XML propio gana). Nunca lanza.
    try {
      const sheet = buildStylesheet({ app, cssFiles });
      materializeCssAttributes(
        { app, colls, jsFiles, cssFiles, resources: [], rootPath: resolved, parseErrors, imageIndex: {} },
        sheet,
      );
    } catch (e) {
      parseErrors.push({ file: 'app.xml', message: `materializeCssAttributes: ${String(e)}` });
    }

    const imageIndex = this.buildImageIndex(resolved);

    return new XoneProject({
      app,
      colls,
      jsFiles,
      cssFiles,
      resources,
      rootPath: resolved,
      parseErrors,
      imageIndex,
    });
  }

  // Extensiones de imagen que el device resuelve por nombre contra el árbol de la app
  // (p. ej. `imgbk="fondo.png"` vive de verdad en `icons/fondo.png`, resuelto por IconFolder).
  private static readonly IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

  /** Walk recursivo síncrono del root del proyecto: indexa basename(lowercase) -> TODAS las
   *  rutas relativas POSIX donde existe un fichero de imagen con ese nombre. Salta directorios
   *  que empiecen por `.`. Orden determinista (no depende del filesystem); ver `pickImagePath`
   *  para cómo se elige entre varias rutas según el contexto (icono vs. data). */
  private static buildImageIndex(rootPath: string): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    const walk = (dir: string): void => {
      // Orden determinista: con basenames duplicados entre carpetas, el orden del índice no debe
      // depender del filesystem (readdirSync no garantiza orden en todos los SO/discos).
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue;
          walk(join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        if (!this.IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        const rel = relative(rootPath, join(dir, entry.name)).split(sep).join('/');
        const base = entry.name.toLowerCase();
        (index[base] ??= []).push(rel);
      }
    };
    walk(rootPath);
    return index;
  }

  private static async loadAppConfig(path: string): Promise<XoneAppConfig> {
    const buf = await fs.readFile(path);
    const { doc } = parseXml(buf);

    const appNode = doc.app as XoneXmlNode | undefined;
    if (!appNode || typeof appNode !== 'object') {
      throw new Error(`app.xml no contiene nodo <app>: ${path}`);
    }

    const attrs = getAttributes(appNode);
    const app: XoneAppConfig = {
      attributes: attrs,
      connections: [],
      styles: [],
      includes: [],
      entryPoints: [],
      loginColls: [],
      location: { file: path, line: 1, column: 1 },
    };

    // <connection ... />
    for (const c of asArray<XoneXmlNode>(appNode.connection)) {
      const cAttrs = getAttributes(c);
      if (cAttrs.name) {
        app.connections.push({ name: cAttrs.name, attributes: cAttrs, location: loc(path) });
      }
    }

    // <style url="..." />
    for (const s of asArray<XoneXmlNode>(appNode.style)) {
      const sAttrs = getAttributes(s);
      if (sAttrs.url) {
        app.styles.push({ url: sAttrs.url, encoding: sAttrs.encoding, location: loc(path) });
      }
    }

    // <include file="..." ... />
    for (const i of asArray<XoneXmlNode>(appNode.include)) {
      const iAttrs = getAttributes(i);
      if (iAttrs.file) {
        app.includes.push({
          file: iAttrs.file,
          language: iAttrs.language,
          encoding: iAttrs.encoding,
          location: loc(path),
        });
      }
    }

    // <login-coll><item name="LoginColl"/></login-coll>
    const loginCollNode = appNode['login-coll'] as XoneXmlNode | undefined;
    if (loginCollNode) {
      for (const item of asArray<XoneXmlNode>(loginCollNode.item)) {
        const itemAttrs = getAttributes(item);
        if (itemAttrs.name) app.loginColls.push(itemAttrs.name);
      }
    }

    // <entry-point><item name="EntradaApp"/></entry-point>
    const entryPointNode = appNode['entry-point'] as XoneXmlNode | undefined;
    if (entryPointNode) {
      for (const item of asArray<XoneXmlNode>(entryPointNode.item)) {
        const itemAttrs = getAttributes(item);
        if (itemAttrs.name) app.entryPoints.push(itemAttrs.name);
      }
    } else if (attrs['entry-point']) {
      // atributo legacy entry-point="Menu"
      app.entryPoints.push(attrs['entry-point']);
    }

    return app;
  }

  private static async loadMappingsColls(path: string): Promise<XoneColl[]> {
    const buf = await fs.readFile(path);
    const { doc } = parseXml(buf);
    const colls: XoneColl[] = [];

    // mappings.xne: <xml><app .../><collprops><coll .../>...</collprops></xml>
    const collprops = (doc.collprops ?? (doc as XoneXmlNode).collprops) as XoneXmlNode | undefined;
    if (!collprops) return colls;

    for (const c of asArray<XoneXmlNode>(collprops.coll)) {
      const coll = this.parseCollNode(c, path);
      if (coll) colls.push(coll);
    }
    return colls;
  }

  private static async loadColl(path: string): Promise<XoneColl | null> {
    const buf = await fs.readFile(path);
    const doc = parseXml(buf).doc;
    // El orden documental solo importa cuando hay frames y props mezclados; si el fichero no
    // contiene ambos, evitamos el 2º parse (el fallback ordena igual). Chequeo léxico barato.
    const head = buf.toString('latin1');
    const orderedRoot = head.includes('<frame') && head.includes('<prop') ? parseXmlOrdered(buf) : undefined;

    // fast-xml-parser: si el nodo raíz NO está en alwaysArray, devuelve el nodo
    // raíz directamente (p. ej. el propio <coll>); si está, lo envuelve en una
    // clave (p. ej. { coll: [...] }). Soportamos ambos casos.
    let collNode: XoneXmlNode | undefined;
    if (doc.coll && typeof doc.coll === 'object' && !Array.isArray(doc.coll)) {
      collNode = doc.coll as XoneXmlNode;
    } else if (doc.coll && Array.isArray(doc.coll)) {
      collNode = (doc.coll as XoneXmlNode[])[0];
    } else if (typeof doc === 'object' && !Array.isArray(doc) && getAttributes(doc).name) {
      // doc es directamente el nodo raíz <coll>
      collNode = doc;
    }

    if (!collNode) {
      return null;
    }
    return this.parseCollNode(collNode, path, orderedRoot);
  }

  private static parseCollNode(collNode: XoneXmlNode, path: string, orderedRoot?: unknown[]): XoneColl | null {
    const attrs = getAttributes(collNode);
    const name = attrs.name;
    if (!name) {
      return null;
    }

    const groups: XoneGroup[] = [];
    const topLevelProps: XoneProp[] = [];
    const events: XoneEvent[] = [];
    const macros: XoneMacro[] = [];
    const contents: XoneContents[] = [];

    // Grupos
    const orderedGroups = (orderedRoot ?? []).filter(el => orderedTag(el) === 'group');
    let gi = 0;
    for (const g of asArray<XoneXmlNode>(collNode.group)) {
      const gAttrs = getAttributes(g);
      const orderedGroupKids = orderedGroups[gi] ? orderedKids(orderedGroups[gi]) : undefined;
      const { frames, props, childOrder } = this.parseContainerChildren(g, path, orderedGroupKids);
      groups.push({ id: gAttrs.id, name: gAttrs.name, attributes: gAttrs, frames, props, childOrder, location: loc(path) });
      gi++;
    }

    // Props de nivel coll (fuera de group)
    for (const p of asArray<XoneXmlNode>(collNode.prop)) {
      topLevelProps.push(this.parseProp(p, path));
    }

    // Macros
    for (const m of asArray<XoneXmlNode>(collNode.macro)) {
      const mAttrs = getAttributes(m);
      macros.push({
        name: mAttrs.name,
        value: mAttrs.value,
        default: mAttrs.default,
        location: loc(path),
      });
    }

    // Contents (coll-level + anidados en group/frame — el <contents> puede ir junto a su prop Z)
    contents.push(...this.collectContents(collNode, path));

    // Eventos de ciclo de vida e interacción
    const eventNames = [
      'create', 'before-edit', 'after-edit', 'load', 'onback',
      'onclick', 'onchange', 'selecteditem', 'onlongpressitem',
      'ondraweropened', 'ondrawerclosed', 'ondrawerslide', 'ondrawerstatechanged',
      'onbottomsheetstatechanged', 'onlogon', 'onlogoff', 'sys-message', 'onpushreceived',
    ];

    for (const eventName of eventNames) {
      const eventNode = collNode[eventName] as XoneXmlNode | undefined;
      if (!eventNode) continue;

      const actions = this.parseEventActions(eventNode, path);
      events.push({
        name: eventName,
        actions,
        location: loc(path),
      });
    }

    // <connection name="..." connstring="..." /> inline de la coll
    const connections: XoneConnection[] = [];
    for (const cn of asArray<XoneXmlNode>(collNode.connection)) {
      const cnAttrs = getAttributes(cn);
      if (cnAttrs.name) {
        connections.push({ name: cnAttrs.name, attributes: cnAttrs, location: loc(path) });
      }
    }

    // Recoger todas las props en una lista plana a nivel coll (incluyendo las de
    // grupos y frames anidados a cualquier profundidad).
    const allProps: XoneProp[] = [...topLevelProps];
    const collectFrameProps = (f: XoneFrame): void => {
      allProps.push(...f.props);
      for (const sub of f.frames) collectFrameProps(sub);
    };
    for (const g of groups) {
      allProps.push(...g.props);
      for (const f of g.frames) collectFrameProps(f);
    }

    // <node name="X"><action name="runscript"><script>...</script></action></node>
    const nodes: XoneNode[] = [];
    for (const n of asArray<XoneXmlNode>(collNode.node)) {
      const nAttrs = getAttributes(n);
      if (nAttrs.name) {
        nodes.push({ name: nAttrs.name, actions: this.parseEventActions(n, path), location: loc(path) });
      }
    }

    // Nodos custom-tag: hijos directos de <coll> cuyo tag NO es estructural ni evento
    // y que contienen <action> (p.ej. <entrar>, <accion>). El nombre del nodo es el tag.
    const reservedChildTags = new Set<string>([
      'group', 'prop', 'frame', 'connection', 'contents', 'macro', 'script',
      'node', 'permissions', 'method', 'include', 'field', 'rule', 'asfilter', 'item',
      ...eventNames,
    ]);
    for (const key of Object.keys(collNode)) {
      if (key.startsWith('@_') || key === '#text') continue;
      if (reservedChildTags.has(key)) continue;
      for (const el of asArray<XoneXmlNode>(collNode[key])) {
        if (asArray<XoneXmlNode>(el.action).length === 0) continue;
        nodes.push({ name: key, actions: this.parseEventActions(el, path), location: loc(path) });
      }
    }

    return {
      name,
      attributes: attrs,
      groups,
      props: allProps,
      events,
      macros,
      contents,
      connections,
      nodes,
      location: loc(path),
    };
  }

  /** Recoge los <contents> de un nodo y de TODOS sus group/frame anidados (recursivo).
   *  El <contents> puede vivir junto a su prop Z dentro de un frame/group, no solo a nivel
   *  de <coll> (patrón real: MyAllXOne Menu). Aplana a la lista de contents del coll. */
  private static collectContents(node: XoneXmlNode, path: string): XoneContents[] {
    const out: XoneContents[] = [];
    for (const c of asArray<XoneXmlNode>(node.contents)) {
      const a = getAttributes(c);
      out.push({ name: a.name, src: a.src, filter: a.filter, sort: a.sort, location: loc(path) });
    }
    for (const g of asArray<XoneXmlNode>(node.group)) out.push(...this.collectContents(g, path));
    for (const f of asArray<XoneXmlNode>(node.frame)) out.push(...this.collectContents(f, path));
    return out;
  }

  /** Parsea un <frame> recursivamente (frames anidados + props directas). */
  private static parseFrame(node: XoneXmlNode, path: string, orderedKidsArr?: unknown[]): XoneFrame {
    const attrs = getAttributes(node);
    const { frames, props, childOrder } = this.parseContainerChildren(node, path, orderedKidsArr);
    return { name: attrs.name, attributes: attrs, frames, props, childOrder, location: loc(path) };
  }

  /** Rellena frames/props (orden documental dentro de cada tipo) y, si hay hijos ordenados,
   *  el childOrder con la secuencia mixta. Sin orderedKids → comportamiento previo (frames
   *  luego props), sin childOrder. */
  private static parseContainerChildren(
    node: XoneXmlNode, path: string, orderedKidsArr?: unknown[],
  ): { frames: XoneFrame[]; props: XoneProp[]; childOrder?: ('frame' | 'prop')[] } {
    const normalFrames = asArray<XoneXmlNode>(node.frame);
    const normalProps = asArray<XoneXmlNode>(node.prop);
    const frames: XoneFrame[] = [];
    const props: XoneProp[] = [];
    if (orderedKidsArr) {
      const orderedFrameEls = orderedKidsArr.filter(el => orderedTag(el) === 'frame');
      const kinds = orderedKidsArr
        .map(orderedTag)
        .filter((t): t is 'frame' | 'prop' => t === 'frame' || t === 'prop');
      if (kinds.length > 0 && kinds.length === normalFrames.length + normalProps.length) {
        let fi = 0, pi = 0;
        for (const k of kinds) {
          if (k === 'frame') {
            frames.push(this.parseFrame(normalFrames[fi], path, orderedKids(orderedFrameEls[fi])));
            fi++;
          } else {
            props.push(this.parseProp(normalProps[pi++], path));
          }
        }
        return { frames, props, childOrder: kinds };
      }
    }
    for (const f of normalFrames) frames.push(this.parseFrame(f, path));
    for (const p of normalProps) props.push(this.parseProp(p, path));
    return { frames, props };
  }

  private static parseProp(node: XoneXmlNode, path: string): XoneProp {
    const attrs = getAttributes(node);
    const inlineEvents: XoneInlineEvent[] = [];
    const eventAttrs = ['onclick', 'onchange', 'onlongpress', 'selecteditem'];
    for (const evtName of eventAttrs) {
      if (attrs[evtName]) {
        inlineEvents.push({ name: evtName, script: attrs[evtName], location: loc(path) });
      }
    }
    return {
      name: attrs.name ?? '',
      type: attrs.type ?? '',
      attributes: attrs,
      inlineEvents,
      location: loc(path),
    };
  }

  private static parseEventActions(node: XoneXmlNode, path: string): XoneAction[] {
    const actions: XoneAction[] = [];
    for (const a of asArray<XoneXmlNode>(node.action)) {
      const aAttrs = getAttributes(a);
      const params: Record<string, string> = {};
      for (const p of asArray<XoneXmlNode>(a.param)) {
        const pAttrs = getAttributes(p);
        if (pAttrs.name) params[pAttrs.name] = pAttrs.value ?? '';
      }

      const scriptNodes = asArray<XoneXmlNode>(a.script);
      const scriptNode = scriptNodes[0];
      const scriptText = scriptNode ? getText(scriptNode) : '';
      const scriptAttrs = scriptNode ? getAttributes(scriptNode) : {};

      actions.push({
        name: aAttrs.name ?? '',
        field: aAttrs.field,
        value: aAttrs.value,
        script: scriptText,
        scriptLanguage: scriptAttrs.language ?? 'javascript',
        params,
        location: loc(path),
      });
    }
    return actions;
  }
}
