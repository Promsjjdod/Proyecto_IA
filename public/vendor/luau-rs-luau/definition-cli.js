#!/usr/bin/env node
import { t as generateDefinitions } from "./definition-generator-DKR_PBM_.js";
import { writeFile } from "node:fs/promises";
//#region src/definition-cli.ts
const args = process.argv.slice(2);
let entry;
let exportName;
let output;
let project;
const expandTypes = [];
for (let index = 0; index < args.length; index++) {
	const value = args[index];
	if (value === "--expand" || value === "--export" || value === "--out" || value === "--project") {
		const optionValue = args[++index];
		if (optionValue === void 0) throw new TypeError(`${value} requires a value`);
		if (value === "--expand") expandTypes.push(optionValue);
		else if (value === "--export") exportName = optionValue;
		else if (value === "--out") output = optionValue;
		else project = optionValue;
	} else if (value.startsWith("-")) throw new TypeError(`unknown option ${value}`);
	else if (entry === void 0) entry = value;
	else throw new TypeError(`unexpected argument ${value}`);
}
if (entry === void 0 || output === void 0) throw new TypeError("usage: luau-bindgen <entry.ts> --out <definitions.d.luau> [--export LuauGlobals] [--project tsconfig.json] [--expand Type]");
await writeFile(output, generateDefinitions({
	entry,
	...expandTypes.length === 0 ? {} : { expandTypes },
	...exportName === void 0 ? {} : { exportName },
	...project === void 0 ? {} : { project }
}));
//#endregion
export {};
