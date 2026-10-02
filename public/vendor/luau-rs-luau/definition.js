//#region src/definition.ts
const emptyPack = Object.freeze({ types: Object.freeze([]) });
function pack(...types) {
	return Object.freeze({ types: Object.freeze(types) });
}
function variadicPack(type) {
	return Object.freeze({
		types: Object.freeze([]),
		variadic: type
	});
}
function named(name) {
	return Object.freeze({
		kind: "named",
		name
	});
}
function raw(source) {
	return Object.freeze({
		kind: "raw",
		source
	});
}
function optional(value) {
	if (value === "nil" || typeof value === "object" && value.kind === "optional") return value;
	return Object.freeze({
		kind: "optional",
		value
	});
}
function array(value) {
	return Object.freeze({
		kind: "array",
		value
	});
}
function map(key, value) {
	return Object.freeze({
		kind: "map",
		key,
		value
	});
}
function record(properties) {
	return Object.freeze({
		kind: "record",
		properties: Object.freeze([...properties])
	});
}
function callable(signature) {
	return Object.freeze({
		kind: "function",
		signature
	});
}
function union(types) {
	const flattened = types.flatMap((type) => typeof type === "object" && type.kind === "union" ? type.types : [type]);
	const unique = [...new Map(flattened.map((type) => [JSON.stringify(type), type])).values()];
	if (unique.length === 0) return "never";
	if (unique.length === 1) return unique[0];
	return Object.freeze({
		kind: "union",
		types: Object.freeze(unique)
	});
}
function intersection(types) {
	const flattened = types.flatMap((type) => typeof type === "object" && type.kind === "intersection" ? type.types : [type]);
	const unique = [...new Map(flattened.map((type) => [JSON.stringify(type), type])).values()];
	if (unique.length === 0) return "unknown";
	if (unique.length === 1) return unique[0];
	return Object.freeze({
		kind: "intersection",
		types: Object.freeze(unique)
	});
}
function parameter(name, type) {
	return Object.freeze({
		name,
		type
	});
}
function property(name, type) {
	return Object.freeze({
		name,
		read: type,
		write: type
	});
}
function readWriteProperty(name, read, write) {
	return Object.freeze({
		name,
		read,
		write
	});
}
function readonlyProperty(name, type) {
	return Object.freeze({
		name,
		read: type
	});
}
function writeonlyProperty(name, type) {
	return Object.freeze({
		name,
		write: type
	});
}
var DefinitionFile = class {
	#externTypes = /* @__PURE__ */ new Map();
	#globals = /* @__PURE__ */ new Map();
	addExternType(type) {
		validateExternType(type);
		if (this.#externTypes.has(type.name)) throw new TypeError(`extern type ${type.name} is already defined`);
		this.#externTypes.set(type.name, type);
		return this;
	}
	addGlobal(name, type) {
		validateIdentifier(name);
		validateType(type);
		if (this.#globals.has(name)) throw new TypeError(`global ${name} is already defined`);
		this.#globals.set(name, type);
		return this;
	}
	toString() {
		for (const type of this.#externTypes.values()) validateExternType(type);
		for (const [name, type] of this.#globals) {
			validateIdentifier(name);
			validateType(type);
		}
		const output = [];
		const ordered = [];
		const visiting = /* @__PURE__ */ new Set();
		const emitted = /* @__PURE__ */ new Set();
		const visit = (type) => {
			if (emitted.has(type.name)) return;
			if (visiting.has(type.name)) throw new TypeError(`cyclic extern inheritance involving ${type.name}`);
			visiting.add(type.name);
			const parent = type.parent === void 0 ? void 0 : this.#externTypes.get(type.parent);
			if (parent !== void 0) visit(parent);
			visiting.delete(type.name);
			emitted.add(type.name);
			ordered.push(type);
		};
		for (const type of [...this.#externTypes.values()].sort((left, right) => compareStrings(left.name, right.name))) visit(type);
		for (const type of ordered) output.push(renderExternType(type), "");
		for (const [name, type] of [...this.#globals].sort(([left], [right]) => compareStrings(left, right))) output.push(`declare ${name}: ${renderType(type)}`);
		return output.length === 0 ? "" : `${output.join("\n")}\n`;
	}
};
function compareStrings(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
const RESERVED = /* @__PURE__ */ new Set([
	"and",
	"break",
	"do",
	"else",
	"elseif",
	"end",
	"false",
	"for",
	"function",
	"if",
	"in",
	"local",
	"nil",
	"not",
	"or",
	"repeat",
	"return",
	"then",
	"true",
	"until",
	"while"
]);
function validateIdentifier(name) {
	if (!/^[_A-Za-z][_A-Za-z0-9]*$/.test(name) || RESERVED.has(name)) throw new TypeError(`invalid Luau identifier ${JSON.stringify(name)}`);
}
function validateExternType(type) {
	validateIdentifier(type.name);
	if (type.parent !== void 0) validateIdentifier(type.parent);
	for (const property of type.properties ?? []) {
		validateProperty(property);
		if (!isIdentifier(property.name) && !(property.read !== void 0 && property.write === property.read)) throw new TypeError(`extern property ${JSON.stringify(property.name)} must be read-write`);
		if (property.read !== void 0 && typeContainsGenerics(property.read) || property.write !== void 0 && typeContainsGenerics(property.write)) throw new TypeError(`extern member ${property.name} cannot be generic`);
	}
	for (const method of type.methods ?? []) {
		validateIdentifier(method.name);
		validateSignature(method.signature);
		if (signatureContainsGenerics(method.signature)) throw new TypeError(`extern member ${method.name} cannot be generic`);
	}
	if (type.indexer !== void 0) {
		validateType(type.indexer[0]);
		validateType(type.indexer[1]);
		if (typeContainsGenerics(type.indexer[0]) || typeContainsGenerics(type.indexer[1])) throw new TypeError("extern indexer cannot be generic");
	}
}
function validateProperty(property) {
	if (property.read === void 0 && property.write === void 0) throw new TypeError(`property ${JSON.stringify(property.name)} has no type`);
	if (property.read !== void 0) validateType(property.read);
	if (property.write !== void 0) validateType(property.write);
}
function validateSignature(signature) {
	for (const generic of signature.generics ?? []) validateIdentifier(generic);
	for (const parameter of signature.parameters) validateType(parameter.type);
	if (signature.variadic !== void 0) validateType(signature.variadic);
	for (const type of signature.returns.types) validateType(type);
	if (signature.returns.variadic !== void 0) validateType(signature.returns.variadic);
}
function validateType(type) {
	if (typeof type === "string") return;
	switch (type.kind) {
		case "named":
			validateIdentifier(type.name);
			return;
		case "raw": return;
		case "optional":
		case "array":
			validateType(type.value);
			return;
		case "map":
			validateType(type.key);
			validateType(type.value);
			return;
		case "record":
			for (const property of type.properties) validateProperty(property);
			return;
		case "function":
			validateSignature(type.signature);
			return;
		case "union":
		case "intersection": for (const member of type.types) validateType(member);
	}
}
function signatureContainsGenerics(signature) {
	return (signature.generics?.length ?? 0) > 0 || signature.parameters.some((parameter) => typeContainsGenerics(parameter.type)) || signature.variadic !== void 0 && typeContainsGenerics(signature.variadic) || signature.returns.types.some(typeContainsGenerics) || signature.returns.variadic !== void 0 && typeContainsGenerics(signature.returns.variadic);
}
function typeContainsGenerics(type) {
	if (typeof type === "string") return false;
	switch (type.kind) {
		case "optional":
		case "array": return typeContainsGenerics(type.value);
		case "map": return typeContainsGenerics(type.key) || typeContainsGenerics(type.value);
		case "record": return type.properties.some((property) => property.read !== void 0 && typeContainsGenerics(property.read) || property.write !== void 0 && typeContainsGenerics(property.write));
		case "function": return signatureContainsGenerics(type.signature);
		case "union":
		case "intersection": return type.types.some(typeContainsGenerics);
		default: return false;
	}
}
function renderExternType(type) {
	const output = [`declare extern type ${type.name}${type.parent ? ` extends ${type.parent}` : ""} with`];
	for (const property of type.properties ?? []) if (property.read !== void 0 && property.write === property.read) output.push(`    ${renderPropertyName(property.name)}: ${renderType(property.read)}`);
	else {
		if (property.read !== void 0) output.push(`    read ${property.name}: ${renderType(property.read)}`);
		if (property.write !== void 0) output.push(`    write ${property.name}: ${renderType(property.write)}`);
	}
	for (const method of type.methods ?? []) {
		const parameters = renderParameters(method.signature, 1);
		output.push(`    function ${method.name}(self${parameters ? `, ${parameters}` : ""})${renderReturns(method.signature.returns)}`);
	}
	if (type.indexer !== void 0) output.push(`    [${renderType(type.indexer[0])}]: ${renderType(type.indexer[1])}`);
	output.push("end");
	return output.join("\n");
}
function renderType(type, parent = 0) {
	if (typeof type === "string") {
		if (type === "table") return "{[any]: any}";
		if (type === "function") return "(...any) -> ...any";
		return type;
	}
	const precedence = type.kind === "function" ? 1 : type.kind === "union" ? 2 : type.kind === "intersection" ? 3 : type.kind === "optional" ? 4 : 5;
	let rendered;
	switch (type.kind) {
		case "named":
			rendered = type.name;
			break;
		case "raw":
			rendered = type.source;
			break;
		case "optional":
			rendered = `${renderType(type.value, 4)}?`;
			break;
		case "array":
			rendered = `{${renderType(type.value)}}`;
			break;
		case "map":
			rendered = `{[${renderType(type.key)}]: ${renderType(type.value)}}`;
			break;
		case "record":
			rendered = `{${type.properties.map(renderTableProperty).join(", ")}}`;
			break;
		case "function":
			rendered = `${renderGenerics(type.signature.generics)}(${renderParameters(type.signature, 0)}) -> ${renderTypePack(type.signature.returns)}`;
			break;
		case "union":
			rendered = type.types.map((value) => renderType(value, 4)).join(" | ");
			break;
		case "intersection": rendered = type.types.map((value) => renderType(value, 5)).join(" & ");
	}
	return precedence < parent ? `(${rendered})` : rendered;
}
function renderTableProperty(property) {
	const name = renderPropertyName(property.name);
	if (property.read !== void 0 && property.write === property.read) return `${name}: ${renderType(property.read)}`;
	return [property.read === void 0 ? void 0 : `read ${name}: ${renderType(property.read)}`, property.write === void 0 ? void 0 : `write ${name}: ${renderType(property.write)}`].filter((value) => value !== void 0).join(", ");
}
function renderPropertyName(name) {
	return isIdentifier(name) ? name : `[${JSON.stringify(name)}]`;
}
function isIdentifier(name) {
	return /^[_A-Za-z][_A-Za-z0-9]*$/.test(name) && !RESERVED.has(name);
}
function sanitizeIdentifier(name) {
	const sanitized = name.replace(/[^_A-Za-z0-9]/g, "_");
	const prefixed = /^[_A-Za-z]/.test(sanitized) ? sanitized : `_${sanitized}`;
	return RESERVED.has(prefixed) ? `_${prefixed}` : prefixed;
}
function renderParameters(signature, style) {
	const parameters = signature.parameters.map((parameter, index) => {
		if (parameter.name !== void 0 && isIdentifier(parameter.name)) return `${parameter.name}: ${renderType(parameter.type)}`;
		return style === 1 ? `_arg${index + 1}: ${renderType(parameter.type)}` : renderType(parameter.type);
	});
	if (signature.variadic !== void 0) parameters.push(style === 1 ? `...: ${renderType(signature.variadic)}` : `...${renderType(signature.variadic)}`);
	return parameters.join(", ");
}
function renderGenerics(generics) {
	return generics === void 0 || generics.length === 0 ? "" : `<${generics.join(", ")}>`;
}
function renderReturns(returns) {
	return returns.types.length === 0 && returns.variadic === void 0 ? "" : `: ${renderTypePack(returns)}`;
}
function renderTypePack(typePack) {
	if (typePack.types.length === 1 && typePack.variadic === void 0) return renderType(typePack.types[0]);
	if (typePack.types.length === 0) return typePack.variadic === void 0 ? "()" : `...${renderType(typePack.variadic)}`;
	const types = typePack.types.map((type) => renderType(type));
	if (typePack.variadic !== void 0) types.push(`...${renderType(typePack.variadic)}`);
	return `(${types.join(", ")})`;
}
//#endregion
export { DefinitionFile, array, callable, emptyPack, intersection, isIdentifier, map, named, optional, pack, parameter, property, raw, readWriteProperty, readonlyProperty, record, sanitizeIdentifier, union, variadicPack, writeonlyProperty };
