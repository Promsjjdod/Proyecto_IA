import { array, boolean, check, maxValue, minValue, nonEmpty, number, object, optional, picklist, pipe, safeInteger, safeParse, string, union } from "valibot";
//#region src/utf8.ts
function isWellFormedString(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 55296 && code <= 56319) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 56320 && next <= 57343)) return false;
			index += 1;
		} else if (code >= 56320 && code <= 57343) return false;
	}
	return true;
}
//#endregion
//#region src/analysis-schema.ts
const WellFormedString = check(isWellFormedString, "JavaScript string contains an unpaired surrogate");
const AnalysisModuleNameSchema = pipe(string("module name must be a string"), WellFormedString, nonEmpty("module name must be a non-empty string"));
const AnalysisModeSchema = picklist([
	"nocheck",
	"nonstrict",
	"strict"
], "analysis mode must be 'nocheck', 'nonstrict', or 'strict'");
const AnalysisLintSchema = boolean("lint must be a boolean");
const AnalysisModuleKindSchema = picklist(["module", "script"], "module kind must be 'module' or 'script'");
const AnalysisGlobalsSchema = array(pipe(string(), WellFormedString, nonEmpty("globals must contain only non-empty strings")), "globals must contain only non-empty strings");
const AnalysisPositionSchema = object({
	line: pipe(number(), safeInteger(), minValue(0), maxValue(4294967295)),
	column: pipe(number(), safeInteger(), minValue(0), maxValue(4294967295))
}, "position must contain non-negative line and column values");
const AnalysisInspectionSchema = object({
	name: optional(string()),
	type: string()
});
const AnalysisModuleSchema = object({
	name: AnalysisModuleNameSchema,
	source: pipe(string("module source must be a string"), WellFormedString),
	kind: optional(AnalysisModuleKindSchema),
	environment: optional(AnalysisModuleNameSchema)
}, "module must be an object");
const AnalysisDefinitionSchema = object({
	name: AnalysisModuleNameSchema,
	source: pipe(string("definition source must be a string"), WellFormedString),
	environment: optional(AnalysisModuleNameSchema)
}, "definition must be an object");
const AnalysisTypeStringOptionsSchema = object({
	maxTableLength: optional(pipe(number(), safeInteger(), minValue(0), maxValue(2147483647))),
	maxTypeLength: optional(pipe(number(), safeInteger(), minValue(0), maxValue(2147483647)))
}, "typeString must contain non-negative length limits");
const AnalysisOptionsSchema = object({
	mode: optional(AnalysisModeSchema),
	lint: optional(AnalysisLintSchema),
	globals: optional(AnalysisGlobalsSchema),
	modules: optional(array(AnalysisModuleSchema, "modules must be an array")),
	definitions: optional(array(AnalysisDefinitionSchema, "definitions must be an array")),
	typeString: optional(AnalysisTypeStringOptionsSchema)
}, "analysis options must be an object");
const AnalysisLocationSchema = object({
	begin: AnalysisPositionSchema,
	end: AnalysisPositionSchema
});
const AnalysisDiagnosticSchema = object({
	kind: picklist(["type", "lint"]),
	severity: picklist(["error", "warning"]),
	module: string(),
	location: AnalysisLocationSchema,
	message: string(),
	code: union([pipe(number(), safeInteger()), string()])
});
const AnalysisCheckResultSchema = object({
	diagnostics: array(AnalysisDiagnosticSchema),
	timeoutModules: array(string())
});
const AnalysisModuleCheckResultSchema = object({
	name: AnalysisModuleNameSchema,
	result: AnalysisCheckResultSchema
});
const AutocompleteEntrySchema = object({
	label: string(),
	kind: picklist([
		"property",
		"binding",
		"keyword",
		"string",
		"type",
		"module",
		"generatedFunction",
		"requirePath",
		"hotComment"
	]),
	type: optional(string()),
	deprecated: boolean(),
	wrongIndexType: boolean(),
	typeCorrect: picklist([
		"none",
		"correct",
		"correctFunctionResult"
	]),
	parentheses: picklist([
		"none",
		"cursorAfter",
		"cursorInside"
	]),
	insertText: optional(string()),
	indexedWithSelf: boolean(),
	replaceDotWithColon: boolean(),
	documentationSymbol: optional(string()),
	tags: array(string())
});
const AutocompleteResultSchema = object({
	context: picklist([
		"unknown",
		"expression",
		"statement",
		"property",
		"type",
		"keyword",
		"string",
		"hotComment"
	]),
	entries: array(AutocompleteEntrySchema)
});
const FragmentAutocompleteResultSchema = object({
	status: picklist([
		"success",
		"fallback",
		"internalError"
	]),
	result: optional(AutocompleteResultSchema)
});
const OptionalStringSchema = optional(string());
function parseAnalysisInput(schema, value) {
	const result = safeParse(schema, value, {
		abortEarly: true,
		abortPipeEarly: true
	});
	if (!result.success) throw new TypeError(result.issues[0].message);
	return result.output;
}
function parseAnalysisResult(action, value) {
	switch (action) {
		case "check": return parseAnalysisInput(AnalysisCheckResultSchema, value);
		case "checkModules": return parseAnalysisInput(array(AnalysisModuleCheckResultSchema), value);
		case "autocomplete": return parseAnalysisInput(AutocompleteResultSchema, value);
		case "fragmentAutocomplete": return parseAnalysisInput(FragmentAutocompleteResultSchema, value);
		case "typeAt":
		case "expectedTypeAt":
		case "decorateWithTypes":
		case "documentationSymbolAt":
		case "moduleReturnType": return parseAnalysisInput(OptionalStringSchema, value);
		case "inspectAt": return parseAnalysisInput(optional(AnalysisInspectionSchema), value);
		case "requiredModules": return parseAnalysisInput(array(string()), value);
	}
}
//#endregion
//#region src/analysis-api.ts
let initialization;
function initializeAnalysisBindings() {
	return initialization ??= import("./luau_analysis_wasm-C4I62KeM.js").then((bindings) => {
		const initialize = bindings.initializeAnalysisBindings;
		return initialize === void 0 ? bindings : initialize();
	});
}
var Analysis = class Analysis {
	#state;
	constructor(state) {
		this.#state = state;
	}
	get state() {
		if (this.#state === void 0) throw new Error("analysis was disposed");
		return this.#state;
	}
	static async create(options = {}) {
		const validated = parseAnalysisInput(AnalysisOptionsSchema, options);
		const bindings = await initializeAnalysisBindings();
		const analysis = new Analysis(new bindings.WasmAnalysis(validated.mode ?? "nonstrict", validated.lint ?? false, validated.globals ?? [], validated.typeString?.maxTableLength, validated.typeString?.maxTypeLength));
		for (const definition of validated.definitions ?? []) analysis.addDefinition(definition.name, definition.source, definition.environment);
		for (const module of validated.modules ?? []) analysis.setModule(module.name, module.source, module.kind, module.environment);
		return analysis;
	}
	setMode(mode) {
		this.state.setMode(parseAnalysisInput(AnalysisModeSchema, mode));
	}
	setLint(enabled) {
		this.state.setLint(parseAnalysisInput(AnalysisLintSchema, enabled));
	}
	setGlobals(globals) {
		this.state.setGlobals(parseAnalysisInput(AnalysisGlobalsSchema, globals));
	}
	setModule(name, source, kind = "module", environment) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source,
			kind,
			environment
		});
		this.state.setModule(module.name, module.source, module.kind ?? "module", module.environment);
	}
	addDefinition(name, source, environment) {
		const definition = parseAnalysisInput(AnalysisDefinitionSchema, {
			name,
			source,
			environment
		});
		this.state.addDefinition(definition.name, definition.source, definition.environment);
	}
	deleteModule(name) {
		return this.state.deleteModule(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	clearModules() {
		this.state.clearModules();
	}
	check(name) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		return parseAnalysisResult("check", this.state.check(module));
	}
	checkModules(names) {
		const modules = names.map((name) => parseAnalysisInput(AnalysisModuleNameSchema, name));
		return parseAnalysisResult("checkModules", this.state.checkModules(modules));
	}
	autocomplete(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("autocomplete", this.state.autocomplete(module, at.line, at.column));
	}
	fragmentAutocomplete(name, source, position) {
		const module = parseAnalysisInput(AnalysisModuleSchema, {
			name,
			source
		});
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("fragmentAutocomplete", this.state.fragmentAutocomplete(module.name, module.source, at.line, at.column));
	}
	typeAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.typeAt(module, at.line, at.column);
	}
	expectedTypeAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.expectedTypeAt(module, at.line, at.column);
	}
	inspectAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return parseAnalysisResult("inspectAt", this.state.inspectAt(module, at.line, at.column));
	}
	decorateWithTypes(name) {
		return this.state.decorateWithTypes(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	documentationSymbolAt(name, position) {
		const module = parseAnalysisInput(AnalysisModuleNameSchema, name);
		const at = parseAnalysisInput(AnalysisPositionSchema, position);
		return this.state.documentationSymbolAt(module, at.line, at.column);
	}
	moduleReturnType(name) {
		return this.state.moduleReturnType(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	requiredModules(name) {
		return this.state.requiredModules(parseAnalysisInput(AnalysisModuleNameSchema, name));
	}
	/** @internal */
	beginOperation() {
		this.state.beginOperation();
	}
	/** @internal */
	takeModuleRequests() {
		return this.state.takeModuleRequests();
	}
	/** @internal */
	resolveModuleRequest(request, module) {
		this.state.resolveModule(request.from, request.specifier, module?.name, module?.source, module?.kind, module?.environment);
	}
	[Symbol.dispose]() {
		const state = this.#state;
		if (state === void 0) return;
		this.#state = void 0;
		state.free();
	}
};
//#endregion
export { Analysis };
