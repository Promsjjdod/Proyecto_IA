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
type AnalysisModuleResolver = SourceModuleResolver<AnalysisModule>;
//#endregion
//#region src/analysis-api.d.ts
declare class Analysis {
  #private;
  private constructor();
  private get state();
  static create(options?: AnalysisOptions): Promise<Analysis>;
  setMode(mode: AnalysisMode): void;
  setLint(enabled: boolean): void;
  setGlobals(globals: readonly string[]): void;
  setModule(name: string, source: string, kind?: AnalysisModuleKind, environment?: string): void;
  addDefinition(name: string, source: string, environment?: string): void;
  deleteModule(name: string): boolean;
  clearModules(): void;
  check(name: string): AnalysisCheckResult;
  checkModules(names: readonly string[]): AnalysisModuleCheckResult[];
  autocomplete(name: string, position: AnalysisPosition): AutocompleteResult;
  fragmentAutocomplete(name: string, source: string, position: AnalysisPosition): FragmentAutocompleteResult;
  typeAt(name: string, position: AnalysisPosition): string | undefined;
  expectedTypeAt(name: string, position: AnalysisPosition): string | undefined;
  inspectAt(name: string, position: AnalysisPosition): AnalysisInspection | undefined;
  decorateWithTypes(name: string): string | undefined;
  documentationSymbolAt(name: string, position: AnalysisPosition): string | undefined;
  moduleReturnType(name: string): string | undefined;
  requiredModules(name: string): string[];
  [Symbol.dispose](): void;
}
//#endregion
export { Analysis, type AnalysisCheckResult, type AnalysisDefinition, type AnalysisDiagnostic, type AnalysisInspection, type AnalysisLocation, type AnalysisMode, type AnalysisModule, type AnalysisModuleCheckResult, type AnalysisModuleKind, type AnalysisModuleResolver, type AnalysisOptions, type AnalysisPosition, type AnalysisTypeStringOptions, type AutocompleteContext, type AutocompleteEntry, type AutocompleteEntryKind, type AutocompleteResult, type FragmentAutocompleteResult };