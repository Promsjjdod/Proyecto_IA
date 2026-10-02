//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res, err) => () => {
	if (err) throw err[0];
	try {
		return fn && (res = fn(fn = 0)), res;
	} catch (e) {
		throw err = [e], e;
	}
};
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
const DEFAULT_CONFIG = {
	lang: void 0,
	message: void 0,
	abortEarly: void 0,
	abortPipeEarly: void 0
};
/**
* Returns the global configuration.
*
* @param config The config to merge.
*
* @returns The configuration.
*/
/* @__NO_SIDE_EFFECTS__ */
function getGlobalConfig(config$1) {
	if (!config$1 && true) return DEFAULT_CONFIG;
	return {
		lang: config$1?.lang ?? void 0,
		message: config$1?.message,
		abortEarly: config$1?.abortEarly ?? void 0,
		abortPipeEarly: config$1?.abortPipeEarly ?? void 0
	};
}
/**
* Stringifies an unknown input to a literal or type string.
*
* @param input The unknown input.
*
* @returns A literal or type string.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _stringify(input) {
	const type = typeof input;
	if (type === "string") return `"${input}"`;
	if (type === "number" || type === "bigint" || type === "boolean") return `${input}`;
	if (type === "object" || type === "function") return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
	return type;
}
/**
* Adds an issue to the dataset.
*
* @param context The issue context.
* @param label The issue label.
* @param dataset The input dataset.
* @param config The configuration.
* @param other The optional props.
*
* @internal
*/
function _addIssue(context, label, dataset, config$1, other) {
	const input = other && "input" in other ? other.input : dataset.value;
	const expected = other?.expected ?? context.expects ?? null;
	const received = other?.received ?? /* @__PURE__ */ _stringify(input);
	const issue = {
		kind: context.kind,
		type: context.type,
		input,
		expected,
		received,
		message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
		requirement: context.requirement,
		path: other?.path,
		issues: other?.issues,
		lang: config$1.lang,
		abortEarly: config$1.abortEarly,
		abortPipeEarly: config$1.abortPipeEarly
	};
	const isSchema = context.kind === "schema";
	const message$1 = other?.message ?? context.message ?? (context.reference, issue.lang, void 0) ?? (isSchema ? (issue.lang, void 0) : null) ?? config$1.message ?? (issue.lang, void 0);
	if (message$1 !== void 0) issue.message = typeof message$1 === "function" ? message$1(issue) : message$1;
	if (isSchema) dataset.typed = false;
	if (dataset.issues) dataset.issues.push(issue);
	else dataset.issues = [issue];
}
const _standardCache = /* @__PURE__ */ new WeakMap();
/**
* Returns the Standard Schema properties.
*
* @param context The schema context.
*
* @returns The Standard Schema properties.
*/
/* @__NO_SIDE_EFFECTS__ */
function _getStandardProps(context) {
	let cached = _standardCache.get(context);
	if (!cached) {
		cached = {
			version: 1,
			vendor: "valibot",
			validate(value$1) {
				return context["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig());
			}
		};
		_standardCache.set(context, cached);
	}
	return cached;
}
/**
* Joins multiple `expects` values with the given separator.
*
* @param values The `expects` values.
* @param separator The separator.
*
* @returns The joined `expects` property.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _joinExpects(values$1, separator) {
	const list = [...new Set(values$1)];
	if (list.length > 1) return `(${list.join(` ${separator} `)})`;
	return list[0] ?? "never";
}
/* @__NO_SIDE_EFFECTS__ */
function check(requirement, message$1) {
	return {
		kind: "validation",
		type: "check",
		reference: check,
		async: false,
		expects: null,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "input", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function maxValue(requirement, message$1) {
	return {
		kind: "validation",
		type: "max_value",
		reference: maxValue,
		async: false,
		expects: `<=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !(dataset.value <= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function minValue(requirement, message$1) {
	return {
		kind: "validation",
		type: "min_value",
		reference: minValue,
		async: false,
		expects: `>=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
		requirement,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !(dataset.value >= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function nonEmpty(message$1) {
	return {
		kind: "validation",
		type: "non_empty",
		reference: nonEmpty,
		async: false,
		expects: "!0",
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && dataset.value.length === 0) _addIssue(this, "length", dataset, config$1, { received: "0" });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function safeInteger(message$1) {
	return {
		kind: "validation",
		type: "safe_integer",
		reference: safeInteger,
		async: false,
		expects: null,
		requirement: Number.isSafeInteger,
		message: message$1,
		"~run"(dataset, config$1) {
			if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "safe integer", dataset, config$1);
			return dataset;
		}
	};
}
const ABORT_EARLY_CONFIG = { abortEarly: true };
/**
* Returns the fallback value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The output dataset if available.
* @param config The config if available.
*
* @returns The fallback value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getFallback(schema, dataset, config$1) {
	return typeof schema.fallback === "function" ? schema.fallback(dataset, config$1) : schema.fallback;
}
/**
* Returns the default value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The input dataset if available.
* @param config The config if available.
*
* @returns The default value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getDefault(schema, dataset, config$1) {
	return typeof schema.default === "function" ? schema.default(dataset, config$1) : schema.default;
}
/* @__NO_SIDE_EFFECTS__ */
function array(item, message$1) {
	return {
		kind: "schema",
		type: "array",
		reference: array,
		expects: "Array",
		async: false,
		item,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (Array.isArray(input)) {
				dataset.typed = true;
				dataset.value = [];
				for (let key = 0; key < input.length; key++) {
					const value$1 = input[key];
					const itemDataset = this.item["~run"]({ value: value$1 }, config$1);
					if (itemDataset.issues) {
						const pathItem = {
							type: "array",
							origin: "value",
							input,
							key,
							value: value$1
						};
						for (const issue of itemDataset.issues) {
							if (issue.path) issue.path.unshift(pathItem);
							else issue.path = [pathItem];
							dataset.issues?.push(issue);
						}
						if (!dataset.issues) dataset.issues = itemDataset.issues;
						if (config$1.abortEarly) {
							dataset.typed = false;
							break;
						}
					}
					if (!itemDataset.typed) dataset.typed = false;
					dataset.value.push(itemDataset.value);
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function boolean(message$1) {
	return {
		kind: "schema",
		type: "boolean",
		reference: boolean,
		expects: "boolean",
		async: false,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "boolean") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function literal(literal_, message$1) {
	return {
		kind: "schema",
		type: "literal",
		reference: literal,
		expects: /* @__PURE__ */ _stringify(literal_),
		async: false,
		literal: literal_,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (dataset.value === this.literal) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function number(message$1) {
	return {
		kind: "schema",
		type: "number",
		reference: number,
		expects: "number",
		async: false,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "number" && !isNaN(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function object(entries$1, message$1) {
	return {
		kind: "schema",
		type: "object",
		reference: object,
		expects: "Object",
		async: false,
		entries: entries$1,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				dataset.typed = true;
				dataset.value = {};
				for (const key in this.entries) {
					const valueSchema = this.entries[key];
					if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
						const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
						const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
						if (valueDataset.issues) {
							const pathItem = {
								type: "object",
								origin: "value",
								input,
								key,
								value: value$1
							};
							for (const issue of valueDataset.issues) {
								if (issue.path) issue.path.unshift(pathItem);
								else issue.path = [pathItem];
								dataset.issues?.push(issue);
							}
							if (!dataset.issues) dataset.issues = valueDataset.issues;
							if (config$1.abortEarly) {
								dataset.typed = false;
								break;
							}
						}
						if (!valueDataset.typed) dataset.typed = false;
						dataset.value[key] = valueDataset.value;
					} else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
					else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
						_addIssue(this, "key", dataset, config$1, {
							input: void 0,
							expected: `"${key}"`,
							path: [{
								type: "object",
								origin: "key",
								input,
								key,
								value: input[key]
							}]
						});
						if (config$1.abortEarly) break;
					}
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function optional(wrapped, default_) {
	return {
		kind: "schema",
		type: "optional",
		reference: optional,
		expects: `(${wrapped.expects} | undefined)`,
		async: false,
		wrapped,
		default: default_,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (dataset.value === void 0) {
				if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
				if (dataset.value === void 0) {
					dataset.typed = true;
					return dataset;
				}
			}
			return this.wrapped["~run"](dataset, config$1);
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function picklist(options, message$1) {
	return {
		kind: "schema",
		type: "picklist",
		reference: picklist,
		expects: /* @__PURE__ */ _joinExpects(options.map(_stringify), "|"),
		async: false,
		options,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (this.options.includes(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function string(message$1) {
	return {
		kind: "schema",
		type: "string",
		reference: string,
		expects: "string",
		async: false,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "string") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/**
* Returns the sub issues of the provided datasets for the union issue.
*
* @param datasets The datasets.
*
* @returns The sub issues.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _subIssues(datasets) {
	let issues;
	if (datasets) for (const dataset of datasets) if (issues) for (const issue of dataset.issues) issues.push(issue);
	else issues = dataset.issues;
	return issues;
}
/* @__NO_SIDE_EFFECTS__ */
function union(options, message$1) {
	return {
		kind: "schema",
		type: "union",
		reference: union,
		expects: /* @__PURE__ */ _joinExpects(options.map((option) => option.expects), "|"),
		async: false,
		options,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			let validDataset;
			let typedDatasets;
			let untypedDatasets;
			for (const schema of this.options) {
				const optionDataset = schema["~run"]({ value: dataset.value }, config$1);
				if (optionDataset.typed) if (optionDataset.issues) if (typedDatasets) typedDatasets.push(optionDataset);
				else typedDatasets = [optionDataset];
				else {
					validDataset = optionDataset;
					break;
				}
				else if (untypedDatasets) untypedDatasets.push(optionDataset);
				else untypedDatasets = [optionDataset];
			}
			if (validDataset) return validDataset;
			if (typedDatasets) {
				if (typedDatasets.length === 1) return typedDatasets[0];
				_addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(typedDatasets) });
				dataset.typed = true;
			} else if (untypedDatasets?.length === 1) return untypedDatasets[0];
			else _addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(untypedDatasets) });
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function variant(key, options, message$1) {
	return {
		kind: "schema",
		type: "variant",
		reference: variant,
		expects: "Object",
		async: false,
		key,
		options,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				let outputDataset;
				let maxDiscriminatorPriority = 0;
				let invalidDiscriminatorKey = this.key;
				let expectedDiscriminators = [];
				const parseOptions = (variant$1, allKeys) => {
					for (const schema of variant$1.options) {
						if (schema.type === "variant") parseOptions(schema, new Set(allKeys).add(schema.key));
						else {
							let keysAreValid = true;
							let currentPriority = 0;
							for (const currentKey of allKeys) {
								const discriminatorSchema = schema.entries[currentKey];
								if (currentKey in input ? discriminatorSchema["~run"]({
									typed: false,
									value: input[currentKey]
								}, ABORT_EARLY_CONFIG).issues : discriminatorSchema.type !== "exact_optional" && discriminatorSchema.type !== "optional" && discriminatorSchema.type !== "nullish") {
									keysAreValid = false;
									if (invalidDiscriminatorKey !== currentKey && (maxDiscriminatorPriority < currentPriority || maxDiscriminatorPriority === currentPriority && currentKey in input && !(invalidDiscriminatorKey in input))) {
										maxDiscriminatorPriority = currentPriority;
										invalidDiscriminatorKey = currentKey;
										expectedDiscriminators = [];
									}
									if (invalidDiscriminatorKey === currentKey) expectedDiscriminators.push(schema.entries[currentKey].expects);
									break;
								}
								currentPriority++;
							}
							if (keysAreValid) {
								const optionDataset = schema["~run"]({ value: input }, config$1);
								if (!outputDataset || !outputDataset.typed && optionDataset.typed) outputDataset = optionDataset;
							}
						}
						if (outputDataset && !outputDataset.issues) break;
					}
				};
				parseOptions(this, /* @__PURE__ */ new Set([this.key]));
				if (outputDataset) return outputDataset;
				_addIssue(this, "type", dataset, config$1, {
					input: input[invalidDiscriminatorKey],
					expected: /* @__PURE__ */ _joinExpects(expectedDiscriminators, "|"),
					path: [{
						type: "object",
						origin: "value",
						input,
						key: invalidDiscriminatorKey,
						value: input[invalidDiscriminatorKey]
					}]
				});
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function pipe(...pipe$1) {
	return {
		...pipe$1[0],
		pipe: pipe$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			for (const item of pipe$1) if (item.kind !== "metadata") {
				if (dataset.issues && (item.kind === "schema" || item.kind === "transformation")) {
					dataset.typed = false;
					break;
				}
				if (!dataset.issues || !config$1.abortEarly && !config$1.abortPipeEarly) dataset = item["~run"](dataset, config$1);
			}
			return dataset;
		}
	};
}
/**
* Parses an unknown input based on a schema.
*
* @param schema The schema to be used.
* @param input The input to be parsed.
* @param config The parse configuration.
*
* @returns The parse result.
*/
/* @__NO_SIDE_EFFECTS__ */
function safeParse(schema, input, config$1) {
	const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
	return {
		typed: dataset.typed,
		success: !dataset.issues,
		output: dataset.value,
		issues: dataset.issues
	};
}
//#endregion
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
const WellFormedString = /* @__PURE__ */ check(isWellFormedString, "JavaScript string contains an unpaired surrogate");
const AnalysisModuleNameSchema = /* @__PURE__ */ pipe(/* @__PURE__ */ string("module name must be a string"), WellFormedString, /* @__PURE__ */ nonEmpty("module name must be a non-empty string"));
const AnalysisModeSchema = /* @__PURE__ */ picklist([
	"nocheck",
	"nonstrict",
	"strict"
], "analysis mode must be 'nocheck', 'nonstrict', or 'strict'");
const AnalysisLintSchema = /* @__PURE__ */ boolean("lint must be a boolean");
const AnalysisModuleKindSchema = /* @__PURE__ */ picklist(["module", "script"], "module kind must be 'module' or 'script'");
const AnalysisGlobalsSchema = /* @__PURE__ */ array(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), WellFormedString, /* @__PURE__ */ nonEmpty("globals must contain only non-empty strings")), "globals must contain only non-empty strings");
const AnalysisPositionSchema = /* @__PURE__ */ object({
	line: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0), /* @__PURE__ */ maxValue(4294967295)),
	column: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0), /* @__PURE__ */ maxValue(4294967295))
}, "position must contain non-negative line and column values");
const AnalysisInspectionSchema = /* @__PURE__ */ object({
	name: /* @__PURE__ */ optional(/* @__PURE__ */ string()),
	type: /* @__PURE__ */ string()
});
const AnalysisModuleSchema = /* @__PURE__ */ object({
	name: AnalysisModuleNameSchema,
	source: /* @__PURE__ */ pipe(/* @__PURE__ */ string("module source must be a string"), WellFormedString),
	kind: /* @__PURE__ */ optional(AnalysisModuleKindSchema),
	environment: /* @__PURE__ */ optional(AnalysisModuleNameSchema)
}, "module must be an object");
const AnalysisDefinitionSchema = /* @__PURE__ */ object({
	name: AnalysisModuleNameSchema,
	source: /* @__PURE__ */ pipe(/* @__PURE__ */ string("definition source must be a string"), WellFormedString),
	environment: /* @__PURE__ */ optional(AnalysisModuleNameSchema)
}, "definition must be an object");
const AnalysisTypeStringOptionsSchema = /* @__PURE__ */ object({
	maxTableLength: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0), /* @__PURE__ */ maxValue(2147483647))),
	maxTypeLength: /* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(0), /* @__PURE__ */ maxValue(2147483647)))
}, "typeString must contain non-negative length limits");
const AnalysisOptionsSchema = /* @__PURE__ */ object({
	mode: /* @__PURE__ */ optional(AnalysisModeSchema),
	lint: /* @__PURE__ */ optional(AnalysisLintSchema),
	globals: /* @__PURE__ */ optional(AnalysisGlobalsSchema),
	modules: /* @__PURE__ */ optional(/* @__PURE__ */ array(AnalysisModuleSchema, "modules must be an array")),
	definitions: /* @__PURE__ */ optional(/* @__PURE__ */ array(AnalysisDefinitionSchema, "definitions must be an array")),
	typeString: /* @__PURE__ */ optional(AnalysisTypeStringOptionsSchema)
}, "analysis options must be an object");
const AnalysisCheckResultSchema = /* @__PURE__ */ object({
	diagnostics: /* @__PURE__ */ array(/* @__PURE__ */ object({
		kind: /* @__PURE__ */ picklist(["type", "lint"]),
		severity: /* @__PURE__ */ picklist(["error", "warning"]),
		module: /* @__PURE__ */ string(),
		location: /* @__PURE__ */ object({
			begin: AnalysisPositionSchema,
			end: AnalysisPositionSchema
		}),
		message: /* @__PURE__ */ string(),
		code: /* @__PURE__ */ union([/* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger()), /* @__PURE__ */ string()])
	})),
	timeoutModules: /* @__PURE__ */ array(/* @__PURE__ */ string())
});
const AnalysisModuleCheckResultSchema = /* @__PURE__ */ object({
	name: AnalysisModuleNameSchema,
	result: AnalysisCheckResultSchema
});
const AutocompleteResultSchema = /* @__PURE__ */ object({
	context: /* @__PURE__ */ picklist([
		"unknown",
		"expression",
		"statement",
		"property",
		"type",
		"keyword",
		"string",
		"hotComment"
	]),
	entries: /* @__PURE__ */ array(/* @__PURE__ */ object({
		label: /* @__PURE__ */ string(),
		kind: /* @__PURE__ */ picklist([
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
		type: /* @__PURE__ */ optional(/* @__PURE__ */ string()),
		deprecated: /* @__PURE__ */ boolean(),
		wrongIndexType: /* @__PURE__ */ boolean(),
		typeCorrect: /* @__PURE__ */ picklist([
			"none",
			"correct",
			"correctFunctionResult"
		]),
		parentheses: /* @__PURE__ */ picklist([
			"none",
			"cursorAfter",
			"cursorInside"
		]),
		insertText: /* @__PURE__ */ optional(/* @__PURE__ */ string()),
		indexedWithSelf: /* @__PURE__ */ boolean(),
		replaceDotWithColon: /* @__PURE__ */ boolean(),
		documentationSymbol: /* @__PURE__ */ optional(/* @__PURE__ */ string()),
		tags: /* @__PURE__ */ array(/* @__PURE__ */ string())
	}))
});
const FragmentAutocompleteResultSchema = /* @__PURE__ */ object({
	status: /* @__PURE__ */ picklist([
		"success",
		"fallback",
		"internalError"
	]),
	result: /* @__PURE__ */ optional(AutocompleteResultSchema)
});
const OptionalStringSchema = /* @__PURE__ */ optional(/* @__PURE__ */ string());
function parseAnalysisInput(schema, value) {
	const result = /* @__PURE__ */ safeParse(schema, value, {
		abortEarly: true,
		abortPipeEarly: true
	});
	if (!result.success) throw new TypeError(result.issues[0].message);
	return result.output;
}
function parseAnalysisResult(action, value) {
	switch (action) {
		case "check": return parseAnalysisInput(AnalysisCheckResultSchema, value);
		case "checkModules": return parseAnalysisInput(/* @__PURE__ */ array(AnalysisModuleCheckResultSchema), value);
		case "autocomplete": return parseAnalysisInput(AutocompleteResultSchema, value);
		case "fragmentAutocomplete": return parseAnalysisInput(FragmentAutocompleteResultSchema, value);
		case "typeAt":
		case "expectedTypeAt":
		case "decorateWithTypes":
		case "documentationSymbolAt":
		case "moduleReturnType": return parseAnalysisInput(OptionalStringSchema, value);
		case "inspectAt": return parseAnalysisInput(/* @__PURE__ */ optional(AnalysisInspectionSchema), value);
		case "requiredModules": return parseAnalysisInput(/* @__PURE__ */ array(/* @__PURE__ */ string()), value);
	}
}
//#endregion
//#region src/wasm-analysis-web/luau_analysis_wasm.js
var luau_analysis_wasm_exports = /* @__PURE__ */ __exportAll({
	WasmAnalysis: () => WasmAnalysis,
	default: () => __wbg_init,
	initSync: () => initSync,
	start: () => start,
	version: () => version
});
function start() {
	wasm.start();
}
/**
* @returns {string}
*/
function version() {
	let deferred1_0;
	let deferred1_1;
	try {
		const ret = wasm.version();
		deferred1_0 = ret[0];
		deferred1_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
	}
}
function __wbg_get_imports(memory) {
	return {
		__proto__: null,
		"./luau_analysis_wasm_bg.js": {
			__proto__: null,
			__wbg_Error_67e7344beaa85059: function(arg0, arg1) {
				return Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_String_8564e559799eccda: function(arg0, arg1) {
				const ptr1 = passStringToWasm0(String(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_string_get_92ab86bb19cbc12f: function(arg0, arg1) {
				const obj = arg1;
				const ret = typeof obj === "string" ? obj : void 0;
				var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				var len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
				throw new Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_error_757e9472f8410341: function(arg0, arg1) {
				let deferred0_0;
				let deferred0_1;
				try {
					deferred0_0 = arg0;
					deferred0_1 = arg1;
					console.error(getStringFromWasm0(arg0, arg1));
				} finally {
					wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
				}
			},
			__wbg_new_227d7c05414eb861: function() {
				return /* @__PURE__ */ new Error();
			},
			__wbg_new_bebc3f4757acf305: function() {
				return /* @__PURE__ */ new Object();
			},
			__wbg_new_ffa92086ea89f79c: function() {
				return new Array();
			},
			__wbg_now_d1fb6650485d7f3e: function() {
				return Date.now();
			},
			__wbg_set_13d25b81ab403f5e: function(arg0, arg1, arg2) {
				arg0[arg1 >>> 0] = arg2;
			},
			__wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
				arg0[arg1] = arg2;
			},
			__wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
				const ret = arg1.stack;
				const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbindgen_generic_0000000000000001: function(arg0) {
				return arg0;
			},
			__wbindgen_generic_0000000000000002: function(arg0, arg1) {
				return getStringFromWasm0(arg0, arg1);
			},
			__wbindgen_init_externref_table: function() {
				const table = wasm.__wbindgen_externrefs;
				const offset = table.grow(4);
				table.set(0, void 0);
				table.set(offset + 0, void 0);
				table.set(offset + 1, null);
				table.set(offset + 2, true);
				table.set(offset + 3, false);
			},
			memory: memory || new WebAssembly.Memory({ initial: 32 })
		}
	};
}
function addToExternrefTable0(obj) {
	const idx = wasm.__externref_table_alloc();
	wasm.__wbindgen_externrefs.set(idx, obj);
	return idx;
}
function getArrayJsValueFromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	const mem = getDataViewMemory0();
	const result = [];
	for (let i = ptr; i < ptr + 4 * len; i += 4) result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
	wasm.__externref_drop_slice(ptr, len);
	return result;
}
function getDataViewMemory0() {
	if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
	return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
	return decodeText(ptr >>> 0, len);
}
function getUint8ArrayMemory0() {
	if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
	return cachedUint8ArrayMemory0;
}
function isLikeNone(x) {
	return x === void 0 || x === null;
}
function passArrayJsValueToWasm0(array, malloc) {
	const ptr = malloc(array.length * 4, 4) >>> 0;
	for (let i = 0; i < array.length; i++) {
		const add = addToExternrefTable0(array[i]);
		getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
	}
	WASM_VECTOR_LEN = array.length;
	return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
	if (realloc === void 0) {
		const buf = cachedTextEncoder.encode(arg);
		const ptr = malloc(buf.length, 1) >>> 0;
		getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
		WASM_VECTOR_LEN = buf.length;
		return ptr;
	}
	let len = arg.length;
	let ptr = malloc(len, 1) >>> 0;
	const mem = getUint8ArrayMemory0();
	let offset = 0;
	for (; offset < len; offset++) {
		const code = arg.charCodeAt(offset);
		if (code > 127) break;
		mem[ptr + offset] = code;
	}
	if (offset !== len) {
		if (offset !== 0) arg = arg.slice(offset);
		ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
		const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
		const ret = cachedTextEncoder.encodeInto(arg, view);
		offset += ret.written;
		ptr = realloc(ptr, len, offset, 1) >>> 0;
	}
	WASM_VECTOR_LEN = offset;
	return ptr;
}
function takeFromExternrefTable0(idx) {
	const value = wasm.__wbindgen_externrefs.get(idx);
	wasm.__externref_table_dealloc(idx);
	return value;
}
function decodeText(ptr, len) {
	numBytesDecoded += len;
	if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
		cachedTextDecoder = new TextDecoder("utf-8", {
			ignoreBOM: true,
			fatal: true
		});
		cachedTextDecoder.decode();
		numBytesDecoded = len;
	}
	return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
function __wbg_finalize_init(instance, module) {
	wasm = instance.exports;
	cachedDataViewMemory0 = null;
	cachedUint8ArrayMemory0 = null;
	wasm.__wbindgen_start();
	return wasm;
}
async function __wbg_load(module, imports) {
	if (typeof Response === "function" && module instanceof Response) {
		if (!module.ok) throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
		if (typeof WebAssembly.instantiateStreaming === "function") try {
			return await WebAssembly.instantiateStreaming(module, imports);
		} catch (e) {
			if (expectedResponseType(module.type) && module.headers.get("Content-Type") !== "application/wasm") console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
			else throw e;
		}
		const bytes = await module.arrayBuffer();
		return await WebAssembly.instantiate(bytes, imports);
	} else {
		const instance = await WebAssembly.instantiate(module, imports);
		if (instance instanceof WebAssembly.Instance) return {
			instance,
			module
		};
		else return instance;
	}
	function expectedResponseType(type) {
		switch (type) {
			case "basic":
			case "cors":
			case "default": return true;
		}
		return false;
	}
}
function initSync(module, memory) {
	if (wasm !== void 0) return wasm;
	if (module !== void 0) {
		if (Object.getPrototypeOf(module) === Object.prototype) ({module, memory} = module);
		else console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
	}
	const imports = __wbg_get_imports(memory);
	if (!(module instanceof WebAssembly.Module)) module = new WebAssembly.Module(module);
	return __wbg_finalize_init(new WebAssembly.Instance(module, imports), module);
}
async function __wbg_init(module_or_path, memory) {
	if (wasm !== void 0) return wasm;
	if (module_or_path !== void 0) {
		if (Object.getPrototypeOf(module_or_path) === Object.prototype) ({module_or_path, memory} = module_or_path);
		else console.warn("using deprecated parameters for the initialization function; pass a single object instead");
	}
	if (module_or_path === void 0) module_or_path = new URL("luau_analysis_wasm_bg.wasm", import.meta.url);
	const imports = __wbg_get_imports(memory);
	if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) module_or_path = fetch(module_or_path);
	const { instance, module } = await __wbg_load(await module_or_path, imports);
	return __wbg_finalize_init(instance, module);
}
var WasmAnalysis, WasmAnalysisFinalization, cachedDataViewMemory0, cachedUint8ArrayMemory0, cachedTextDecoder, MAX_SAFARI_DECODE_BYTES, numBytesDecoded, cachedTextEncoder, WASM_VECTOR_LEN, wasm;
var init_luau_analysis_wasm = __esmMin((() => {
	WasmAnalysis = class {
		__destroy_into_raw() {
			const ptr = this.__wbg_ptr;
			this.__wbg_ptr = 0;
			WasmAnalysisFinalization.unregister(this);
			return ptr;
		}
		free() {
			const ptr = this.__destroy_into_raw();
			wasm.__wbg_wasmanalysis_free(ptr, 0);
		}
		/**
		* @param {string} name
		* @param {string} source
		* @param {string | null} [environment]
		*/
		addDefinition(name, source, environment) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len1 = WASM_VECTOR_LEN;
			var ptr2 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len2 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_addDefinition(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
			if (ret[1]) throw takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @param {number} line
		* @param {number} column
		* @returns {any}
		*/
		autocomplete(name, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_autocomplete(this.__wbg_ptr, ptr0, len0, line, column);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		beginOperation() {
			wasm.wasmanalysis_beginOperation(this.__wbg_ptr);
		}
		/**
		* @param {string[]} names
		* @returns {any}
		*/
		checkModules(names) {
			const ptr0 = passArrayJsValueToWasm0(names, wasm.__wbindgen_malloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_checkModules(this.__wbg_ptr, ptr0, len0);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @returns {any}
		*/
		check(name) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_check(this.__wbg_ptr, ptr0, len0);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		clearModules() {
			wasm.wasmanalysis_clearModules(this.__wbg_ptr);
		}
		/**
		* @param {string} name
		* @returns {string | undefined}
		*/
		decorateWithTypes(name) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_decorateWithTypes(this.__wbg_ptr, ptr0, len0);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			let v2;
			if (ret[0] !== 0) {
				v2 = getStringFromWasm0(ret[0], ret[1]);
				wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
			}
			return v2;
		}
		/**
		* @param {string} name
		* @returns {boolean}
		*/
		deleteModule(name) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			return wasm.wasmanalysis_deleteModule(this.__wbg_ptr, ptr0, len0) !== 0;
		}
		/**
		* @param {string} name
		* @param {number} line
		* @param {number} column
		* @returns {string | undefined}
		*/
		documentationSymbolAt(name, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_documentationSymbolAt(this.__wbg_ptr, ptr0, len0, line, column);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			let v2;
			if (ret[0] !== 0) {
				v2 = getStringFromWasm0(ret[0], ret[1]);
				wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
			}
			return v2;
		}
		/**
		* @param {string} name
		* @param {number} line
		* @param {number} column
		* @returns {string | undefined}
		*/
		expectedTypeAt(name, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_expectedTypeAt(this.__wbg_ptr, ptr0, len0, line, column);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			let v2;
			if (ret[0] !== 0) {
				v2 = getStringFromWasm0(ret[0], ret[1]);
				wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
			}
			return v2;
		}
		/**
		* @param {string} name
		* @param {string} source
		* @param {number} line
		* @param {number} column
		* @returns {any}
		*/
		fragmentAutocomplete(name, source, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len1 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_fragmentAutocomplete(this.__wbg_ptr, ptr0, len0, ptr1, len1, line, column);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @param {number} line
		* @param {number} column
		* @returns {any}
		*/
		inspectAt(name, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_inspectAt(this.__wbg_ptr, ptr0, len0, line, column);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @returns {string | undefined}
		*/
		moduleReturnType(name) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_moduleReturnType(this.__wbg_ptr, ptr0, len0);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			let v2;
			if (ret[0] !== 0) {
				v2 = getStringFromWasm0(ret[0], ret[1]);
				wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
			}
			return v2;
		}
		/**
		* @param {string} mode
		* @param {boolean} lint
		* @param {string[]} globals
		* @param {number | null} [max_table_length]
		* @param {number | null} [max_type_length]
		*/
		constructor(mode, lint, globals, max_table_length, max_type_length) {
			const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passArrayJsValueToWasm0(globals, wasm.__wbindgen_malloc);
			const len1 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_new(ptr0, len0, lint, ptr1, len1, isLikeNone(max_table_length) ? Number.MAX_SAFE_INTEGER : max_table_length >>> 0, isLikeNone(max_type_length) ? Number.MAX_SAFE_INTEGER : max_type_length >>> 0);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			this.__wbg_ptr = ret[0];
			WasmAnalysisFinalization.register(this, this.__wbg_ptr, this);
			return this;
		}
		/**
		* @param {string} name
		* @returns {string[]}
		*/
		requiredModules(name) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_requiredModules(this.__wbg_ptr, ptr0, len0);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
			wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
			return v2;
		}
		/**
		* @param {string} from
		* @param {string} specifier
		* @param {string | null} [name]
		* @param {string | null} [source]
		* @param {string | null} [kind]
		* @param {string | null} [environment]
		*/
		resolveModule(from, specifier, name, source, kind, environment) {
			const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passStringToWasm0(specifier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len1 = WASM_VECTOR_LEN;
			var ptr2 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len2 = WASM_VECTOR_LEN;
			var ptr3 = isLikeNone(source) ? 0 : passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len3 = WASM_VECTOR_LEN;
			var ptr4 = isLikeNone(kind) ? 0 : passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len4 = WASM_VECTOR_LEN;
			var ptr5 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len5 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_resolveModule(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
			if (ret[1]) throw takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string[]} globals
		*/
		setGlobals(globals) {
			const ptr0 = passArrayJsValueToWasm0(globals, wasm.__wbindgen_malloc);
			const len0 = WASM_VECTOR_LEN;
			wasm.wasmanalysis_setGlobals(this.__wbg_ptr, ptr0, len0);
		}
		/**
		* @param {boolean} lint
		*/
		setLint(lint) {
			wasm.wasmanalysis_setLint(this.__wbg_ptr, lint);
		}
		/**
		* @param {string} mode
		*/
		setMode(mode) {
			const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_setMode(this.__wbg_ptr, ptr0, len0);
			if (ret[1]) throw takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @param {string} source
		* @param {string} kind
		* @param {string | null} [environment]
		*/
		setModule(name, source, kind, environment) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len1 = WASM_VECTOR_LEN;
			const ptr2 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len2 = WASM_VECTOR_LEN;
			var ptr3 = isLikeNone(environment) ? 0 : passStringToWasm0(environment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			var len3 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_setModule(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
			if (ret[1]) throw takeFromExternrefTable0(ret[0]);
		}
		/**
		* @returns {any}
		*/
		takeModuleRequests() {
			const ret = wasm.wasmanalysis_takeModuleRequests(this.__wbg_ptr);
			if (ret[2]) throw takeFromExternrefTable0(ret[1]);
			return takeFromExternrefTable0(ret[0]);
		}
		/**
		* @param {string} name
		* @param {number} line
		* @param {number} column
		* @returns {string | undefined}
		*/
		typeAt(name, line, column) {
			const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
			const len0 = WASM_VECTOR_LEN;
			const ret = wasm.wasmanalysis_typeAt(this.__wbg_ptr, ptr0, len0, line, column);
			if (ret[3]) throw takeFromExternrefTable0(ret[2]);
			let v2;
			if (ret[0] !== 0) {
				v2 = getStringFromWasm0(ret[0], ret[1]);
				wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
			}
			return v2;
		}
	};
	if (Symbol.dispose) WasmAnalysis.prototype[Symbol.dispose] = WasmAnalysis.prototype.free;
	WasmAnalysisFinalization = typeof FinalizationRegistry === "undefined" ? {
		register: () => {},
		unregister: () => {}
	} : new FinalizationRegistry((ptr) => wasm.__wbg_wasmanalysis_free(ptr, 1));
	cachedDataViewMemory0 = null;
	cachedUint8ArrayMemory0 = null;
	cachedTextDecoder = new TextDecoder("utf-8", {
		ignoreBOM: true,
		fatal: true
	});
	cachedTextDecoder.decode();
	MAX_SAFARI_DECODE_BYTES = 2146435072;
	numBytesDecoded = 0;
	cachedTextEncoder = new TextEncoder();
	if (!("encodeInto" in cachedTextEncoder)) cachedTextEncoder.encodeInto = function(arg, view) {
		const buf = cachedTextEncoder.encode(arg);
		view.set(buf);
		return {
			read: arg.length,
			written: buf.length
		};
	};
	WASM_VECTOR_LEN = 0;
}));
//#endregion
//#region src/wasm-memory.ts
function createWorkerMemory() {
	return new WebAssembly.Memory({
		initial: INITIAL_MEMORY_BYTES / WASM_PAGE_BYTES,
		maximum: WORKER_MEMORY_BYTES / WASM_PAGE_BYTES
	});
}
var WASM_PAGE_BYTES, INITIAL_MEMORY_BYTES, WORKER_MEMORY_BYTES;
var init_wasm_memory = __esmMin((() => {
	WASM_PAGE_BYTES = 65536;
	INITIAL_MEMORY_BYTES = 2097152;
	WORKER_MEMORY_BYTES = 268435456;
}));
//#endregion
//#region src/analysis-worker-wasm.ts
var analysis_worker_wasm_exports = /* @__PURE__ */ __exportAll({
	WasmAnalysis: () => WasmAnalysis,
	initSync: () => initSync,
	initializeAnalysisBindings: () => initializeAnalysisBindings$1,
	start: () => start,
	version: () => version
});
function initializeAnalysisBindings$1() {
	return initialization$1 ??= (async () => {
		const workerUrl = new URL(import.meta.url);
		const wasmUrl = workerUrl.searchParams.get("wasm");
		await __wbg_init({
			module_or_path: wasmUrl === null ? new URL("./luau_analysis_wasm_bg.wasm", workerUrl) : new URL(wasmUrl),
			memory: createWorkerMemory()
		});
		return luau_analysis_wasm_exports;
	})();
}
var initialization$1;
var init_analysis_worker_wasm = __esmMin((() => {
	init_luau_analysis_wasm();
	init_wasm_memory();
	init_luau_analysis_wasm();
}));
//#endregion
//#region src/analysis-api.ts
let initialization;
function initializeAnalysisBindings() {
	return initialization ??= Promise.resolve().then(() => (init_analysis_worker_wasm(), analysis_worker_wasm_exports)).then((bindings) => {
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
const RequestId = /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(1));
const AnalysisWorkerEnvelopeSchema = /* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId
});
const RequestBase = {
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	mode: AnalysisModeSchema,
	lint: AnalysisLintSchema,
	globals: AnalysisGlobalsSchema,
	definitions: /* @__PURE__ */ array(AnalysisDefinitionSchema),
	typeString: /* @__PURE__ */ optional(AnalysisTypeStringOptionsSchema),
	resolveModules: /* @__PURE__ */ boolean(),
	workspace: /* @__PURE__ */ object({
		reset: /* @__PURE__ */ boolean(),
		modules: /* @__PURE__ */ array(AnalysisModuleSchema),
		removedModules: /* @__PURE__ */ array(AnalysisModuleNameSchema)
	})
};
const AnalysisWorkerRequestSchema = /* @__PURE__ */ variant("action", [
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("check"),
		name: AnalysisModuleNameSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("checkModules"),
		names: /* @__PURE__ */ array(AnalysisModuleNameSchema)
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("decorateWithTypes"),
		name: AnalysisModuleNameSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("autocomplete"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("fragmentAutocomplete"),
		name: AnalysisModuleNameSchema,
		source: AnalysisModuleSchema.entries.source,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("typeAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("expectedTypeAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("inspectAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("documentationSymbolAt"),
		name: AnalysisModuleNameSchema,
		position: AnalysisPositionSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("moduleReturnType"),
		name: AnalysisModuleNameSchema
	}),
	/* @__PURE__ */ object({
		...RequestBase,
		action: /* @__PURE__ */ literal("requiredModules"),
		name: AnalysisModuleNameSchema
	})
]);
const AnalysisModuleResponseSchema = /* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	action: /* @__PURE__ */ literal("resolveModule"),
	resolution: /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(1)),
	module: /* @__PURE__ */ optional(AnalysisModuleSchema),
	error: /* @__PURE__ */ optional(/* @__PURE__ */ string())
});
//#endregion
//#region src/analysis-worker-runtime.ts
function serveAnalysisWorkerOn(port) {
	let analysis;
	let mode = "nonstrict";
	let lint = false;
	let globals = [];
	let definitions = [];
	let queue = Promise.resolve();
	let nextResolution = 1;
	const resolutions = /* @__PURE__ */ new Map();
	port.addEventListener("message", (event) => {
		const response = /* @__PURE__ */ safeParse(AnalysisModuleResponseSchema, event.data);
		if (response.success) {
			const pending = resolutions.get(response.output.resolution);
			if (pending === void 0) return;
			resolutions.delete(response.output.resolution);
			if (response.output.error !== void 0) pending.reject(new Error(response.output.error));
			else pending.resolve(response.output.module);
			return;
		}
		queue = queue.then(() => handle(event.data));
	});
	async function handle(value) {
		const parsed = /* @__PURE__ */ safeParse(AnalysisWorkerRequestSchema, value);
		if (!parsed.success) {
			const envelope = /* @__PURE__ */ safeParse(AnalysisWorkerEnvelopeSchema, value);
			if (envelope.success) port.postMessage({
				protocol: 3,
				id: envelope.output.id,
				ok: false,
				error: {
					name: "TypeError",
					message: "invalid analysis worker request"
				}
			});
			return;
		}
		const request = parsed.output;
		try {
			if (analysis === void 0) {
				analysis = await Analysis.create({
					mode: request.mode,
					lint: request.lint,
					globals: request.globals,
					definitions: request.definitions,
					typeString: request.typeString
				});
				mode = request.mode;
				lint = request.lint;
				globals = request.globals;
				definitions = request.definitions;
			}
			synchronize(analysis, request);
			const result = await dispatchWithModules(analysis, request);
			port.postMessage({
				protocol: 3,
				id: request.id,
				ok: true,
				result
			});
		} catch (error) {
			port.postMessage({
				protocol: 3,
				id: request.id,
				ok: false,
				error: {
					name: error instanceof Error ? error.name : "Error",
					message: error instanceof Error ? error.message : String(error)
				}
			});
		}
	}
	function synchronize(current, request) {
		if (request.mode !== mode) {
			current.setMode(request.mode);
			mode = request.mode;
		}
		if (request.lint !== lint) {
			current.setLint(request.lint);
			lint = request.lint;
		}
		if (request.globals.length !== globals.length || request.globals.some((name, index) => name !== globals[index])) {
			current.setGlobals(request.globals);
			globals = request.globals;
		}
		if (definitions.some((definition, index) => {
			const next = request.definitions[index];
			return next === void 0 || definition.name !== next.name || definition.source !== next.source || definition.environment !== next.environment;
		})) throw new TypeError("analysis definitions cannot be removed or replaced");
		for (const definition of request.definitions.slice(definitions.length)) current.addDefinition(definition.name, definition.source, definition.environment);
		definitions = request.definitions;
		if (request.workspace.reset) current.clearModules();
		for (const name of request.workspace.removedModules) current.deleteModule(name);
		for (const module of request.workspace.modules) current.setModule(module.name, module.source, module.kind, module.environment);
	}
	async function dispatchWithModules(current, request) {
		current.beginOperation();
		while (true) {
			const result = dispatch(current, request);
			const requested = current.takeModuleRequests();
			if (requested.length === 0 || !request.resolveModules) return result;
			let resolved = false;
			for (const moduleRequest of requested) {
				const module = await resolveModule(request.id, moduleRequest);
				current.resolveModuleRequest(moduleRequest, module);
				resolved ||= module !== void 0;
			}
			if (!resolved) return result;
		}
	}
	function resolveModule(id, request) {
		const resolution = nextResolution;
		nextResolution = resolution >= Number.MAX_SAFE_INTEGER ? 1 : resolution + 1;
		return new Promise((resolve, reject) => {
			resolutions.set(resolution, {
				resolve,
				reject
			});
			try {
				port.postMessage({
					protocol: 3,
					id,
					action: "resolveModule",
					resolution,
					from: request.from,
					specifier: request.specifier
				});
			} catch (error) {
				resolutions.delete(resolution);
				reject(error);
			}
		});
	}
}
function dispatch(analysis, request) {
	switch (request.action) {
		case "check": return analysis.check(request.name);
		case "checkModules": return analysis.checkModules(request.names);
		case "autocomplete": return analysis.autocomplete(request.name, request.position);
		case "fragmentAutocomplete": return analysis.fragmentAutocomplete(request.name, request.source, request.position);
		case "typeAt": return analysis.typeAt(request.name, request.position);
		case "expectedTypeAt": return analysis.expectedTypeAt(request.name, request.position);
		case "inspectAt": return analysis.inspectAt(request.name, request.position);
		case "decorateWithTypes": return analysis.decorateWithTypes(request.name);
		case "documentationSymbolAt": return analysis.documentationSymbolAt(request.name, request.position);
		case "moduleReturnType": return analysis.moduleReturnType(request.name);
		case "requiredModules": return analysis.requiredModules(request.name);
	}
}
//#endregion
//#region src/analysis-worker-entry.ts
const worker = self;
serveAnalysisWorkerOn({
	addEventListener(_type, listener) {
		worker.addEventListener("message", listener);
	},
	postMessage(message) {
		worker.postMessage(message);
	}
});
//#endregion
