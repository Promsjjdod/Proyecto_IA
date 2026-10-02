import { dirname, resolve } from "node:path";
import * as ts from "typescript";
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
//#region src/definition-generator.ts
function generateDefinitions(options) {
	const entry = resolve(options.entry);
	const config = loadConfig(options.project, entry);
	const program = ts.createProgram({
		rootNames: config.fileNames.includes(entry) ? config.fileNames : [...config.fileNames, entry],
		options: config.options,
		projectReferences: config.projectReferences
	});
	const diagnostics = ts.getPreEmitDiagnostics(program);
	if (diagnostics.length > 0) throw new TypeError(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost));
	const source = program.getSourceFile(entry);
	if (source === void 0) throw new TypeError(`TypeScript did not load ${entry}`);
	const checker = program.getTypeChecker();
	const module = checker.getSymbolAtLocation(source);
	if (module === void 0) throw new TypeError(`${entry} is not a module`);
	const exportName = options.exportName ?? "LuauGlobals";
	const exported = checker.getExportsOfModule(module).find((symbol) => symbol.name === exportName);
	if (exported === void 0) throw new TypeError(`${entry} does not export ${exportName}`);
	const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
	const root = symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface) ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? source);
	return new Generator(program, checker, source, new Set(options.expandTypes ?? [])).generate(root);
}
const diagnosticHost = {
	getCanonicalFileName: (fileName) => fileName,
	getCurrentDirectory: () => process.cwd(),
	getNewLine: () => "\n"
};
function loadConfig(project, entry) {
	const configPath = project === void 0 ? ts.findConfigFile(dirname(entry), ts.sys.fileExists) : resolve(project);
	if (configPath === void 0) return {
		options: {
			strict: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler
		},
		fileNames: [entry],
		errors: []
	};
	const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
	if (loaded.error !== void 0) throw new TypeError(ts.formatDiagnostic(loaded.error, diagnosticHost));
	const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath), void 0, configPath);
	if (parsed.errors.length > 0) throw new TypeError(ts.formatDiagnostics(parsed.errors, diagnosticHost));
	return parsed;
}
const BLOCKED_MEMBERS = /* @__PURE__ */ new Set([
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"__proto__",
	"arguments",
	"callee",
	"caller",
	"constructor",
	"prototype"
]);
const AUTO_EXPANSION_DEPTH = 1;
const MAX_SIGNATURE_SPECIALIZATIONS = 64;
var Generator = class {
	program;
	checker;
	source;
	expandedTypes;
	#file = new DefinitionFile();
	#names = /* @__PURE__ */ new Map();
	#externNames = /* @__PURE__ */ new Map();
	#usedNames = /* @__PURE__ */ new Set();
	#externDepths = /* @__PURE__ */ new Map();
	#pending = [];
	#convertingInput = /* @__PURE__ */ new Set();
	#convertingOutput = /* @__PURE__ */ new Set();
	#substitutions = /* @__PURE__ */ new Map();
	constructor(program, checker, source, expandedTypes) {
		this.program = program;
		this.checker = checker;
		this.source = source;
		this.expandedTypes = expandedTypes;
	}
	generate(root) {
		if (!(root.flags & ts.TypeFlags.Object)) throw new TypeError("the exported globals type must be an object");
		for (const symbol of this.checker.getPropertiesOfType(root)) {
			if (BLOCKED_MEMBERS.has(symbol.name)) continue;
			const type = this.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations?.[0] ?? this.source);
			this.#file.addGlobal(symbol.name, this.type(type, false, AUTO_EXPANSION_DEPTH));
		}
		const visitedDepths = /* @__PURE__ */ new Map();
		let changed = true;
		while (changed) {
			changed = false;
			for (const type of this.#pending) {
				const name = this.#names.get(type);
				if (name === void 0) throw new TypeError("unregistered extern type");
				const depth = this.#externDepths.get(name);
				if (depth === void 0 || (visitedDepths.get(name) ?? -1) >= depth) continue;
				visitedDepths.set(name, depth);
				this.externType(type);
				changed = true;
			}
		}
		for (const type of this.#pending) this.#file.addExternType(this.externType(type));
		return this.#file.toString();
	}
	type(type, eraseGenerics = false, expansionDepth = 0, direction = "output") {
		const substitution = this.#substitutions.get(type);
		if (substitution !== void 0) return this.type(substitution, eraseGenerics, expansionDepth, direction);
		if (type.flags & ts.TypeFlags.IndexedAccess) {
			const indexed = type;
			const index = this.#substitutions.get(indexed.indexType) ?? indexed.indexType;
			if (index.isStringLiteral()) {
				const property = this.checker.getPropertyOfType(indexed.objectType, index.value);
				if (property !== void 0) {
					const propertyType = this.checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations?.[0] ?? this.source);
					return this.type(propertyType, eraseGenerics, expansionDepth, direction);
				}
			}
		}
		const converting = direction === "input" ? this.#convertingInput : this.#convertingOutput;
		if (converting.has(type)) {
			if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) return array("table");
			if (type.flags & ts.TypeFlags.Object) {
				const symbol = type.aliasSymbol ?? type.getSymbol();
				if (symbol?.name === "Promise" || symbol?.name === "PromiseLike") return "any";
				if (symbol?.name === "Map" || symbol?.name === "ReadonlyMap") return map("any", "any");
				if (symbol !== void 0 && isNominalSymbol(symbol)) {
					if (direction === "input" && !this.hasRuntimeConstructor(symbol)) return "table";
					return named(this.queueExtern(type, symbol, direction === "input" && this.isLibrarySymbol(symbol) ? 0 : expansionDepth));
				}
			}
			return "table";
		}
		converting.add(type);
		try {
			return this.#convertType(type, eraseGenerics, expansionDepth, direction);
		} finally {
			converting.delete(type);
		}
	}
	#convertType(type, eraseGenerics, expansionDepth, direction) {
		if (type.flags & ts.TypeFlags.Any) return "any";
		if (type.flags & ts.TypeFlags.Unknown) return "unknown";
		if (type.flags & ts.TypeFlags.Never) return "never";
		if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) return "nil";
		if (type.flags & ts.TypeFlags.BooleanLike) {
			if (type.flags & ts.TypeFlags.BooleanLiteral) return raw(this.checker.typeToString(type));
			return "boolean";
		}
		if (type.flags & ts.TypeFlags.StringLike) return type.isStringLiteral() ? raw(JSON.stringify(type.value)) : "string";
		if (type.flags & ts.TypeFlags.NumberLike) return "number";
		if (type.flags & ts.TypeFlags.BigIntLike) return "integer";
		if (type.isUnion()) {
			const nonNil = type.types.filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
			if (nonNil.length === 1 && nonNil.length < type.types.length) return optional(this.type(nonNil[0], eraseGenerics, expansionDepth, direction));
			return union(type.types.map((member) => this.type(member, eraseGenerics, expansionDepth, direction)));
		}
		if (type.isIntersection()) return intersection(type.types.map((member) => this.type(member, eraseGenerics, expansionDepth, direction)));
		if (type.flags & ts.TypeFlags.TypeParameter) return eraseGenerics ? "any" : named(this.checker.typeToString(type));
		if (!(type.flags & ts.TypeFlags.Object)) return "any";
		if (this.checker.typeToString(type) === "typeof globalThis") return "table";
		if (this.checker.isArrayType(type)) {
			const element = typeArguments(type)[0];
			return array(element === void 0 ? "any" : this.type(element, eraseGenerics, expansionDepth, direction));
		}
		if (this.checker.isTupleType(type)) {
			const elements = typeArguments(type).map((element) => this.type(element, eraseGenerics, expansionDepth, direction));
			return array(elements.length === 1 ? elements[0] : union(elements));
		}
		const symbol = type.aliasSymbol ?? type.getSymbol();
		const symbolName = symbol?.name;
		const args = typeArguments(type);
		if (symbolName === "Uint8Array") return "string";
		if (symbolName === "LuaBuffer") return "buffer";
		if (symbolName === "LuaFunction") return "function";
		if (symbolName === "LuaTable") return "table";
		if (symbolName === "LuaThread") return "thread";
		if (symbolName === "LuaVector") return "vector";
		if (symbolName === "LuaValue") return "any";
		if (symbolName === "Promise" || symbolName === "PromiseLike") return "any";
		if (symbolName === "Map" || symbolName === "ReadonlyMap") return map(args[0] === void 0 ? "any" : this.type(args[0], eraseGenerics, expansionDepth, direction), args[1] === void 0 ? "any" : this.type(args[1], eraseGenerics, expansionDepth, direction));
		const calls = type.getCallSignatures();
		const constructors = type.getConstructSignatures();
		const properties = this.visibleProperties(type);
		if (constructors.length > 0) {
			const constructorTypes = deduplicateSignatures(constructors.flatMap((signature) => this.signatures(signature, {
				eraseGenerics,
				parameterExpansionDepth: expansionDepth,
				returnExpansionDepth: expansionDepth,
				direction
			}))).map(callable);
			const constructor = constructorTypes.length === 1 ? constructorTypes[0] : intersection(constructorTypes);
			if (symbol !== void 0 && hasDecorator(symbol, this.checker, "userdata")) return properties.length === 0 ? constructor : intersection([constructor, this.record(properties, eraseGenerics, expansionDepth)]);
			return record([readonlyProperty("new", constructor), ...properties.filter((property) => property.name !== "new").map((property) => this.property(property, eraseGenerics, expansionDepth))]);
		}
		if (calls.length > 0 && properties.length === 0) {
			const signatures = deduplicateSignatures(calls.flatMap((signature) => this.signatures(signature, {
				eraseGenerics,
				parameterExpansionDepth: expansionDepth,
				returnExpansionDepth: expansionDepth,
				direction
			}))).map(callable);
			return signatures.length === 1 ? signatures[0] : intersection(signatures);
		}
		if (symbol !== void 0 && isNominalSymbol(symbol)) {
			const expandedDepth = this.expansionDepthFor(symbol, expansionDepth);
			if (direction === "input" && expandedDepth > 0 && !this.hasRuntimeConstructor(symbol)) return this.inputRecord(properties, eraseGenerics, nextExpansionDepth(expandedDepth));
			if (direction === "input" && !this.hasRuntimeConstructor(symbol)) return "table";
			return named(this.queueExtern(type, symbol, direction === "input" && this.isLibrarySymbol(symbol) ? 0 : expansionDepth));
		}
		return direction === "input" ? this.inputRecord(properties, eraseGenerics, expansionDepth) : this.record(properties, eraseGenerics, expansionDepth);
	}
	signatures(signature, conversion = {}) {
		const specializations = this.signatureSpecializations(signature);
		if (specializations.length === 0) return [this.signature(signature, conversion)];
		return specializations.map((specialization) => {
			const previous = this.#substitutions;
			this.#substitutions = new Map([...previous, ...specialization]);
			try {
				return this.signature(signature, conversion);
			} finally {
				this.#substitutions = previous;
			}
		});
	}
	signature(signature, { includeSelf, eraseGenerics = false, parameterExpansionDepth = 0, returnExpansionDepth = parameterExpansionDepth, direction = "output" } = {}) {
		const typeParameters = signature.typeParameters?.filter((type) => !this.#substitutions.has(type));
		const generics = eraseGenerics || typeParameters?.length === 0 ? void 0 : typeParameters?.map((type) => sanitizeIdentifier(type.symbol.name));
		const parameters = [];
		let variadic;
		const parameterDirection = direction === "output" ? "input" : "output";
		if (includeSelf !== void 0) parameters.push(parameter("self", includeSelf));
		for (const symbol of signature.getParameters()) {
			const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
			let type = this.checker.getTypeOfSymbolAtLocation(symbol, declaration ?? this.source);
			if (declaration !== void 0 && ts.isParameter(declaration) && declaration.dotDotDotToken) {
				variadic = this.type(typeArguments(type)[0] ?? type, eraseGenerics, parameterExpansionDepth, parameterDirection);
				continue;
			}
			let converted = this.type(type, eraseGenerics, parameterExpansionDepth, parameterDirection);
			if (symbol.flags & ts.SymbolFlags.Optional || declaration !== void 0 && ts.isParameter(declaration) && (declaration.questionToken !== void 0 || declaration.initializer !== void 0)) converted = optional(converted);
			parameters.push(parameter(symbol.name, converted));
		}
		return {
			...generics === void 0 ? {} : { generics },
			parameters,
			...variadic === void 0 ? {} : { variadic },
			returns: this.returnPack(signature.getReturnType(), eraseGenerics, returnExpansionDepth, direction)
		};
	}
	signatureSpecializations(signature) {
		const candidates = (signature.typeParameters ?? []).flatMap((parameter) => {
			const constraint = this.checker.getBaseConstraintOfType(parameter);
			const members = constraint?.isUnion() ? constraint.types : [constraint];
			if (members.length === 0 || members.some((member) => member === void 0 || !(member.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.BooleanLiteral)))) return [];
			return [{
				parameter,
				members
			}];
		});
		if (candidates.length === 0) return [];
		let specializations = [/* @__PURE__ */ new Map()];
		for (const { parameter, members } of candidates) {
			if (specializations.length * members.length > MAX_SIGNATURE_SPECIALIZATIONS) return [];
			specializations = specializations.flatMap((specialization) => members.map((member) => new Map([...specialization, [parameter, member]])));
		}
		return specializations;
	}
	returnPack(type, eraseGenerics = false, expansionDepth = 0, direction = "output") {
		if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return emptyPack;
		if (direction === "input" && type.flags & ts.TypeFlags.Any) return variadicPack("any");
		const symbol = type.aliasSymbol ?? type.getSymbol();
		if (symbol?.name === "Promise" || symbol?.name === "PromiseLike") {
			const awaited = typeArguments(type)[0];
			return awaited === void 0 ? pack("any") : this.returnPack(awaited, eraseGenerics, expansionDepth, direction);
		}
		return pack(this.type(type, eraseGenerics, expansionDepth, direction));
	}
	record(symbols, eraseGenerics = false, expansionDepth = 0) {
		return record(symbols.map((symbol) => this.property(symbol, eraseGenerics, expansionDepth)));
	}
	inputRecord(symbols, eraseGenerics = false, expansionDepth = 0) {
		return record(symbols.map((symbol) => this.inputProperty(symbol, eraseGenerics, expansionDepth)));
	}
	property(symbol, eraseGenerics = false, readExpansionDepth = 0, writeExpansionDepth = readExpansionDepth) {
		const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
		const readDeclaration = symbol.declarations?.find(ts.isGetAccessorDeclaration);
		const writeDeclaration = symbol.declarations?.find(ts.isSetAccessorDeclaration);
		let read = this.checker.getTypeOfSymbolAtLocation(symbol, readDeclaration ?? declaration ?? this.source);
		let write = writeDeclaration?.parameters[0] === void 0 ? read : this.checker.getTypeAtLocation(writeDeclaration.parameters[0]);
		if (symbol.flags & ts.SymbolFlags.Optional) {
			read = this.checker.getNonNullableType(read);
			write = this.checker.getNonNullableType(write);
		}
		let convertedRead = this.type(read, eraseGenerics, readExpansionDepth, "output");
		let convertedWrite = this.type(write, eraseGenerics, writeExpansionDepth, "input");
		if (symbol.flags & ts.SymbolFlags.Optional) {
			convertedRead = optional(convertedRead);
			convertedWrite = optional(convertedWrite);
		}
		const access = propertyAccess(symbol);
		if (access === "read") return readonlyProperty(symbol.name, convertedRead);
		if (access === "write") return writeonlyProperty(symbol.name, convertedWrite);
		return sameLuauType(convertedRead, convertedWrite) ? property(symbol.name, convertedRead) : readWriteProperty(symbol.name, convertedRead, convertedWrite);
	}
	inputProperty(symbol, eraseGenerics = false, expansionDepth = 0) {
		const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
		const writeDeclaration = symbol.declarations?.find(ts.isSetAccessorDeclaration);
		let type = writeDeclaration?.parameters[0] === void 0 ? this.checker.getTypeOfSymbolAtLocation(symbol, declaration ?? this.source) : this.checker.getTypeAtLocation(writeDeclaration.parameters[0]);
		if (symbol.flags & ts.SymbolFlags.Optional) type = this.checker.getNonNullableType(type);
		let converted = this.type(type, eraseGenerics, expansionDepth, "input");
		if (symbol.flags & ts.SymbolFlags.Optional) converted = optional(converted);
		return readonlyProperty(symbol.name, converted);
	}
	externType(type) {
		const name = this.#names.get(type);
		if (name === void 0) throw new TypeError("unregistered extern type");
		const expansionDepth = this.#externDepths.get(name);
		if (expansionDepth === void 0) return { name };
		const memberExpansionDepth = nextExpansionDepth(expansionDepth);
		const target = type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference ? type.target : void 0;
		const base = (type.getBaseTypes() ?? target?.getBaseTypes())?.find((candidate) => {
			const symbol = candidate.aliasSymbol ?? candidate.getSymbol();
			return symbol !== void 0 && isNominalSymbol(symbol) && !typeArguments(candidate).some((argument) => argument.flags & ts.TypeFlags.TypeParameter);
		});
		const inherited = new Set(base === void 0 ? [] : this.checker.getPropertiesOfType(base));
		const properties = [];
		const methods = [];
		for (const symbol of this.visibleProperties(type)) {
			if (inherited.has(symbol)) continue;
			const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
			const signatures = deduplicateSignatures(this.checker.getTypeOfSymbolAtLocation(symbol, declaration ?? this.source).getCallSignatures().flatMap((signature) => this.signatures(signature, {
				eraseGenerics: true,
				parameterExpansionDepth: Math.max(memberExpansionDepth, 1),
				returnExpansionDepth: memberExpansionDepth
			})));
			if (signatures.length > 0 && isMethodSymbol(symbol) && isIdentifier(symbol.name)) for (const signature of signatures) methods.push({
				name: symbol.name,
				signature
			});
			else {
				const property = this.property(symbol, true, memberExpansionDepth, Math.max(memberExpansionDepth, 1));
				if (isIdentifier(property.name) || property.read !== void 0 && property.write === property.read) properties.push(property);
			}
		}
		const stringIndex = this.checker.getIndexTypeOfType(type, ts.IndexKind.String);
		const numberIndex = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
		const parent = base === void 0 ? void 0 : this.type(base, false, expansionDepth);
		const indexer = stringIndex === void 0 && numberIndex === void 0 ? void 0 : [stringIndex !== void 0 && numberIndex !== void 0 ? union(["string", "number"]) : stringIndex !== void 0 ? "string" : "number", stringIndex !== void 0 && numberIndex !== void 0 ? union([this.type(stringIndex, true, memberExpansionDepth), this.type(numberIndex, true, memberExpansionDepth)]) : this.type(stringIndex ?? numberIndex, true, memberExpansionDepth)];
		return {
			name,
			...typeof parent === "object" && parent.kind === "named" ? { parent: parent.name } : {},
			properties,
			methods,
			...indexer === void 0 ? {} : { indexer }
		};
	}
	queueExtern(type, symbol, expansionDepth = 0) {
		const expandedDepth = this.expansionDepthFor(symbol, expansionDepth);
		const existing = this.#names.get(type);
		if (existing !== void 0) {
			this.expandExtern(existing, expandedDepth);
			return existing;
		}
		const args = typeArguments(type);
		const formattedArgs = args.map((value) => this.checker.typeToString(value, this.source, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType));
		const identity = `${this.checker.getFullyQualifiedName(symbol)}<${formattedArgs.join(",")}>`;
		const existingExtern = this.#externNames.get(identity);
		if (existingExtern !== void 0) {
			this.#names.set(type, existingExtern);
			this.expandExtern(existingExtern, expandedDepth);
			return existingExtern;
		}
		const suffix = args.length === 0 ? "" : `_${hash(formattedArgs.join(","))}`;
		const base = `${sanitizeIdentifier(symbol.name)}${suffix}`;
		let name = base;
		if (this.#usedNames.has(name)) {
			name = `${base}_${hash(this.checker.getFullyQualifiedName(symbol))}`;
			for (let index = 2; this.#usedNames.has(name); index++) name = `${base}_${index}`;
		}
		this.#names.set(type, name);
		this.#externNames.set(identity, name);
		this.#usedNames.add(name);
		this.expandExtern(name, expandedDepth);
		this.#pending.push(type);
		return name;
	}
	expansionDepthFor(symbol, requested) {
		if (!this.isLibrarySymbol(symbol)) return Number.POSITIVE_INFINITY;
		return this.isExplicitlyExpanded(symbol) ? Math.max(requested, 1) : requested;
	}
	expandExtern(name, depth) {
		if (depth <= 0) return;
		const previous = this.#externDepths.get(name);
		if (previous === void 0 || previous < depth) this.#externDepths.set(name, depth);
	}
	isLibrarySymbol(symbol) {
		const declarations = symbol.declarations;
		return declarations !== void 0 && declarations.length > 0 && declarations.every((declaration) => {
			const source = declaration.getSourceFile();
			return this.program.isSourceFileDefaultLibrary(source) || this.program.isSourceFileFromExternalLibrary(source);
		});
	}
	isExplicitlyExpanded(symbol) {
		return this.expandedTypes.has(symbol.name) || this.expandedTypes.has(this.checker.getFullyQualifiedName(symbol));
	}
	hasRuntimeConstructor(symbol) {
		const value = this.checker.resolveName(symbol.name, this.source, ts.SymbolFlags.Value, false);
		if (value === void 0) return false;
		return this.checker.getTypeOfSymbolAtLocation(value, value.valueDeclaration ?? this.source).getConstructSignatures().length > 0;
	}
	visibleProperties(type) {
		const properties = this.checker.getPropertiesOfType(type).filter((property) => !BLOCKED_MEMBERS.has(property.name) && !property.name.startsWith("#") && !property.name.startsWith("__@") && !property.declarations?.some((declaration) => ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)));
		const symbol = type.aliasSymbol ?? type.getSymbol();
		if (symbol === void 0 || !hasDecorator(symbol, this.checker, "userdata")) return properties;
		return properties.filter((property) => [
			"field",
			"get",
			"set",
			"method",
			"metamethod"
		].some((name) => hasDecorator(property, this.checker, name)));
	}
};
function deduplicateSignatures(signatures) {
	const unique = /* @__PURE__ */ new Map();
	for (const signature of signatures) {
		const key = JSON.stringify({
			generics: signature.generics,
			parameters: signature.parameters.map((parameter) => parameter.type),
			variadic: signature.variadic,
			returns: signature.returns
		});
		if (!unique.has(key)) unique.set(key, signature);
	}
	return [...unique.values()];
}
function sameLuauType(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
function nextExpansionDepth(depth) {
	return Number.isFinite(depth) ? Math.max(0, depth - 1) : depth;
}
function typeArguments(type) {
	return type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference ? type.typeArguments ?? [] : [];
}
function isNominalSymbol(symbol) {
	return Boolean(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.TypeAlias)) && !symbol.name.startsWith("__");
}
function isMethodSymbol(symbol) {
	return symbol.declarations?.some((declaration) => ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) ?? false;
}
function hasDecorator(symbol, checker, expected) {
	for (const declaration of symbol.declarations ?? []) {
		if (!ts.canHaveDecorators(declaration)) continue;
		for (const decorator of ts.getDecorators(declaration) ?? []) {
			const expression = ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression;
			const names = [];
			if (ts.isIdentifier(expression)) {
				const resolved = checker.getSymbolAtLocation(expression);
				if (resolved !== void 0) names.push(resolved.name);
				for (const declaration of resolved?.declarations ?? []) if (ts.isImportSpecifier(declaration)) names.push((declaration.propertyName ?? declaration.name).text);
			} else if (ts.isPropertyAccessExpression(expression)) names.push(expression.name.text);
			if (names.includes(expected)) return true;
		}
	}
	return false;
}
function propertyAccess(symbol) {
	const declarations = symbol.declarations ?? [];
	const getter = declarations.some(ts.isGetAccessorDeclaration);
	const setter = declarations.some(ts.isSetAccessorDeclaration);
	if (getter && !setter) return "read";
	if (setter && !getter) return "write";
	if (declarations.some((declaration) => ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword))) return "read";
	return "readwrite";
}
function hash(value) {
	let result = 2166136261;
	for (let index = 0; index < value.length; index++) {
		result ^= value.charCodeAt(index);
		result = Math.imul(result, 16777619);
	}
	return (result >>> 0).toString(36);
}
//#endregion
export { generateDefinitions as t };
