//#region src/definition.d.ts
type LuauType = 'any' | 'unknown' | 'never' | 'nil' | 'boolean' | 'number' | 'integer' | 'string' | 'buffer' | 'thread' | 'function' | 'table' | 'vector' | {
  readonly kind: 'named';
  readonly name: string;
} | {
  readonly kind: 'raw';
  readonly source: string;
} | {
  readonly kind: 'optional';
  readonly value: LuauType;
} | {
  readonly kind: 'array';
  readonly value: LuauType;
} | {
  readonly kind: 'map';
  readonly key: LuauType;
  readonly value: LuauType;
} | {
  readonly kind: 'record';
  readonly properties: readonly Property[];
} | {
  readonly kind: 'function';
  readonly signature: Signature;
} | {
  readonly kind: 'union';
  readonly types: readonly LuauType[];
} | {
  readonly kind: 'intersection';
  readonly types: readonly LuauType[];
};
interface TypePack {
  readonly types: readonly LuauType[];
  readonly variadic?: LuauType;
}
interface Parameter {
  readonly name?: string;
  readonly type: LuauType;
}
interface Signature {
  readonly generics?: readonly string[];
  readonly parameters: readonly Parameter[];
  readonly variadic?: LuauType;
  readonly returns: TypePack;
}
interface Property {
  readonly name: string;
  readonly read?: LuauType;
  readonly write?: LuauType;
}
interface Method {
  readonly name: string;
  readonly signature: Signature;
}
interface ExternType {
  readonly name: string;
  readonly parent?: string;
  readonly properties?: readonly Property[];
  readonly methods?: readonly Method[];
  readonly indexer?: readonly [key: LuauType, value: LuauType];
}
declare const emptyPack: TypePack;
declare function pack(...types: LuauType[]): TypePack;
declare function variadicPack(type: LuauType): TypePack;
declare function named(name: string): LuauType;
declare function raw(source: string): LuauType;
declare function optional(value: LuauType): LuauType;
declare function array(value: LuauType): LuauType;
declare function map(key: LuauType, value: LuauType): LuauType;
declare function record(properties: readonly Property[]): LuauType;
declare function callable(signature: Signature): LuauType;
declare function union(types: readonly LuauType[]): LuauType;
declare function intersection(types: readonly LuauType[]): LuauType;
declare function parameter(name: string, type: LuauType): Parameter;
declare function property(name: string, type: LuauType): Property;
declare function readWriteProperty(name: string, read: LuauType, write: LuauType): Property;
declare function readonlyProperty(name: string, type: LuauType): Property;
declare function writeonlyProperty(name: string, type: LuauType): Property;
declare class DefinitionFile {
  #private;
  addExternType(type: ExternType): this;
  addGlobal(name: string, type: LuauType): this;
  toString(): string;
}
declare function isIdentifier(name: string): boolean;
declare function sanitizeIdentifier(name: string): string;
//#endregion
export { DefinitionFile, ExternType, LuauType, Method, Parameter, Property, Signature, TypePack, array, callable, emptyPack, intersection, isIdentifier, map, named, optional, pack, parameter, property, raw, readWriteProperty, readonlyProperty, record, sanitizeIdentifier, union, variadicPack, writeonlyProperty };