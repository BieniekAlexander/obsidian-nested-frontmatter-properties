// Dotted frontmatter paths ("build.cost.energy"), the addressing scheme Bases
// property ids use once the `note.` prefix is stripped. Pure and app-free.
//
// Obsidian resolves top-level property keys case-insensitively; these helpers
// do the same at every segment so `Build.Time` and `build.time` reach the same
// value, and so a write lands on the key the file already spells.

import { isPlainObject } from "./detect";

export interface DotLookup {
	// False means no such path — distinct from a path that holds null.
	found: boolean;
	value: unknown;
}

const NOT_FOUND: DotLookup = { found: false, value: undefined };

export function splitDotPath(path: string): string[] {
	return path.split(".");
}

export function isDotPath(path: string): boolean {
	return path.includes(".");
}

// The key `record` actually spells, matching case-insensitively; falls back to
// the requested spelling so callers can create it.
export function resolveKey(record: Record<string, unknown>, key: string): string {
	if (Object.hasOwn(record, key)) {
		return key;
	}
	const lower = key.toLowerCase();
	for (const actual of Object.keys(record)) {
		if (actual.toLowerCase() === lower) {
			return actual;
		}
	}
	return key;
}

function step(node: unknown, segment: string): DotLookup {
	if (isPlainObject(node)) {
		const key = resolveKey(node, segment);
		return Object.hasOwn(node, key)
			? { found: true, value: node[key] }
			: NOT_FOUND;
	}
	if (Array.isArray(node)) {
		const index = Number(segment);
		return Number.isInteger(index) && index >= 0 && index < node.length
			? { found: true, value: node[index] }
			: NOT_FOUND;
	}
	return NOT_FOUND;
}

export function lookupDotPath(root: unknown, path: string): DotLookup {
	let current: DotLookup = { found: true, value: root };
	for (const segment of splitDotPath(path)) {
		if (!current.found) {
			return NOT_FOUND;
		}
		current = step(current.value, segment);
	}
	return current;
}

// Writes `value` at `path`, creating missing intermediate objects. Mutates
// `root` in place because the only caller is a processFrontMatter callback,
// where Obsidian hands us the object it is about to serialize.
//
// Returns false when the path runs through a non-object (a scalar or an array
// index that does not exist); the caller leaves the file alone rather than
// overwriting a value whose shape it did not expect.
export function setDotPath(root: unknown, path: string, value: unknown): boolean {
	const segments = splitDotPath(path);
	const leaf = segments.pop();
	if (leaf === undefined) {
		return false;
	}
	let node: unknown = root;
	for (const segment of segments) {
		if (Array.isArray(node)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= node.length) {
				return false;
			}
			node = node[index];
			continue;
		}
		if (!isPlainObject(node)) {
			return false;
		}
		const key = resolveKey(node, segment);
		const next = node[key];
		if (isPlainObject(next) || Array.isArray(next)) {
			node = next;
			continue;
		}
		// An absent (or explicitly empty) step is filled in; one holding a
		// scalar is left alone, because replacing it would silently discard a
		// value the caller never asked about.
		if (next !== undefined && next !== null) {
			return false;
		}
		node[key] = {};
		node = node[key];
	}
	if (Array.isArray(node)) {
		const index = Number(leaf);
		if (!Number.isInteger(index) || index < 0 || index >= node.length) {
			return false;
		}
		node[index] = value;
		return true;
	}
	if (!isPlainObject(node)) {
		return false;
	}
	node[resolveKey(node, leaf)] = value;
	return true;
}

export interface NestedPathOptions {
	// Segments below the top-level key; 3 reaches `build.cost.energy`.
	maxDepth: number;
	// Ceiling on the returned list so a vault with wide frontmatter cannot
	// flood the property menu.
	maxPaths: number;
}

// Every dotted path reachable inside plain objects in `frontmatter`, depth
// first, in declaration order. Array contents are not descended into: an index
// path is stable only until something is inserted, which makes a poor column.
export function collectNestedPaths(
	frontmatter: unknown,
	options: NestedPathOptions,
	into: string[] = [],
	prefix = "",
	depth = 0
): string[] {
	if (!isPlainObject(frontmatter) || depth >= options.maxDepth) {
		return into;
	}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (into.length >= options.maxPaths) {
			return into;
		}
		const path = prefix === "" ? key : `${prefix}.${key}`;
		// The top level is already offered by Bases itself.
		if (depth > 0) {
			into.push(path);
		}
		if (isPlainObject(value)) {
			collectNestedPaths(value, options, into, path, depth + 1);
		}
	}
	return into;
}

export interface BasesPropertyId {
	type: "note" | "formula" | "file";
	name: string;
}

// Mirrors Obsidian's own `parsePropertyId`: only the FIRST dot separates the
// source from the name, and an unrecognised source means the whole id is a
// note property name. That last rule is what makes `build.time` a note
// property called "build.time" rather than a source called "build".
//
// Reimplemented rather than imported so the Bases integration depends on no
// runtime export that an older Obsidian might not have; the rule is part of
// the .base file format, not an implementation detail.
export function parseBasesPropertyId(id: string): BasesPropertyId {
	const dot = id.indexOf(".");
	if (dot === -1) {
		return { type: "note", name: id };
	}
	const source = id.slice(0, dot);
	if (source !== "note" && source !== "formula" && source !== "file") {
		return { type: "note", name: id };
	}
	return { type: source, name: id.slice(dot + 1) };
}
