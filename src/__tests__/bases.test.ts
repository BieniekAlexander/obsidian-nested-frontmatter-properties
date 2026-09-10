import { beforeEach, describe, expect, it } from "vitest";
import { installBasesNestedProperties, type BasesPrototypes } from "../bases";
import { isPlainObject } from "../detect";
import { parseBasesPropertyId, resolveKey } from "../paths";

// Stand-ins for the Bases internals the patches attach to, written to match
// the behaviour of Obsidian 1.13: a literal, case-insensitive frontmatter key
// lookup for `getRawProperty`, and a wrapped Value tree for `getValue`.

class FakeValue {
	constructor(readonly data: unknown) {}

	objectAccess(key: string): FakeValue | null {
		if (!isPlainObject(this.data)) {
			return null;
		}
		const actual = resolveKey(this.data, key);
		return Object.hasOwn(this.data, actual) ? new FakeValue(this.data[actual]) : null;
	}
}

const specFrontmatter = () => ({
	kind: "structure",
	build: { cost: { energy: 800 }, time: 25 },
	defense: { hp: 1000 },
});

interface FakeFile {
	path: string;
	extension: string;
}

let files: Map<string, Record<string, unknown>>;
let app: {
	metadataCache: { getFileCache(file: FakeFile): { frontmatter: unknown } | null };
	fileManager: {
		processFrontMatter(
			file: FakeFile,
			fn: (fm: Record<string, unknown>) => void
		): Promise<void>;
	};
};

const file: FakeFile = { path: "an_airField.md", extension: "md" };

// The originals, reimplemented from the shipped behaviour so a test failure
// means the patch changed something it should have left alone.
function makePrototypes(): BasesPrototypes {
	const entry = {
		getRawProperty(this: { frontmatter: Record<string, unknown> }, name: string): unknown {
			const key = resolveKey(this.frontmatter, name);
			return Object.hasOwn(this.frontmatter, key) ? this.frontmatter[key] : null;
		},
		getValue(this: { note: FakeValue }, id: string): unknown {
			const parsed = parseBasesPropertyId(id);
			return parsed.type === "note" ? this.note.objectAccess(parsed.name) : "not-a-note";
		},
	} as unknown as Record<string, unknown>;

	const view = {
		async updateProperty(
			this: { app: typeof app },
			target: FakeFile,
			key: string,
			value: unknown
		): Promise<void> {
			await this.app.fileManager.processFrontMatter(target, (fm) => {
				fm[resolveKey(fm, key)] = value;
			});
		},
		async createTransaction(
			this: { transactions: unknown[][] },
			build: (changes: unknown[]) => Promise<void>
		): Promise<void> {
			const changes: unknown[] = [];
			await build(changes);
			this.transactions.push(changes);
		},
	} as unknown as Record<string, unknown>;

	const controller = {
		getProperties(): string[] {
			return ["file.name", "note.kind", "note.build", "note.defense"];
		},
	} as unknown as Record<string, unknown>;

	return { entry, view, controller };
}

const options = () => ({ maxDepth: 3, maxPaths: 100, maxFilesScanned: 100 });

let prototypes: BasesPrototypes;
let uninstall: (() => void) | null;

const makeEntry = () =>
	Object.create(prototypes.entry) as {
		frontmatter: Record<string, unknown>;
		note: FakeValue;
		file: FakeFile;
		getRawProperty(name: string): unknown;
		getValue(id: string): unknown;
	};

const entryFor = (frontmatter: Record<string, unknown>) => {
	const entry = makeEntry();
	entry.frontmatter = frontmatter;
	entry.note = new FakeValue(frontmatter);
	entry.file = file;
	return entry;
};

const makeView = () =>
	Object.assign(Object.create(prototypes.view) as Record<string, unknown>, {
		app,
		transactions: [] as unknown[][],
	}) as unknown as {
		app: typeof app;
		transactions: unknown[][];
		updateProperty(file: FakeFile, key: string, value: unknown): Promise<void>;
	};

const makeController = () =>
	Object.assign(Object.create(prototypes.controller) as Record<string, unknown>, {
		app,
		results: new Map([[file.path, { file }]]),
	}) as unknown as { getProperties(): string[] };

beforeEach(() => {
	files = new Map([[file.path, specFrontmatter()]]);
	app = {
		metadataCache: {
			getFileCache: (target: FakeFile) => {
				const frontmatter = files.get(target.path);
				return frontmatter ? { frontmatter } : null;
			},
		},
		fileManager: {
			processFrontMatter: async (
				target: FakeFile,
				fn: (fm: Record<string, unknown>) => void
			) => {
				fn(files.get(target.path)!);
			},
		},
	};
	prototypes = makePrototypes();
	uninstall = installBasesNestedProperties(app as never, options, prototypes);
	expect(uninstall).not.toBeNull();
});

describe("reading a nested column", () => {
	it("resolves a dotted name the editor asks for", () => {
		expect(entryFor(files.get(file.path)!).getRawProperty("build.time")).toBe(25);
	});

	it("resolves three levels down", () => {
		expect(entryFor(files.get(file.path)!).getRawProperty("build.cost.energy")).toBe(800);
	});

	it("leaves a plain top-level name to the original", () => {
		expect(entryFor(files.get(file.path)!).getRawProperty("kind")).toBe("structure");
	});

	it("prefers a literal key that really is spelled with a dot", () => {
		const frontmatter = { "build.time": "literal", build: { time: 25 } };
		expect(entryFor(frontmatter).getRawProperty("build.time")).toBe("literal");
	});

	it("returns null for a path nothing has", () => {
		expect(entryFor(files.get(file.path)!).getRawProperty("build.nope")).toBeNull();
	});
});

describe("sorting and filtering a nested column", () => {
	it("walks the Value tree so the result compares like a top-level column", () => {
		const value = entryFor(files.get(file.path)!).getValue("note.build.time");
		expect(value).toBeInstanceOf(FakeValue);
		expect((value as FakeValue).data).toBe(25);
	});

	it("leaves formula properties to the original", () => {
		expect(entryFor(files.get(file.path)!).getValue("formula.total")).toBe("not-a-note");
	});

	it("leaves a plain note property to the original", () => {
		const value = entryFor(files.get(file.path)!).getValue("note.kind");
		expect((value as FakeValue).data).toBe("structure");
	});

	it("returns null rather than throwing when the path breaks", () => {
		expect(entryFor(files.get(file.path)!).getValue("note.kind.nope")).toBeNull();
	});
});

describe("editing a nested column", () => {
	it("writes the leaf and leaves its siblings alone", async () => {
		await makeView().updateProperty(file, "build.time", 40);
		expect(files.get(file.path)).toEqual({
			kind: "structure",
			build: { cost: { energy: 800 }, time: 40 },
			defense: { hp: 1000 },
		});
	});

	it("records an undoable transaction carrying the pre-edit frontmatter", async () => {
		const view = makeView();
		await view.updateProperty(file, "defense.hp", 12);
		expect(view.transactions).toHaveLength(1);
		const change = view.transactions[0]![0] as { start: Record<string, unknown> };
		expect(change.start.defense).toEqual({ hp: 1000 });
	});

	it("leaves a top-level write to the original", async () => {
		const view = makeView();
		await view.updateProperty(file, "kind", "unit");
		expect(files.get(file.path)!.kind).toBe("unit");
		expect(view.transactions).toHaveLength(0);
	});

	it("does not clobber a scalar standing where an object was expected", async () => {
		await makeView().updateProperty(file, "kind.nope", 1);
		expect(files.get(file.path)!.kind).toBe("structure");
	});
});

describe("offering nested columns", () => {
	it("appends the dotted paths found in the result set", () => {
		expect(makeController().getProperties()).toEqual([
			"file.name",
			"note.kind",
			"note.build",
			"note.defense",
			"note.build.cost",
			"note.build.cost.energy",
			"note.build.time",
			"note.defense.hp",
		]);
	});

	it("does not repeat a property the original already offered", () => {
		const ids = makeController().getProperties();
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("uninstalling", () => {
	it("restores every patched method", () => {
		uninstall?.();
		const entry = entryFor(files.get(file.path)!);
		expect(entry.getRawProperty("build.time")).toBeNull();
		expect(makeController().getProperties()).toHaveLength(4);
	});
});
