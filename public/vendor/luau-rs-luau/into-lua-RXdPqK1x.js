import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.js";
import { a as INTO_LUA_MULTIPLE, i as INTO_LUA, o as fromLuaNode, s as fromLuaRestNode } from "./conversion-internal-BdlvMYCN.js";
//#region src/from-lua-signature.ts
function fromLuaSignatures(value, label) {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	if (value.length > 0 && Array.isArray(value[0])) return value.map((signature, index) => {
		if (!Array.isArray(signature)) throw new TypeError(`${label} cannot mix arguments and overloads`);
		return fromLuaSignature(signature, `${label}[${index}]`);
	});
	if (value.some(Array.isArray)) throw new TypeError(`${label} cannot mix arguments and overloads`);
	return fromLuaSignature(value, label);
}
function signatureList(signatures) {
	return isOverloaded(signatures) ? signatures : [signatures];
}
function signatureAcceptsCount(signature, count) {
	const hasRest = fromLuaRestNode(signature.at(-1)) !== void 0;
	const fixed = hasRest ? signature.length - 1 : signature.length;
	let required = fixed;
	while (required > 0 && acceptsNil(signature[required - 1])) required--;
	return count >= required && (hasRest || count <= fixed);
}
function isFromLuaType(value) {
	return fromLuaNode(value) !== void 0 || isConstructor(value);
}
function acceptsNil(value) {
	return fromLuaNode(value)?.kind === "option";
}
function fromLuaSignature(value, label) {
	let optional = false;
	let rest = false;
	return value.map((item, index) => {
		const restNode = fromLuaRestNode(item);
		if (restNode) {
			if (index !== value.length - 1) throw new TypeError(`${label}[${index}] rest argument must be last`);
			if (optional) throw new TypeError(`${label}[${index}] cannot follow an optional argument`);
			if (!isFromLuaType(restNode.value)) throw new TypeError(`${label}[${index}] has an invalid rest decoder`);
			rest = true;
			return item;
		}
		if (rest || !isFromLuaType(item)) throw new TypeError(`${label}[${index}] must be a FromLua decoder`);
		if (acceptsNil(item)) optional = true;
		else if (optional) throw new TypeError(`${label}[${index}] cannot follow an optional argument`);
		return item;
	});
}
function isOverloaded(signatures) {
	return signatures.length > 0 && Array.isArray(signatures[0]);
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
//#endregion
//#region src/into-lua.ts
var into_lua_exports = /* @__PURE__ */ __exportAll({
	buffer: () => buffer,
	callback: () => callback,
	multiple: () => multiple,
	userdata: () => userdata
});
function buffer(bytes) {
	if (!(bytes instanceof Uint8Array)) throw new TypeError("buffer value must be a Uint8Array");
	return descriptor({
		kind: "buffer",
		bytes: bytes.slice()
	});
}
function userdata(value) {
	if ((typeof value !== "object" || value === null) && typeof value !== "function") throw new TypeError("userdata value must be an object or function");
	return descriptor({
		kind: "userdata",
		value
	});
}
function callback(callback, args) {
	if (typeof callback !== "function") throw new TypeError("callback value must be a function");
	return descriptor({
		kind: "callback",
		callback,
		args: args === void 0 ? void 0 : fromLuaSignatures(args, "callback arguments")
	});
}
function multiple(...values) {
	return Object.freeze({ [INTO_LUA_MULTIPLE]: Object.freeze(values.slice()) });
}
function descriptor(node) {
	return Object.freeze({ [INTO_LUA]: Object.freeze(node) });
}
//#endregion
export { userdata as a, isFromLuaType as c, multiple as i, signatureAcceptsCount as l, callback as n, acceptsNil as o, into_lua_exports as r, fromLuaSignatures as s, buffer as t, signatureList as u };
