// Nested frontmatter paths as live Bases columns.
//
// A Bases property id is `<source>.<name>`, and `parsePropertyId` keeps
// everything after the FIRST dot as the name — so `note.build.time` already
// arrives as a note-sourced property named "build.time", and Bases already
// gives note-sourced properties the editable metadata widget rather than the
// read-only renderer a formula gets. What is missing is that "build.time" is
// looked up as a literal frontmatter key, which no file has.
//
// These patches teach four methods to read a dotted name as a path. That is
// the whole feature: the column, its editor, sorting and filtering all fall
// out of Bases' existing note-property handling.
//
// Every patch is feature-detected and defers to the original whenever a
// literal key of that name exists, so a file that really does spell a key
// "build.time" keeps working the way it does today.

import { BasesEntry, BasesView, QueryController, type App, type TFile } from "obsidian";
import { around } from "monkey-around";
import { isPlainObject } from "./detect";
import {
	collectNestedPaths,
	isDotPath,
	lookupDotPath,
	parseBasesPropertyId,
	resolveKey,
	setDotPath,
	splitDotPath,
	type NestedPathOptions,
} from "./paths";

// Bases internals these patches read. All optional: a missing member means the
// patch stands down and Bases behaves as it does without the plugin.
interface EntryInternals {
	app?: App;
	file?: TFile;
	frontmatter?: Record<string, unknown>;
	note?: ValueLike;
}

interface ValueLike {
	objectAccess?(key: string): ValueLike | null;
}

interface ViewInternals {
	app?: App;
	createTransaction?(
		build: (changes: FrontmatterChange[]) => Promise<void>
	): Promise<void>;
}

interface FrontmatterChange {
	file: TFile;
	start: unknown;
	end: unknown;
}

interface ControllerInternals {
	app?: App;
	results?: Map<unknown, { file?: TFile }>;
}

export interface BasesOptions {
	// Segments below the top level offered as columns.
	maxDepth: number;
	// Ceiling on how many nested paths reach the property menu.
	maxPaths: number;
	// Files sampled when collecting the shapes; the union of frontmatter
	// shapes converges long before a large vault is exhausted.
	maxFilesScanned: number;
}

// The three prototypes the patches attach to. Passed in rather than reached
// for so the wiring can be exercised against stand-ins in tests.
export interface BasesPrototypes {
	entry: Record<string, unknown>;
	view: Record<string, unknown>;
	controller: Record<string, unknown>;
}

// Obsidian exports these classes, but only since Bases shipped; on an older
// build the imports are undefined and the integration stands down.
export function basesPrototypes(): BasesPrototypes | null {
	if (
		typeof BasesEntry !== "function" ||
		typeof BasesView !== "function" ||
		typeof QueryController !== "function"
	) {
		return null;
	}
	return {
		entry: BasesEntry.prototype as unknown as Record<string, unknown>,
		view: BasesView.prototype as unknown as Record<string, unknown>,
		controller: QueryController.prototype as unknown as Record<string, unknown>,
	};
}

// Returns an uninstaller, or null when this Obsidian build does not expose
// the Bases internals these patches attach to. The caller owns the
// uninstaller because the integration can be switched off without unloading
// the plugin.
export function installBasesNestedProperties(
	app: App,
	options: () => BasesOptions,
	prototypes: BasesPrototypes | null = basesPrototypes()
): (() => void) | null {
	if (!prototypes) {
		return null;
	}
	const { entry: entryProto, view: viewProto, controller: controllerProto } = prototypes;

	if (
		typeof entryProto.getRawProperty !== "function" ||
		typeof entryProto.getValue !== "function" ||
		typeof viewProto.updateProperty !== "function" ||
		typeof controllerProto.getProperties !== "function"
	) {
		return null;
	}

	const uninstallers = [
		around(entryProto, { getRawProperty: patchGetRawProperty }),
		around(entryProto, { getValue: patchGetValue }),
		around(viewProto, { updateProperty: patchUpdateProperty }),
		around(controllerProto, { getProperties: patchGetProperties(app, options) }),
	];
	return () => {
		for (const uninstall of uninstallers) {
			uninstall();
		}
	};
}

// The frontmatter a patch should read a dotted path out of. The entry carries
// its own copy; the metadata cache is the fallback if that member ever moves.
function frontmatterOf(entry: EntryInternals, app?: App): Record<string, unknown> | null {
	if (isPlainObject(entry.frontmatter)) {
		return entry.frontmatter;
	}
	const file = entry.file;
	const source = entry.app ?? app;
	if (!file || !source) {
		return null;
	}
	const cached = source.metadataCache.getFileCache(file)?.frontmatter;
	return isPlainObject(cached) ? cached : null;
}

// A literal key of this name wins over any path reading: the file said what it
// meant, and reinterpreting it would edit a different value than the one shown.
function hasLiteralKey(frontmatter: Record<string, unknown> | null, name: string): boolean {
	return frontmatter !== null && Object.hasOwn(frontmatter, resolveKey(frontmatter, name));
}

type RawPropertyFn = (this: EntryInternals, name: string) => unknown;

function patchGetRawProperty(next: RawPropertyFn): RawPropertyFn {
	return function (this: EntryInternals, name: string): unknown {
		if (!isDotPath(name)) {
			return next.call(this, name);
		}
		const frontmatter = frontmatterOf(this);
		if (hasLiteralKey(frontmatter, name)) {
			return next.call(this, name);
		}
		const found = lookupDotPath(frontmatter, name);
		return found.found ? found.value : null;
	};
}

type GetValueFn = (this: EntryInternals, id: string) => unknown;

function patchGetValue(next: GetValueFn): GetValueFn {
	return function (this: EntryInternals, id: string): unknown {
		const parsed = parseBasesPropertyId(id);
		if (parsed.type !== "note" || !isDotPath(parsed.name)) {
			return next.call(this, id);
		}
		const frontmatter = frontmatterOf(this);
		if (hasLiteralKey(frontmatter, parsed.name)) {
			return next.call(this, id);
		}
		// Walking the note's own Value tree rather than the raw frontmatter is
		// what keeps sort, filter and group comparing like with like: each
		// step returns the same wrapped Value that a top-level column gets.
		let node: ValueLike | null | undefined = this.note;
		for (const segment of splitDotPath(parsed.name)) {
			if (!node || typeof node.objectAccess !== "function") {
				return null;
			}
			node = node.objectAccess(segment);
		}
		return node ?? null;
	};
}

type UpdatePropertyFn = (
	this: ViewInternals,
	file: TFile,
	key: string,
	value: unknown
) => Promise<void>;

function patchUpdateProperty(next: UpdatePropertyFn): UpdatePropertyFn {
	return async function (
		this: ViewInternals,
		file: TFile,
		key: string,
		value: unknown
	): Promise<void> {
		const app = this.app;
		if (!isDotPath(key) || !app) {
			return next.call(this, file, key, value);
		}
		const cached = app.metadataCache.getFileCache(file)?.frontmatter;
		if (hasLiteralKey(isPlainObject(cached) ? cached : null, key)) {
			return next.call(this, file, key, value);
		}
		// Mirrors the change record Bases' own undo replays: a deep copy of
		// the frontmatter before the edit, and the live object it mutates.
		const write = async (changes: FrontmatterChange[]): Promise<void> => {
			await app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					changes.push({
						file,
						start: structuredClone(frontmatter),
						end: frontmatter,
					});
					setDotPath(frontmatter, key, value);
				}
			);
		};
		if (typeof this.createTransaction === "function") {
			await this.createTransaction(write);
			return;
		}
		await write([]);
	};
}

type GetPropertiesFn = (this: ControllerInternals) => string[];

function patchGetProperties(
	app: App,
	options: () => BasesOptions
): (next: GetPropertiesFn) => GetPropertiesFn {
	return (next) =>
		function (this: ControllerInternals): string[] {
			const base = next.call(this);
			if (!Array.isArray(base)) {
				return base;
			}
			const nested = nestedPropertyIds(this.app ?? app, this, options());
			const known = new Set(base);
			return base.concat(nested.filter((id) => !known.has(id)));
		};
}

// Cheap enough to recompute, but `getProperties` runs on every keystroke in
// the property search field, so the scan is held briefly.
const CACHE_MS = 1000;
const cache = new WeakMap<object, { at: number; ids: string[] }>();

function nestedPropertyIds(
	app: App,
	controller: ControllerInternals,
	options: BasesOptions
): string[] {
	const cached = cache.get(controller);
	const now = Date.now();
	if (cached && now - cached.at < CACHE_MS) {
		return cached.ids;
	}
	const pathOptions: NestedPathOptions = {
		maxDepth: options.maxDepth,
		maxPaths: options.maxPaths,
	};
	const seen = new Set<string>();
	const ids: string[] = [];
	let scanned = 0;
	for (const frontmatter of frontmatterSources(app, controller)) {
		if (scanned >= options.maxFilesScanned || ids.length >= options.maxPaths) {
			break;
		}
		scanned += 1;
		for (const path of collectNestedPaths(frontmatter, pathOptions)) {
			if (seen.has(path)) {
				continue;
			}
			seen.add(path);
			ids.push(`note.${path}`);
		}
	}
	ids.sort();
	cache.set(controller, { at: now, ids });
	return ids;
}

// Only the files this base actually matched: a nested column is offered
// because something in the result set has that shape, not because some
// unrelated corner of the vault does.
function* frontmatterSources(
	app: App,
	controller: ControllerInternals
): Generator<Record<string, unknown>> {
	const results = controller.results;
	if (!results || typeof results.values !== "function") {
		return;
	}
	for (const entry of results.values()) {
		const file = entry?.file;
		if (!file) {
			continue;
		}
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		if (isPlainObject(frontmatter)) {
			yield frontmatter;
		}
	}
}
