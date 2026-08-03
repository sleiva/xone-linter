import type { DataObject } from '../objects/DataObject.js';
import { evaluateCondition } from './conditionEval.js';

export { evaluateCondition };

/** ¿El elemento debe verse? `disablevisible` oculta cuando la condición es cierta. */
export function evaluateVisible(expr: string, data: DataObject): boolean {
  return !evaluateCondition(expr, data);
}

/** ¿El control es editable? `disableedit` desactiva la edición cuando la condición es cierta. */
export function evaluateEditable(expr: string, data: DataObject): boolean {
  return !evaluateCondition(expr, data);
}
