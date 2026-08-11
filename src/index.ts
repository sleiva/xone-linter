export { XoneProject, type XoneProjectModel } from './project/XoneProject.js';
export { Validator, type ValidationRule } from './validator/Validator.js';
export { validateCollFile, type CollFileValidation } from './validator/validateCollFile.js';
export { ValidationResult, type ValidationIssue, type Severity } from './validator/ValidationResult.js';
export * from './model/XoneModel.js';
export * from './model/PropTypes.js';

// Runtime headless (Fase 2)
export { XoneRuntime, type RunEventOptions, type RunEventResult } from './runtime/XoneRuntime.js';
export { XoneContext } from './runtime/XoneContext.js';
export { EventExecutor, type EventExecutorOptions } from './runtime/EventExecutor.js';
export { RuntimeLog, type LogEntry, type LogType } from './runtime/RuntimeLog.js';
export { DataObject } from './runtime/objects/DataObject.js';
export { DataCollection, type CollectionSchema } from './runtime/objects/DataCollection.js';
export { AppData } from './runtime/objects/AppData.js';
export { UserInterface, type ViewWindow } from './runtime/objects/UserInterface.js';
export { HttpClient, type HttpClientOptions } from './runtime/objects/HttpClient.js';
export { Crypto } from './runtime/objects/Crypto.js';
export { DeviceInfo } from './runtime/objects/DeviceInfo.js';
export { SystemSettings } from './runtime/objects/SystemSettings.js';
export { createObjectFactory } from './runtime/objects/createObject.js';
export { type VmAdapter, type VmOptions, type VmResult } from './runtime/vm/VmAdapter.js';
export { NodeVmAdapter } from './runtime/vm/NodeVmAdapter.js';

// UI abstracta (Fase 3)
export { ViewStack } from './runtime/ui/ViewStack.js';
export { ViewState, buildView } from './runtime/ui/ViewState.js';
export { renderViewText } from './runtime/ui/ViewRenderer.js';
export { UIControl, buildControl } from './runtime/ui/Control.js';
export { UIGroup, buildGroup } from './runtime/ui/Group.js';
export { UIFrame, buildFrame } from './runtime/ui/Frame.js';

// Persistencia SQLite / in-memory (Fase 4)
export { PersistenceManager, type PersistenceOptions } from './runtime/persistence/PersistenceManager.js';
export { InMemoryDatabase } from './runtime/persistence/InMemoryDatabase.js';
export {
  SqliteConnection,
  type SqliteRunResult,
  BetterSqliteConnection,
  isSqliteAvailable,
} from './runtime/persistence/SqliteConnection.js';
export { SqlManager } from './runtime/persistence/SqlManager.js';
export { buildTableSchema, createTableSql, type TableSchema, type ColumnDef as ColumnSchema } from './runtime/persistence/SchemaBuilder.js';

// Agent facade (Task 2)
export { XoneSimulator, type SimulatorOptions } from './XoneSimulator.js';
export { buildSimResult, type SimResult } from './agent/result.js';
export * from './agent/serialize.js';

// Smoke-run agregado (corte S)
export {
  runSmoke,
  SMOKE_PHASES,
  type SmokeOptions,
  type SmokeReport,
  type SmokeCollReport,
  type SmokeIssue,
  type SmokeTap,
} from './agent/smoke.js';
