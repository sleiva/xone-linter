import type { ViewState } from './ViewState.js';
import type { UIGroup } from './Group.js';
import type { UIFrame } from './Frame.js';
import type { UIControl } from './Control.js';

/**
 * Serializa una ViewState a una representación textual amigable para un LLM.
 */
export function renderViewText(view: ViewState): string {
  const lines: string[] = [];
  lines.push(`== ${view.title ?? view.collName} ==`);
  for (const group of view.groups) {
    renderGroup(lines, group, 1);
  }
  return lines.join('\n');
}

function renderGroup(lines: string[], group: UIGroup, depth: number): void {
  if (!group.visible) return;
  const indent = '  '.repeat(depth);
  lines.push(`${indent}[GROUP ${group.id ?? ''}] ${group.name ?? '(unnamed)'}`);
  for (const frame of group.frames) {
    renderFrame(lines, frame, depth + 1);
  }
  for (const control of group.controls) {
    renderControl(lines, control, depth + 1);
  }
}

function renderFrame(lines: string[], frame: UIFrame, depth: number): void {
  if (!frame.visible) return;
  const indent = '  '.repeat(depth);
  lines.push(`${indent}[FRAME] ${frame.name ?? '(unnamed)'}`);
  for (const sub of frame.frames) {
    renderFrame(lines, sub, depth + 1);
  }
  for (const control of frame.controls) {
    renderControl(lines, control, depth + 1);
  }
}

function renderControl(lines: string[], control: UIControl, depth: number): void {
  if (!control.visible) return;
  const indent = '  '.repeat(depth);
  const label = control.title ?? control.name;
  const valueStr = control.value === undefined || control.value === '' ? '(vacío)' : String(control.value);
  const events = control.inlineEvents.length > 0 ? ` [events: ${control.inlineEvents.join(',')}]` : '';
  lines.push(`${indent}- ${label} (${control.type}${control.editable ? '' : ', readonly'}) = ${valueStr}${events}`);
}
