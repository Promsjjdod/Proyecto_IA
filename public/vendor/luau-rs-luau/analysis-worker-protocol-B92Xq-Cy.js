import { array, boolean, check, literal, maxValue, minValue, nonEmpty, number, object, optional, picklist, pipe, safeInteger, safeParse, string, union, unknown, variant } from "valibot";
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
const RequestId = pipe(number(), safeInteger(), minValue(1));
const AnalysisWorkerEnvelopeSchema = object({
	protocol: literal(3),
	id: RequestId
});
const Workspace = object({
	reset: boolean(),
	modules: array(AnalysisModuleSchema),
	removedModules: array(AnalysisModuleNameSchema)
});
const RequestBase = {
	protocol: literal(3),
	id: RequestId,
	mode: AnalysisModeSchema,
	lint: AnalysisLintSchema,
	globals: AnalysisGlobalsSchema,
	definitions: array(AnalysisDefinitionSchema),
	typeString: optional(AnalysisTypeStringOptionsSchema),
	resolveModules: boolean(),
	workspace: Workspace
};
const AnalysisWorkerRequestSchema = variant("action", [
	object({
		...RequestBase,
		action: literal("check"),
		name: AnalysisModuleNameSchema
	}),
	object({
		...RequestBase,
		action: literal("checkModules"),
		names: array(AnalysisModuleNameSchema)
	}),
	object({
		...RequestBase,
		action: literal("decorateWithTypes"),
		name: AnalysisModuleNameSchema
	}),
	object({
		...RequestBase,
		action: literal("autocomplete"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("fragmentAutocomplete"),
		name: AnalysisModuleNameSchema,
		source: AnalysisModuleSchema.entries.source,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("typeAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("expectedTypeAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("inspectAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("documentationSymbolAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	object({
		...RequestBase,
		action: literal("moduleReturnType"),
		name: AnalysisModuleNameSchema
	}),
	object({
		...RequestBase,
		action: literal("requiredModules"),
		name: AnalysisModuleNameSchema
	})
]);
const ResolutionId = pipe(number(), safeInteger(), minValue(1));
const AnalysisModuleRequestSchema = object({
	protocol: literal(3),
	id: RequestId,
	action: literal("resolveModule"),
	resolution: ResolutionId,
	from: AnalysisModuleNameSchema,
	specifier: string()
});
const AnalysisModuleResponseSchema = object({
	protocol: literal(3),
	id: RequestId,
	action: literal("resolveModule"),
	resolution: ResolutionId,
	module: optional(AnalysisModuleSchema),
	error: optional(string())
});
const AnalysisWorkerResponseSchema = variant("ok", [object({
	protocol: literal(3),
	id: RequestId,
	ok: literal(true),
	result: unknown()
}), object({
	protocol: literal(3),
	id: RequestId,
	ok: literal(false),
	error: object({
		name: string(),
		message: string()
	})
})]);
//#endregion
export { AnalysisWorkerResponseSchema as a, AnalysisLintSchema as c, AnalysisModuleSchema as d, AnalysisOptionsSchema as f, parseAnalysisResult as h, AnalysisWorkerRequestSchema as i, AnalysisModeSchema as l, parseAnalysisInput as m, AnalysisModuleResponseSchema as n, AnalysisDefinitionSchema as o, AnalysisPositionSchema as p, AnalysisWorkerEnvelopeSchema as r, AnalysisGlobalsSchema as s, AnalysisModuleRequestSchema as t, AnalysisModuleNameSchema as u };
