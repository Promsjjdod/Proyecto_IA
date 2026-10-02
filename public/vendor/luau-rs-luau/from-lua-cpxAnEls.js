import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.js";
import { n as FROM_LUA_ACCEPTS_NIL, o as fromLuaNode, r as FROM_LUA_REST, t as FROM_LUA } from "./conversion-internal-BdlvMYCN.js";
//#region src/from-lua.ts
var from_lua_exports = /* @__PURE__ */ __exportAll({
	array: () => array,
	bytes: () => bytes,
	map: () => map,
	object: () => object,
	option: () => option,
	record: () => record,
	rest: () => rest,
	tuple: () => tuple
});
const bytes = descriptor({ kind: "bytes" });
function array(value) {
	return descriptor({
		kind: "array",
		value: decoder(value, "array value")
	});
}
function tuple(values) {
	if (!Array.isArray(values)) throw new TypeError("tuple values must be an array");
	return descriptor({
		kind: "tuple",
		values: Object.freeze(values.map((value, index) => decoder(value, `tuple value ${index + 1}`)))
	});
}
function map(key, value) {
	return descriptor({
		kind: "map",
		key: decoder(key, "map key"),
		value: decoder(value, "map value")
	});
}
function record(value) {
	return descriptor({
		kind: "record",
		value: decoder(value, "record value")
	});
}
function object(shape) {
	if (typeof shape !== "object" || shape === null || Array.isArray(shape) || Object.getPrototypeOf(shape) !== Object.prototype && Object.getPrototypeOf(shape) !== null) throw new TypeError("object shape must be a plain object");
	const fields = Object.fromEntries(Object.entries(shape).map(([name, value]) => [name, decoder(value, `object field ${name}`)]));
	return descriptor({
		kind: "object",
		fields: Object.freeze(fields)
	});
}
function option(value) {
	const decoded = decoder(value, "option value");
	if (acceptsNil(decoded)) throw new TypeError("option value is already optional");
	return nilDescriptor({
		kind: "option",
		value: decoded
	});
}
function rest(value) {
	return Object.freeze({ [FROM_LUA_REST]: Object.freeze({ value: decoder(value, "rest value") }) });
}
function descriptor(node) {
	return Object.freeze({ [FROM_LUA]: Object.freeze(node) });
}
function nilDescriptor(node) {
	return Object.freeze({
		[FROM_LUA]: Object.freeze(node),
		[FROM_LUA_ACCEPTS_NIL]: true
	});
}
function decoder(value, label) {
	if (fromLuaNode(value) !== void 0 || isConstructor(value)) return value;
	throw new TypeError(`${label} must be a FromLua decoder`);
}
function isConstructor(value) {
	if (value === BigInt) return true;
	if (typeof value !== "function") return false;
	try {
		Reflect.construct(Object, [], value);
		return true;
	} catch {
		return false;
	}
}
function acceptsNil(value) {
	return fromLuaNode(value)?.kind === "option";
}
//#endregion
export { object as a, rest as c, map as i, tuple as l, bytes as n, option as o, from_lua_exports as r, record as s, array as t };
