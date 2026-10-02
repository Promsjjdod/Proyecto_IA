//#region src/conversion-internal.ts
const FROM_LUA = Symbol("FromLua");
const FROM_LUA_ACCEPTS_NIL = Symbol("FromLua.acceptsNil");
const FROM_LUA_REST = Symbol("FromLua.rest");
const INTO_LUA = Symbol("IntoLua");
const INTO_LUA_MULTIPLE = Symbol("IntoLua.multiple");
function fromLuaNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[FROM_LUA];
}
function fromLuaRestNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[FROM_LUA_REST];
}
function intoLuaNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[INTO_LUA];
}
function intoLuaMultipleValues(value) {
	if (typeof value !== "object" || value === null) return void 0;
	return value[INTO_LUA_MULTIPLE];
}
//#endregion
export { INTO_LUA_MULTIPLE as a, intoLuaMultipleValues as c, INTO_LUA as i, intoLuaNode as l, FROM_LUA_ACCEPTS_NIL as n, fromLuaNode as o, FROM_LUA_REST as r, fromLuaRestNode as s, FROM_LUA as t };
