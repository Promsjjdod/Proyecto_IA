//#region src/module-resolver.d.ts
interface ModuleSource {
  name: string;
  source: string;
}
interface SourceModuleResolverContext {
  from: string;
  signal: AbortSignal;
}
type SourceModuleResolver<T extends ModuleSource = ModuleSource> = (specifier: string, context: SourceModuleResolverContext) => T | null | undefined | PromiseLike<T | null | undefined>;
//#endregion
//#region src/analysis-types.d.ts
type AnalysisMode = 'nocheck' | 'nonstrict' | 'strict';
type AnalysisModuleKind = 'module' | 'script';
interface AnalysisModule extends ModuleSource {
  kind?: AnalysisModuleKind;
  environment?: string;
}
interface AnalysisDefinition {
  name: string;
  source: string;
  environment?: string;
}
interface AnalysisTypeStringOptions {
  maxTableLength?: number;
  maxTypeLength?: number;
}
interface AnalysisOptions {
  mode?: AnalysisMode;
  lint?: boolean;
  globals?: readonly string[];
  modules?: readonly AnalysisModule[];
  definitions?: readonly AnalysisDefinition[];
  typeString?: AnalysisTypeStringOptions;
}
interface AnalysisPosition {
  line: number;
  column: number;
}
interface AnalysisInspection {
  name?: string;
  type: string;
}
interface AnalysisLocation {
  begin: AnalysisPosition;
  end: AnalysisPosition;
}
interface AnalysisDiagnostic {
  kind: 'type' | 'lint';
  severity: 'error' | 'warning';
  module: string;
  location: AnalysisLocation;
  message: string;
  code: number | string;
}
interface AnalysisCheckResult {
  diagnostics: AnalysisDiagnostic[];
  timeoutModules: string[];
}
interface AnalysisModuleCheckResult {
  name: string;
  result: AnalysisCheckResult;
}
type AutocompleteContext = 'unknown' | 'expression' | 'statement' | 'property' | 'type' | 'keyword' | 'string' | 'hotComment';
type AutocompleteEntryKind = 'property' | 'binding' | 'keyword' | 'string' | 'type' | 'module' | 'generatedFunction' | 'requirePath' | 'hotComment';
interface AutocompleteEntry {
  label: string;
  kind: AutocompleteEntryKind;
  type?: string;
  deprecated: boolean;
  wrongIndexType: boolean;
  typeCorrect: 'none' | 'correct' | 'correctFunctionResult';
  parentheses: 'none' | 'cursorAfter' | 'cursorInside';
  insertText?: string;
  indexedWithSelf: boolean;
  replaceDotWithColon: boolean;
  documentationSymbol?: string;
  tags: string[];
}
interface AutocompleteResult {
  context: AutocompleteContext;
  entries: AutocompleteEntry[];
}
interface FragmentAutocompleteResult {
  status: 'success' | 'fallback' | 'internalError';
  result?: AutocompleteResult;
}
interface AnalysisRequestOptions {
  signal?: AbortSignal;
}
type AnalysisWorkerFactory = (url: string | URL) => Worker;
interface AnalysisWorkerOptions extends AnalysisOptions {
  resolveModule?: AnalysisModuleResolver;
  worker?: AnalysisWorkerFactory;
  workerUrl?: string | URL;
}
type AnalysisModuleResolver = SourceModuleResolver<AnalysisModule>;
//#endregion
//#region src/analysis-worker.d.ts
declare class AnalysisWorker$1 {
  private readonly modules;
  private readonly workerFactory?;
  private readonly resolveModule?;
  private readonly workerUrl;
  private readonly finalizerState;
  private worker?;
  private synchronizedModules?;
  private pending?;
  private nextId;
  private terminated;
  private mode;
  private lint;
  private globals;
  private readonly definitions;
  private readonly typeString?;
  constructor(options?: AnalysisWorkerOptions);
  setMode(mode: AnalysisMode): void;
  setLint(enabled: boolean): void;
  setGlobals(globals: readonly string[]): void;
  addDefinition(name: string, source: string, environment?: string): void;
  setModule(name: string, source: string, kind?: AnalysisModuleKind, environment?: string): void;
  deleteModule(name: string): boolean;
  clearModules(): void;
  check(name: string, options?: AnalysisRequestOptions): Promise<AnalysisCheckResult>;
  checkModules(names: readonly string[], options?: AnalysisRequestOptions): Promise<AnalysisModuleCheckResult[]>;
  autocomplete(name: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<AutocompleteResult>;
  fragmentAutocomplete(name: string, source: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<FragmentAutocompleteResult>;
  typeAt(name: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<string | undefined>;
  expectedTypeAt(name: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<string | undefined>;
  inspectAt(name: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<AnalysisInspection | undefined>;
  decorateWithTypes(name: string, options?: AnalysisRequestOptions): Promise<string | undefined>;
  documentationSymbolAt(name: string, position: AnalysisPosition, options?: AnalysisRequestOptions): Promise<string | undefined>;
  moduleReturnType(name: string, options?: AnalysisRequestOptions): Promise<string | undefined>;
  requiredModules(name: string, options?: AnalysisRequestOptions): Promise<string[]>;
  terminate(): void;
  [Symbol.dispose](): void;
  private request;
  private createWorker;
  private handleMessage;
  private rejectPending;
  private takePending;
  private replaceWorker;
  private resolveModuleRequest;
  private sendModuleResponse;
  private workspace;
}
//#endregion
//#region src/node-analysis-worker.d.ts
declare function serveAnalysisWorker(): Promise<void>;
declare class AnalysisWorker extends AnalysisWorker$1 {
  constructor(options?: AnalysisWorkerOptions);
}
//#endregion
export { type AnalysisCheckResult, type AnalysisDefinition, type AnalysisDiagnostic, type AnalysisInspection, type AnalysisLocation, type AnalysisMode, type AnalysisModule, type AnalysisModuleCheckResult, type AnalysisModuleKind, type AnalysisModuleResolver, type AnalysisPosition, type AnalysisRequestOptions, type AnalysisTypeStringOptions, AnalysisWorker, type AnalysisWorkerFactory, type AnalysisWorkerOptions, type AutocompleteContext, type AutocompleteEntry, type AutocompleteEntryKind, type AutocompleteResult, type FragmentAutocompleteResult, serveAnalysisWorker };