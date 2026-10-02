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
/**
* Checks if the input matches the schema. By using a type predicate, this
* function can be used as a type guard.
*
* @param schema The schema to be used.
* @param input The input to be tested.
*
* @returns Whether the input matches the schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function is(schema, input) {
	return !schema["~run"]({ value: input }, ABORT_EARLY_CONFIG).issues;
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
function custom(check$1, message$1) {
	return {
		kind: "schema",
		type: "custom",
		reference: custom,
		expects: "unknown",
		async: false,
		check: check$1,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (this.check(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function function_(message$1) {
	return {
		kind: "schema",
		type: "function",
		reference: function_,
		expects: "Function",
		async: false,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "function") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	};
}
/* @__NO_SIDE_EFFECTS__ */
function instance(class_, message$1) {
	return {
		kind: "schema",
		type: "instance",
		reference: instance,
		expects: class_.name,
		async: false,
		class: class_,
		message: message$1,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset, config$1) {
			if (dataset.value instanceof this.class) dataset.typed = true;
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
/**
* Creates a unknown schema.
*
* @returns A unknown schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function unknown() {
	return {
		kind: "schema",
		type: "unknown",
		reference: unknown,
		expects: "unknown",
		async: false,
		get "~standard"() {
			return /* @__PURE__ */ _getStandardProps(this);
		},
		"~run"(dataset) {
			dataset.typed = true;
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
const ResolutionId = /* @__PURE__ */ pipe(/* @__PURE__ */ number(), /* @__PURE__ */ safeInteger(), /* @__PURE__ */ minValue(1));
const AnalysisModuleRequestSchema = /* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	action: /* @__PURE__ */ literal("resolveModule"),
	resolution: ResolutionId,
	from: AnalysisModuleNameSchema,
	specifier: /* @__PURE__ */ string()
});
const AnalysisModuleResponseSchema = /* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	action: /* @__PURE__ */ literal("resolveModule"),
	resolution: ResolutionId,
	module: /* @__PURE__ */ optional(AnalysisModuleSchema),
	error: /* @__PURE__ */ optional(/* @__PURE__ */ string())
});
const AnalysisWorkerResponseSchema = /* @__PURE__ */ variant("ok", [/* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	ok: /* @__PURE__ */ literal(true),
	result: /* @__PURE__ */ unknown()
}), /* @__PURE__ */ object({
	protocol: /* @__PURE__ */ literal(3),
	id: RequestId,
	ok: /* @__PURE__ */ literal(false),
	error: /* @__PURE__ */ object({
		name: /* @__PURE__ */ string(),
		message: /* @__PURE__ */ string()
	})
})]);
//#endregion
export { string as C, safeParse as S, function_ as _, AnalysisWorkerResponseSchema as a, object as b, AnalysisLintSchema as c, AnalysisModuleSchema as d, AnalysisOptionsSchema as f, custom as g, parseAnalysisResult as h, AnalysisWorkerRequestSchema as i, AnalysisModeSchema as l, parseAnalysisInput as m, AnalysisModuleResponseSchema as n, AnalysisDefinitionSchema as o, AnalysisPositionSchema as p, AnalysisWorkerEnvelopeSchema as r, AnalysisGlobalsSchema as s, AnalysisModuleRequestSchema as t, AnalysisModuleNameSchema as u, instance as v, union as w, optional as x, is as y };
