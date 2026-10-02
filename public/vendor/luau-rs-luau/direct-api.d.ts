import { $ as Rest, A as LuaThreadResult, At as JsInterop, C as LuaObject, Ct as metamethod, D as LuaPrimitiveType, Dt as BytecodeDumpOptions, E as LuaPrimitive, Et as userdata, F as StackInfo, Ft as ModuleSource, G as FromLua, H as into_lua_d_exports, I as StandardLibrary, It as LuaOutputEvent, K as FromLuaConstructor, L as ThreadStatus, Lt as LuaOutputEventMap, M as LuaUserdataMetatable, Mt as ModuleResolver, N as LuaValue, Nt as ModuleResolverContext, O as LuaTable, Ot as CompilerOptions, P as MemoryOptions, Pt as OptimizationLevel, Q as FromLuaValues, R as IntoLua, Rt as LuaVector, S as LuaFunction, St as get, T as LuaOptions, Tt as set, X as FromLuaType, Y as FromLuaSignatures, Z as FromLuaValue, _ as LuaBuffer, _t as UserdataMethodOptions, a as DebugAction, b as LuaCallbackReturn, bt as UserdataSurface, c as DirectCompilerOptions, d as FunctionInfo, dt as UserdataClass, f as InterruptAction, ft as UserdataDefinition, g as Lua, gt as UserdataMethodDefinition, h as LoadOptions, ht as UserdataMethod, i as CoverageInfo, j as LuaUserdata, jt as LuaModule, k as LuaThread, kt as DebugLevel, l as DirectDumpOptions, lt as UserdataBinaryMetamethod, m as IntoLuaValue, mt as UserdataMetamethod, n as AsyncCallOptions, nt as from_lua_d_exports, o as DebugContext, p as InterruptHooks, pt as UserdataField, q as FromLuaSignature, r as AsyncExecuteOptions, s as DebugHooks, t as AllocationEvent, u as DirectExecuteOptions, ut as UserdataBinaryMetamethodName, v as LuaCallbackArgument, vt as UserdataNamecall, w as LuaObjectLike, wt as method, x as LuaClass, xt as field, y as LuaCallbackResult, yt as UserdataProxyDefinition, z as IntoLuaMulti } from "./direct-BJ3HzUhh.js";
//#region src/javascript.d.ts
interface JsAccess {
  operation: 'get' | 'set' | 'call' | 'construct' | 'stringify';
  target: unknown;
  property?: PropertyKey;
}
type JsAccessFilter = (access: JsAccess) => boolean;
interface JsGlobalsOptions {
  globals?: object;
  filter?: JsAccessFilter;
}
/**
 * Exposes the globals available in the current JavaScript realm to Lua.
 *
 * Browser callers should use this inside a worker unless they intentionally
 * accept that arbitrary Lua execution can block the page's main thread.
 */
declare function exposeJsGlobals(lua: Lua, allow: JsInterop, options?: JsGlobalsOptions): void;
//#endregion
export { type AllocationEvent, type AsyncCallOptions, type AsyncExecuteOptions, type BytecodeDumpOptions, type CompilerOptions, type CoverageInfo, type DebugAction, type DebugContext, type DebugHooks, type DebugLevel, type DirectCompilerOptions, type DirectDumpOptions, type DirectExecuteOptions, type FromLua, type FromLuaConstructor, type FromLuaSignature, type FromLuaSignatures, type FromLuaType, type FromLuaValue, type FromLuaValues, type FunctionInfo, type InterruptAction, type InterruptHooks, type IntoLua, type IntoLuaMulti, type IntoLuaValue, type JsAccess, type JsAccessFilter, type JsGlobalsOptions, type LoadOptions, Lua, LuaBuffer, type LuaCallbackArgument, type LuaCallbackResult, type LuaCallbackReturn, LuaClass, LuaFunction, type LuaModule, LuaObject, LuaObjectLike, type LuaOptions, LuaOutputEvent, type LuaOutputEventMap, type LuaPrimitive, type LuaPrimitiveType, LuaTable, LuaThread, type LuaThreadResult, LuaUserdata, LuaUserdataMetatable, LuaValue, LuaVector, type MemoryOptions, type ModuleResolver, type ModuleResolverContext, type ModuleSource, type OptimizationLevel, type Rest, type StackInfo, type StandardLibrary, type ThreadStatus, type UserdataBinaryMetamethod, type UserdataBinaryMetamethodName, type UserdataClass, type UserdataDefinition, type UserdataField, type UserdataMetamethod, type UserdataMethod, type UserdataMethodDefinition, type UserdataMethodOptions, type UserdataNamecall, type UserdataProxyDefinition, type UserdataSurface, exposeJsGlobals, field, from_lua_d_exports as fromLua, get, into_lua_d_exports as intoLua, metamethod, method, set, userdata };