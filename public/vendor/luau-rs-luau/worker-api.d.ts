//#region src/values.d.ts
declare class LuaOutputEvent extends Event {
  readonly text: string;
  constructor(type: LuaOutputType, text: string);
}
interface LuaOutputEventMap {
  print: LuaOutputEvent;
}
declare class LuaVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  constructor(x: number, y: number, z: number);
  toString(): string;
}
//#endregion
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
//#region src/types.d.ts
type OptimizationLevel = 0 | 1 | 2;
type DebugLevel = 0 | 1 | 2;
interface LuaModule {
  name: string;
  value: LuaCallbackArgument;
}
interface ModuleResolverContext {
  from: string;
  lua: Lua;
}
type ModuleResolver = (specifier: string, context: ModuleResolverContext) => ModuleSource | LuaModule | null | undefined | PromiseLike<ModuleSource | LuaModule | null | undefined>;
interface CompilerOptions {
  optimizationLevel?: OptimizationLevel;
  debugLevel?: DebugLevel;
  typeInfoLevel?: 0 | 1;
  coverageLevel?: 0 | 1 | 2;
  vectorConstructor?: string;
  vectorType?: string;
  mutableGlobals?: readonly string[];
  userdataTypes?: readonly string[];
  disabledBuiltins?: readonly string[];
  libraryConstants?: Readonly<Record<string, null | boolean | number | bigint | string>>;
}
interface BytecodeDumpOptions {
  code?: boolean;
  lines?: boolean;
  source?: boolean;
  locals?: boolean;
  remarks?: boolean;
  types?: boolean;
  constants?: boolean;
}
interface CompileOptions extends CompilerOptions {
  signal?: AbortSignal;
  timing?: boolean;
}
interface DumpOptions extends CompilerOptions, BytecodeDumpOptions {
  signal?: AbortSignal;
  timing?: boolean;
}
interface ExecutionOptions extends CompilerOptions {
  memoryLimitBytes?: number;
  interruptLimit?: number;
  outputLimitBytes?: number;
  outputLimitEvents?: number;
  resultLimitBytes?: number;
  resultLimitEntries?: number;
}
interface ExecuteOptions extends ExecutionOptions {
  entryName?: string;
  modules?: readonly ModuleSource[];
  signal?: AbortSignal;
  timing?: boolean;
}
interface BytecodeExecuteOptions extends ExecuteOptions {
  transfer?: boolean;
}
type DefaultExecutionOptions = Required<Pick<ExecutionOptions, 'optimizationLevel' | 'debugLevel' | 'memoryLimitBytes' | 'interruptLimit' | 'outputLimitBytes' | 'outputLimitEvents' | 'resultLimitBytes' | 'resultLimitEntries'>>;
declare const DEFAULT_EXECUTION_OPTIONS: Readonly<DefaultExecutionOptions>;
type LuaErrorKind = 'input' | 'syntax' | 'compile' | 'runtime' | 'memory' | 'interrupted' | 'conversion' | 'host';
interface LuaError {
  kind: LuaErrorKind;
  message: string;
}
interface ExecutionResult {
  ok: boolean;
  error: LuaError | null;
  values: DetachedLuaValue[];
  peakLuaMemoryBytes: number;
  interruptCount: number;
  outputTruncated: boolean;
}
type DetachedLuaValue = null | boolean | number | bigint | string | Uint8Array | LuaVector | DetachedLuaValue[] | {
  [key: string]: DetachedLuaValue;
} | Map<DetachedLuaValue, DetachedLuaValue>;
interface CompileResult {
  ok: boolean;
  bytecode: Uint8Array;
  error: LuaError | null;
}
interface DumpResult {
  ok: boolean;
  text: string;
  textTruncated: boolean;
  error: LuaError | null;
}
interface TimedResult<T> {
  result: T;
  durationMs: number;
}
type LuaWorkerKind = 'execution' | 'compiler';
type LuaWorkerFactory = (kind: LuaWorkerKind) => Worker;
type JsInterop = readonly string[];
interface LuaWorkerOptions {
  jsInterop?: JsInterop;
  resolveModule?: SourceModuleResolver;
  workerUrl?: string | URL;
  worker?: LuaWorkerFactory;
}
type LuaOutputType = 'print';
//#endregion
//#region src/conversion-internal.d.ts
declare const FROM_LUA: unique symbol;
declare const FROM_LUA_REST: unique symbol;
declare const INTO_LUA: unique symbol;
declare const INTO_LUA_MULTIPLE: unique symbol;
type FromLuaNode<Value = unknown> = {
  readonly kind: 'bytes';
  readonly output?: Value;
} | {
  readonly kind: 'array';
  readonly value: unknown;
  readonly output?: Value;
} | {
  readonly kind: 'tuple';
  readonly values: readonly unknown[];
  readonly output?: Value;
} | {
  readonly kind: 'map';
  readonly key: unknown;
  readonly value: unknown;
  readonly output?: Value;
} | {
  readonly kind: 'record';
  readonly value: unknown;
  readonly output?: Value;
} | {
  readonly kind: 'object';
  readonly fields: Readonly<Record<string, unknown>>;
  readonly output?: Value;
} | {
  readonly kind: 'option';
  readonly value: unknown;
  readonly output?: Value;
};
type IntoLuaNode = {
  readonly kind: 'buffer';
  readonly bytes: Uint8Array;
} | {
  readonly kind: 'userdata';
  readonly value: object | Function;
} | {
  readonly kind: 'callback';
  readonly callback: Function;
  readonly args?: unknown;
};
//#endregion
//#region src/userdata.d.ts
type UserdataFieldSetter<T> = {
  invoke(value: T, fieldValue: LuaCallbackArgument | undefined): void;
}['invoke'];
interface UserdataField<T> {
  type?: FromLuaType;
  get?: (value: T) => IntoLuaValue;
  set?: UserdataFieldSetter<T>;
}
type UserdataMethod<T> = (value: T, ...args: LuaCallbackArgument[]) => LuaCallbackReturn;
type UserdataMethodCallback<T, Arguments extends FromLuaSignatures> = {
  invoke(value: T, ...args: FromLuaValues<Arguments>): LuaCallbackReturn;
}['invoke'];
interface UserdataMethodOptions<T, Arguments extends FromLuaSignatures = FromLuaSignatures> {
  args: Arguments;
  callback: UserdataMethodCallback<T, Arguments>;
}
type UserdataMethodDefinition<T> = UserdataMethod<T> | UserdataMethodOptions<T>;
type UserdataSyncMethod<T> = (value: T, ...args: LuaCallbackArgument[]) => LuaCallbackResult;
type UserdataNamecall<T> = (value: T, method: string, ...args: LuaCallbackArgument[]) => LuaCallbackReturn;
/** Handles a binary operator in its original left-to-right operand order. */
type UserdataBinaryMetamethod<T> = (left: T | IntoLuaValue, right: T | IntoLuaValue) => LuaCallbackResult;
type UserdataClass<T extends object> = abstract new (...args: never[]) => T;
type UserdataMetamethod = '__add' | '__sub' | '__mul' | '__div' | '__idiv' | '__mod' | '__pow' | '__unm' | '__eq' | '__lt' | '__le' | '__len' | '__concat' | '__index' | '__newindex' | '__namecall' | '__call' | '__tostring' | '__todebugstring' | '__iter';
type UserdataBinaryMetamethodName = '__add' | '__sub' | '__mul' | '__div' | '__idiv' | '__mod' | '__pow' | '__eq' | '__lt' | '__le' | '__concat';
interface UserdataSurface<T> {
  fields?: Readonly<Record<string, UserdataField<T>>>;
  methods?: Readonly<Record<string, UserdataMethodDefinition<T>>>;
  metamethods?: Partial<Readonly<Record<Exclude<UserdataMetamethod, UserdataBinaryMetamethodName | '__namecall' | '__call'>, UserdataSyncMethod<T>> & Record<UserdataBinaryMetamethodName, UserdataBinaryMetamethod<T>> & {
    __namecall: UserdataNamecall<T>;
    __call: UserdataMethodDefinition<T>;
  }>>;
}
interface UserdataProxyDefinition<T extends object> extends UserdataSurface<UserdataClass<T>> {}
interface UserdataDefinitionBase<T extends object> extends UserdataSurface<T> {
  /** Members exposed by the type-level value returned from `Lua.createProxy`. */
  proxy?: UserdataProxyDefinition<T>;
}
type ConstructorForArguments<Arguments, Instance extends object> = Arguments extends unknown[] ? new (...args: Arguments) => Instance : never;
type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends ((value: infer Intersection) => void) ? Intersection : never;
type UserdataConstructor<Arguments extends FromLuaSignatures, Instance extends object> = UnionToIntersection<ConstructorForArguments<FromLuaValues<Arguments>, Instance>>;
//#endregion
//#region src/from-lua.d.ts
interface FromLua<Value> {
  readonly [FROM_LUA]: FromLuaNode<Value>;
}
interface Rest<Value> {
  readonly [FROM_LUA_REST]: {
    readonly value: FromLuaType;
    readonly output?: Value;
  };
}
type FromLuaConstructor = NumberConstructor | BigIntConstructor | StringConstructor | BooleanConstructor | Uint8ArrayConstructor | ArrayConstructor | ObjectConstructor | MapConstructor | typeof LuaValue | typeof LuaObject | typeof LuaTable | typeof LuaFunction | typeof LuaThread | typeof LuaBuffer | typeof LuaUserdata | typeof LuaVector | UserdataClass<object>;
type FromLuaType = FromLuaConstructor | FromLua<unknown>;
type FromLuaSignatureItem = FromLuaType | Rest<unknown>;
type FromLuaSignature = readonly FromLuaSignatureItem[];
type FromLuaSignatures = FromLuaSignature | readonly FromLuaSignature[];
type FromLuaValue<Type> = Type extends FromLua<infer Value> ? Value : Type extends NumberConstructor ? number : Type extends BigIntConstructor ? bigint : Type extends StringConstructor ? string : Type extends BooleanConstructor ? boolean : Type extends Uint8ArrayConstructor ? Uint8Array : Type extends ArrayConstructor ? unknown[] : Type extends ObjectConstructor ? Record<string, unknown> : Type extends MapConstructor ? Map<unknown, unknown> : Type extends (abstract new (...args: never[]) => infer Value) ? Value : never;
type FixedValues<Signature extends readonly unknown[]> = { -readonly [Index in keyof Signature]: FromLuaValue<Signature[Index]>; };
type SignatureValues<Signature extends FromLuaSignature> = Signature extends readonly [...infer Fixed, infer Last] ? Last extends Rest<infer Value> ? [...FixedValues<Fixed>, ...Value[]] : FixedValues<Signature> : [];
type FromLuaValues<Signatures extends FromLuaSignatures> = FromLuaSignatures extends Signatures ? unknown[] : Signatures extends FromLuaSignature ? SignatureValues<Signatures> : Signatures extends readonly FromLuaSignature[] ? SignatureValues<Signatures[number]> : never;
//#endregion
//#region src/into-lua.d.ts
interface IntoLua {
  readonly [INTO_LUA]: IntoLuaNode;
}
interface IntoLuaMulti {
  readonly [INTO_LUA_MULTIPLE]: readonly IntoLuaValue[];
}
//#endregion
//#region src/direct.d.ts
declare const VALUE_TOKEN: unique symbol;
declare const USERDATA_VALUE: unique symbol;
type StandardLibrary = 'base' | 'coroutine' | 'table' | 'os' | 'string' | 'math' | 'debug' | 'utf8' | 'bit32' | 'buffer' | 'vector' | 'integer' | 'class';
interface AllocationEvent {
  kind: 'allocate' | 'reallocate' | 'deallocate';
  currentBytes: number;
  nextBytes: number;
  oldSizeBytes: number;
  newSizeBytes: number;
  alignment: number;
  canDeny: boolean;
}
interface MemoryOptions {
  limitBytes?: number;
  /** Returning false rejects an allocation or growing reallocation. */
  onAllocation?: (event: Readonly<AllocationEvent>) => boolean | void;
}
interface LuaOptions {
  libraries?: 'all' | 'none' | readonly StandardLibrary[];
  sandbox?: boolean;
  memory?: MemoryOptions;
  resolveModule?: ModuleResolver;
}
interface DirectCompilerOptions extends Omit<CompilerOptions, 'libraryConstants'> {
  libraryConstants?: Readonly<Record<string, null | boolean | number | bigint | string | LuaVector>>;
}
interface DirectDumpOptions extends DirectCompilerOptions, BytecodeDumpOptions {}
interface LoadOptions {
  name?: string;
  environment?: LuaTable | null;
}
interface DirectExecuteOptions extends LoadOptions {
  sandboxed?: boolean;
}
interface AsyncCallOptions {
  signal?: AbortSignal;
}
interface AsyncExecuteOptions extends DirectExecuteOptions, AsyncCallOptions {}
interface StackInfo {
  currentLine?: number;
  name?: string;
  source: string;
  shortSource: string;
  what: string;
  lineDefined?: number;
  /** VM-wide prototype identifier, absent for native functions. */
  protoId?: number;
  /** Prototype index within its bytecode module, absent for native functions. */
  bytecodeId?: number;
  parameterCount: number;
  upvalueCount: number;
  vararg: boolean;
}
type DebugContext = StackInfo;
interface FunctionInfo {
  name?: string;
  what: string;
  source?: string;
  shortSource?: string;
  lineDefined?: number;
  /** VM-wide prototype identifier, absent for native functions. */
  protoId?: number;
  /** Prototype index within its bytecode module, absent for native functions. */
  bytecodeId?: number;
  upvalueCount: number;
  parameterCount: number;
  vararg: boolean;
}
interface CoverageInfo {
  function?: string;
  lineDefined: number;
  depth: number;
  hits: number[];
}
type DebugAction = 'continue' | 'break';
interface DebugHooks {
  singleStep?: boolean;
  step?: (context: Readonly<DebugContext>) => DebugAction | void;
  breakpoint?: (context: Readonly<DebugContext>) => DebugAction | void;
  interrupt?: (context: Readonly<DebugContext>) => void;
  protectedError?: () => DebugAction | void;
}
type InterruptAction = 'continue' | 'yield' | 'break';
interface InterruptHooks {
  mode?: 'continuous' | 'requested';
  execution?: (context: {
    readonly kind: 'execution';
    readonly yieldable: boolean;
    defer(): void;
  }) => InterruptAction | void;
  pattern?: (context: {
    readonly kind: 'pattern';
    defer(): void;
  }) => void;
  garbageCollection?: (context: {
    readonly kind: 'garbageCollection';
    readonly stage: 'beforeStep' | 'afterStep' | 'unknown';
    readonly previousPhase?: 'pause' | 'propagate' | 'propagateAgain' | 'atomic' | 'sweep' | 'unknown';
    defer(): void;
  }) => void;
}
type ThreadStatus = 'resumable' | 'running' | 'normal' | 'finished' | 'error';
type LuaPrimitiveType = 'boolean' | 'number' | 'integer' | 'string' | 'buffer' | 'function' | 'thread' | 'vector';
type LuaPrimitive = null | boolean | number | bigint | string | Uint8Array | LuaVector;
type NonThenableObject = object & {
  readonly then?: never;
};
type IntoLuaValue = LuaPrimitive | LuaValue | IntoLua | readonly IntoLuaValue[] | ReadonlyMap<IntoLuaValue, IntoLuaValue> | {
  readonly [key: string]: IntoLuaValue;
} | NonThenableObject;
type LuaValueLike = IntoLuaValue;
type LuaCallbackArgument = LuaPrimitive | LuaValue;
interface FromLuaOptions<Arguments extends FromLuaSignatures> {
  args: Arguments;
}
type LuaCallbackResult = IntoLuaValue | IntoLuaMulti | undefined | void;
type LuaCallbackReturn = LuaCallbackResult | PromiseLike<LuaCallbackResult>;
type LuaThreadResult = {
  done: false;
  value: LuaCallbackArgument[];
} | {
  done: true;
  value: LuaCallbackArgument[];
};
/** A rooted value owned by a direct {@link Lua} state. */
declare class LuaValue {
  protected readonly lua: Lua;
  readonly type: string;
  protected readonly handle: number;
  constructor(lua: Lua, state: unknown, type: string, handle: number, registerFinalizer: boolean, token: typeof VALUE_TOKEN);
  equals(other: LuaValue): boolean;
  toString(): string;
}
declare abstract class LuaObjectLike extends LuaValue {
  get(key: LuaValueLike): LuaCallbackArgument;
  set(key: LuaValueLike, value: LuaValueLike): void;
  call(...args: LuaValueLike[]): LuaCallbackArgument[];
  callAsync(args?: readonly LuaValueLike[], options?: AsyncCallOptions): Promise<LuaCallbackArgument[]>;
  callMethod(name: string, ...args: LuaValueLike[]): LuaCallbackArgument[];
  callMethodAsync(name: string, args?: readonly LuaValueLike[], options?: AsyncCallOptions): Promise<LuaCallbackArgument[]>;
  callFunction(name: string, ...args: LuaValueLike[]): LuaCallbackArgument[];
  callFunctionAsync(name: string, args?: readonly LuaValueLike[], options?: AsyncCallOptions): Promise<LuaCallbackArgument[]>;
}
declare class LuaClass extends LuaObjectLike {}
declare class LuaObject extends LuaObjectLike {
  get class(): LuaClass;
}
declare class LuaTable extends LuaObjectLike {
  rawGet(key: LuaValueLike): LuaCallbackArgument;
  rawSet(key: LuaValueLike, value: LuaValueLike): void;
  entries(): Array<[LuaCallbackArgument, LuaCallbackArgument]>;
  toArray(): LuaCallbackArgument[];
  toObject(): Record<string, LuaCallbackArgument>;
  toMap(): Map<LuaCallbackArgument, LuaCallbackArgument>;
  length(options?: {
    raw?: boolean;
  }): number;
  clear(): void;
  containsKey(key: LuaValueLike): boolean;
  push(value: LuaValueLike): void;
  pop(): LuaCallbackArgument;
  remove(key: LuaValueLike): void;
  rawSetIndex(index: number, value: LuaValueLike): void;
  rawPush(value: LuaValueLike): void;
  rawPop(): LuaCallbackArgument;
  rawInsert(index: number, value: LuaValueLike): void;
  rawRemove(key: LuaValueLike): void;
  setSafeEnvironment(enabled: boolean): void;
  get readonly(): boolean;
  set readonly(enabled: boolean);
  get metatable(): LuaTable | null;
  set metatable(value: LuaTable | null);
}
declare class LuaFunction extends LuaValue {
  get environment(): LuaTable | null;
  setEnvironment(environment: LuaTable): boolean;
  deepClone(): LuaFunction;
  bind(...args: LuaValueLike[]): LuaFunction;
  info(): FunctionInfo;
  coverage(): CoverageInfo[];
  call(...args: LuaValueLike[]): LuaCallbackArgument[];
  callAsync(args?: readonly LuaValueLike[], options?: AsyncCallOptions): Promise<LuaCallbackArgument[]>;
  createThread(): LuaThread;
}
declare class LuaThread extends LuaValue {
  get status(): ThreadStatus;
  get yieldable(): boolean;
  get namecallMethod(): string | null;
  setSingleStep(enabled: boolean): void;
  inspectStack(level?: number): Readonly<StackInfo> | null;
  traceback(message?: string, level?: number): string;
  resume(...args: LuaValueLike[]): LuaCallbackArgument[];
  reset(function_: LuaFunction): void;
  resumeError(error: LuaValueLike): LuaCallbackArgument[];
  resumeAsync(args?: readonly LuaValueLike[], options?: AsyncCallOptions): Promise<LuaThreadResult>;
  resumeErrorAsync(error: LuaValueLike, options?: AsyncCallOptions): Promise<LuaThreadResult>;
  [Symbol.asyncIterator](): AsyncGenerator<LuaCallbackArgument[], LuaCallbackArgument[], LuaValueLike[] | undefined>;
  private decodeResult;
}
declare class LuaBuffer extends LuaValue {
  get bytes(): Uint8Array;
  write(offset: number, bytes: Uint8Array): void;
}
declare class LuaUserdata<T extends object = object> extends LuaObjectLike {
  get value(): T;
  destroy(): void;
  take(): T;
  get userValue(): LuaCallbackArgument;
  set userValue(value: LuaValueLike);
  get typeName(): string;
  get metatable(): LuaUserdataMetatable;
  isProxy(userdataClass: UserdataClass<object>): boolean;
}
declare class LuaUserdataMetatable {
  private readonly owner;
  private readonly lua;
  private readonly handle;
  private constructor();
  private readonly state;
  get(key: string): LuaCallbackArgument;
  set(key: string, value: LuaValueLike): void;
  has(key: string): boolean;
  entries(): Array<[string, LuaCallbackArgument]>;
}
/**
 * A direct Lua state in the current JavaScript realm.
 *
 * Execution runs on the current thread. Browser applications running
 * untrusted scripts should normally use `LuaWorker`.
 */
declare class Lua extends EventTarget {
  #private;
  readonly version: string;
  readonly appData: Map<unknown, unknown>;
  private constructor();
  static create(options?: LuaOptions): Promise<Lua>;
  private static createState;
  addEventListener<K extends keyof LuaOutputEventMap>(type: K, listener: ((this: Lua, event: LuaOutputEventMap[K]) => void) | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof LuaOutputEventMap>(type: K, listener: ((this: Lua, event: LuaOutputEventMap[K]) => void) | null, options?: boolean | EventListenerOptions): void;
  get globals(): LuaTable;
  get mainThread(): LuaThread;
  get currentThread(): LuaThread;
  get yieldable(): boolean;
  get namecallMethod(): string | null;
  coerceString(value: LuaValueLike): string | Uint8Array | null;
  coerceInteger(value: LuaValueLike): bigint | null;
  coerceNumber(value: LuaValueLike): number | null;
  typeMetatable(type: LuaPrimitiveType): LuaTable | null;
  setTypeMetatable(type: LuaPrimitiveType, metatable: LuaTable | null): void;
  inspectStack(level?: number): Readonly<StackInfo> | null;
  get usedMemory(): number;
  get peakMemory(): number;
  private moduleResolver;
  get gcRunning(): boolean;
  createTable(initial?: readonly LuaValueLike[] | ReadonlyMap<LuaValueLike, LuaValueLike> | Readonly<Record<string, LuaValueLike>>): LuaTable;
  createTableWithCapacity(arrayCapacity: number, recordCapacity: number): LuaTable;
  createBuffer(bytes: Uint8Array | number): LuaBuffer;
  loadLibraries(libraries: 'all' | 'none' | readonly StandardLibrary[]): void;
  createFunction(callback: (...args: LuaCallbackArgument[]) => LuaCallbackReturn): LuaFunction;
  createFunction<const Arguments extends FromLuaSignatures>(callback: (...args: FromLuaValues<Arguments>) => LuaCallbackReturn, options: FromLuaOptions<Arguments>): LuaFunction;
  createUserdata<T extends object>(value: T): LuaUserdata<T>;
  createProxy<T extends object>(userdataClass: UserdataClass<T>, surface?: UserdataSurface<UserdataClass<T>>): LuaUserdata<UserdataClass<T>>;
  registerUserdata<T extends object, const Arguments extends FromLuaSignatures>(userdataClass: UserdataClass<T> & UserdataConstructor<Arguments, T>, definition: UserdataDefinitionBase<T> & {
    constructor: Arguments;
  }): void;
  registerUserdata<T extends object>(userdataClass: UserdataClass<T>, definition: UserdataDefinitionBase<T>): void;
  load(source: string, options?: LoadOptions): LuaFunction;
  loadBytecode(bytecode: Uint8Array, options?: LoadOptions): LuaFunction;
  execute(source: string, options?: DirectExecuteOptions, ...args: LuaValueLike[]): LuaCallbackArgument[];
  executeAsync(source: string, options?: AsyncExecuteOptions, ...args: LuaValueLike[]): Promise<LuaCallbackArgument[]>;
  executeBytecode(bytecode: Uint8Array, options?: DirectExecuteOptions, ...args: LuaValueLike[]): LuaCallbackArgument[];
  executeBytecodeAsync(bytecode: Uint8Array, options?: AsyncExecuteOptions, ...args: LuaValueLike[]): Promise<LuaCallbackArgument[]>;
  compile(source: string, options?: DirectCompilerOptions): Uint8Array;
  dump(source: string, options?: DirectDumpOptions): string;
  setCompiler(options: DirectCompilerOptions): void;
  sandbox(enabled?: boolean): void;
  setMemoryLimit(bytes: number): number;
  gcStop(): void;
  gcRestart(): void;
  gcCollect(): void;
  gcStep(): boolean;
  traceback(message?: string, level?: number): string;
  setNamedRegistryValue(key: string, value: LuaValueLike): void;
  namedRegistryValue(key: string): LuaCallbackArgument;
  unsetNamedRegistryValue(key: string): void;
  setInterruptHooks(hooks: InterruptHooks): void;
  removeInterruptHooks(): void;
  requestInterrupt(): void;
  setDebugHooks(hooks: DebugHooks): void;
  removeDebugHooks(): void;
  private wrapReference;
  private encodeCallbackResult;
  private encodeCallbackReturn;
  private encodeCompilerOptions;
  private userdataBridge;
  private userdataDefinition;
  private userdataProxyDefinition;
  private storeUserdata;
  [USERDATA_VALUE](token: unknown): object;
  private bridgeUserdataDefinition;
}
//#endregion
//#region src/javascript.d.ts
interface JsAccess {
  operation: 'get' | 'set' | 'call' | 'construct' | 'stringify';
  target: unknown;
  property?: PropertyKey;
}
type JsAccessFilter = (access: JsAccess) => boolean;
//#endregion
//#region src/worker-runtime.d.ts
interface LuaWorkerServerOptions {
  configure?: (lua: Lua) => LuaWorkerCleanup | void | Promise<LuaWorkerCleanup | void>;
  jsInterop?: {
    filter: JsAccessFilter;
  };
  resolveModule?: ModuleResolver;
}
type LuaWorkerCleanup = () => void | Promise<void>;
//#endregion
//#region src/index.d.ts
declare class LuaWorker extends EventTarget {
  private readonly executionClient;
  private readonly compilerClient;
  private readonly jsInterop;
  private readonly workerFactory;
  private readonly resolveModule;
  constructor(options?: LuaWorkerOptions);
  addEventListener<K extends keyof LuaOutputEventMap>(type: K, listener: ((this: LuaWorker, event: LuaOutputEventMap[K]) => void) | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof LuaOutputEventMap>(type: K, listener: ((this: LuaWorker, event: LuaOutputEventMap[K]) => void) | null, options?: boolean | EventListenerOptions): void;
  execute(source: string, options: ExecuteOptions & {
    timing: true;
  }): Promise<TimedResult<ExecutionResult>>;
  execute(source: string, options?: ExecuteOptions & {
    timing?: false;
  }): Promise<ExecutionResult>;
  execute(source: string, options: ExecuteOptions): Promise<ExecutionResult | TimedResult<ExecutionResult>>;
  executeBytecode(bytecode: Uint8Array, options: BytecodeExecuteOptions & {
    timing: true;
  }): Promise<TimedResult<ExecutionResult>>;
  executeBytecode(bytecode: Uint8Array, options?: BytecodeExecuteOptions & {
    timing?: false;
  }): Promise<ExecutionResult>;
  executeBytecode(bytecode: Uint8Array, options: BytecodeExecuteOptions): Promise<ExecutionResult | TimedResult<ExecutionResult>>;
  compile(source: string, options: CompileOptions & {
    timing: true;
  }): Promise<TimedResult<CompileResult>>;
  compile(source: string, options?: CompileOptions & {
    timing?: false;
  }): Promise<CompileResult>;
  compile(source: string, options: CompileOptions): Promise<CompileResult | TimedResult<CompileResult>>;
  dump(source: string, options: DumpOptions & {
    timing: true;
  }): Promise<TimedResult<DumpResult>>;
  dump(source: string, options?: DumpOptions & {
    timing?: false;
  }): Promise<DumpResult>;
  dump(source: string, options: DumpOptions): Promise<DumpResult | TimedResult<DumpResult>>;
  terminate(): void;
  [Symbol.dispose](): void;
}
//#endregion
//#region src/worker-api.d.ts
declare function serveLuaWorker(options?: LuaWorkerServerOptions): Promise<void>;
//#endregion
export { type BytecodeDumpOptions, type BytecodeExecuteOptions, type CompileOptions, type CompileResult, type CompilerOptions, DEFAULT_EXECUTION_OPTIONS, type DebugLevel, type DetachedLuaValue, type DumpOptions, type DumpResult, type ExecuteOptions, type ExecutionOptions, type ExecutionResult, type JsInterop, type LuaError, type LuaErrorKind, type LuaModule, LuaOutputEvent, type LuaOutputEventMap, type LuaOutputType, LuaVector, LuaWorker, type LuaWorkerCleanup, type LuaWorkerFactory, type LuaWorkerKind, type LuaWorkerOptions, type LuaWorkerServerOptions, type ModuleResolver, type ModuleResolverContext, type ModuleSource, type OptimizationLevel, type SourceModuleResolver, type SourceModuleResolverContext, type TimedResult, serveLuaWorker };