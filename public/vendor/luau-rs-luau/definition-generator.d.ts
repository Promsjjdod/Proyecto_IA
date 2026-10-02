//#region src/definition-generator.d.ts
interface GenerateDefinitionsOptions {
  entry: string;
  exportName?: string;
  project?: string;
  expandTypes?: readonly string[];
}
declare function generateDefinitions(options: GenerateDefinitionsOptions): string;
//#endregion
export { GenerateDefinitionsOptions, generateDefinitions };