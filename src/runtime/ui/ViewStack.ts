import type { XoneColl } from '../../model/XoneModel.js';
import { buildView, type ViewState } from './ViewState.js';
import type { DataObject } from '../objects/DataObject.js';

export class ViewStack {
  private stack: ViewState[] = [];

  push(coll: XoneColl, data: DataObject): ViewState {
    const view = buildView(coll, data);
    this.stack.push(view);
    return view;
  }

  /** Apila una ViewState ya construida (refresco de la vista tras un evento). */
  pushView(view: ViewState): ViewState {
    this.stack.push(view);
    return view;
  }

  pop(): ViewState | undefined {
    return this.stack.pop();
  }

  get current(): ViewState | undefined {
    return this.stack[this.stack.length - 1];
  }

  get length(): number {
    return this.stack.length;
  }

  get all(): ReadonlyArray<ViewState> {
    return this.stack;
  }

  clear(): void {
    this.stack = [];
  }

  replace(coll: XoneColl, data: DataObject): ViewState {
    this.pop();
    return this.push(coll, data);
  }
}
