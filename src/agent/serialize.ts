import type { LogEntry } from '../runtime/RuntimeLog.js';
import type { ViewState } from '../runtime/ui/ViewState.js';
import type { ValidationResult, ValidationIssue } from '../validator/ValidationResult.js';
import { groupKey, isFixedGroup, isDrawerGroup, type UIGroup } from '../runtime/ui/Group.js';
import type { UIFrame } from '../runtime/ui/Frame.js';
import type { UIControl } from '../runtime/ui/Control.js';

export interface CompactControl {
  name: string;
  type: string;
  value: unknown;
  visible: boolean;
  editable: boolean;
}

export interface CompactFrame {
  name?: string;
  controls: CompactControl[];
  frames: CompactFrame[];
}

export interface CompactGroup {
  id?: string;
  name?: string;
  kind: 'page' | 'fixed' | 'drawer';
  active?: boolean;
  open?: boolean;
  controls: CompactControl[];
  frames: CompactFrame[];
}

export interface CompactView {
  collName: string;
  title?: string;
  activePage?: string;
  groups: CompactGroup[];
  controls: CompactControl[];
}

function serializeControl(c: UIControl): CompactControl {
  return { name: c.name, type: c.type, value: c.value, visible: c.visible, editable: c.editable };
}

function serializeFrame(f: UIFrame): CompactFrame {
  return {
    name: f.name,
    controls: f.controls.filter(c => c.visible).map(serializeControl),
    frames: f.frames.filter(fr => fr.visible).map(serializeFrame),
  };
}

function serializeGroup(g: UIGroup, view: ViewState): CompactGroup {
  const kind: CompactGroup['kind'] = isDrawerGroup(g.attributes)
    ? 'drawer'
    : isFixedGroup(g.attributes)
      ? 'fixed'
      : 'page';
  const out: CompactGroup = {
    id: g.id,
    name: g.name,
    kind,
    controls: g.controls.filter(c => c.visible).map(serializeControl),
    frames: g.frames.filter(f => f.visible).map(serializeFrame),
  };
  if (kind === 'page') out.active = groupKey(g) === view.activeGroup;
  if (kind === 'drawer') out.open = view.openDrawers?.has(g.id ?? '') ?? false;
  return out;
}

export function serializeView(view: ViewState | undefined): CompactView | null {
  if (!view) return null;
  return {
    collName: view.collName,
    title: view.title,
    activePage: view.activeGroup,
    groups: view.groups.filter(g => g.visible).map(g => serializeGroup(g, view)),
    controls: view.controls.filter(c => c.visible).map(serializeControl),
  };
}

export interface CompactLogEntry {
  type: string;
  description: string;
  method?: string;
}

export function serializeLog(entries: ReadonlyArray<LogEntry>): CompactLogEntry[] {
  return entries.map(e => {
    const out: CompactLogEntry = { type: e.type, description: e.description };
    if (e.type === 'warning') {
      const p = e.payload as { object?: string; method?: string } | undefined;
      if (p?.object && p?.method) out.method = `${p.object}.${p.method}`;
    }
    return out;
  });
}

export function serializeValidation(result: ValidationResult): { errors: number; warnings: number } {
  return { errors: result.errors.length, warnings: result.warnings.length };
}

export function serializeIssues(result: ValidationResult): Array<Pick<ValidationIssue, 'severity' | 'code' | 'message' | 'file'>> {
  return result.issues.map(i => ({ severity: i.severity, code: i.code, message: i.message, file: i.file }));
}
