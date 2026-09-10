import { describe, expect, it } from "vitest";
import {
	collectNestedPaths,
	isDotPath,
	lookupDotPath,
	resolveKey,
	setDotPath,
} from "../paths";

// The shape a Dissent Horizon unit spec actually has, since that is what the
// nested-column feature is for.
const spec = () => ({
	kind: "structure",
	build: { cost: { energy: 800 }, time: 25, requires: ["an_infrastructure"] },
	defense: { hp: 1000, armour: "MEDIUM" },
	footprint: [4, 4],
});

describe("lookupDotPath", () => {
	it("reads a leaf two levels down", () => {
		expect(lookupDotPath(spec(), "build.time")).toEqual({ found: true, value: 25 });
	});

	it("reads a leaf three levels down", () => {
		expect(lookupDotPath(spec(), "build.cost.energy")).toEqual({ found: true, value: 800 });
	});

	it("reads an object node, not just leaves", () => {
		expect(lookupDotPath(spec(), "build.cost")).toEqual({
			found: true,
			value: { energy: 800 },
		});
	});

	it("matches segments case-insensitively, as Obsidian does for keys", () => {
		expect(lookupDotPath(spec(), "Build.Time")).toEqual({ found: true, value: 25 });
	});

	it("indexes into an array", () => {
		expect(lookupDotPath(spec(), "footprint.1")).toEqual({ found: true, value: 4 });
	});

	it("reports a missing path rather than undefined", () => {
		expect(lookupDotPath(spec(), "build.nope")).toEqual({ found: false, value: undefined });
	});

	it("reports a path that runs through a scalar", () => {
		expect(lookupDotPath(spec(), "kind.nope").found).toBe(false);
	});

	it("distinguishes a stored null from a missing path", () => {
		expect(lookupDotPath({ a: { b: null } }, "a.b")).toEqual({ found: true, value: null });
	});
});

describe("setDotPath", () => {
	it("writes a leaf in place", () => {
		const fm = spec();
		expect(setDotPath(fm, "build.time", 40)).toBe(true);
		expect(fm.build.time).toBe(40);
	});

	it("writes through the key spelling the file already uses", () => {
		const fm = spec();
		setDotPath(fm, "Build.Time", 40);
		expect(fm.build.time).toBe(40);
		expect(Object.keys(fm.build)).toEqual(["cost", "time", "requires"]);
	});

	it("creates missing intermediate objects", () => {
		const fm: Record<string, unknown> = {};
		expect(setDotPath(fm, "build.cost.energy", 12)).toBe(true);
		expect(fm).toEqual({ build: { cost: { energy: 12 } } });
	});

	it("leaves the value alone when the path runs through a scalar", () => {
		const fm = spec();
		expect(setDotPath(fm, "kind.nope", 1)).toBe(false);
		expect(fm.kind).toBe("structure");
	});

	it("writes an array element", () => {
		const fm = spec();
		expect(setDotPath(fm, "footprint.0", 6)).toBe(true);
		expect(fm.footprint).toEqual([6, 4]);
	});

	it("refuses an array index that does not exist", () => {
		const fm = spec();
		expect(setDotPath(fm, "footprint.9", 6)).toBe(false);
		expect(fm.footprint).toEqual([4, 4]);
	});

	it("does not disturb unrelated keys", () => {
		const fm = spec();
		setDotPath(fm, "defense.hp", 1);
		expect(fm.defense).toEqual({ hp: 1, armour: "MEDIUM" });
		expect(fm.build.time).toBe(25);
	});
});

describe("collectNestedPaths", () => {
	it("offers every path below the top level, in declaration order", () => {
		expect(collectNestedPaths(spec(), { maxDepth: 3, maxPaths: 100 })).toEqual([
			"build.cost",
			"build.cost.energy",
			"build.time",
			"build.requires",
			"defense.hp",
			"defense.armour",
		]);
	});

	it("stops at the configured depth", () => {
		expect(collectNestedPaths(spec(), { maxDepth: 2, maxPaths: 100 })).toEqual([
			"build.cost",
			"build.time",
			"build.requires",
			"defense.hp",
			"defense.armour",
		]);
	});

	it("does not descend into arrays, whose indices are not stable columns", () => {
		const paths = collectNestedPaths({ authors: [{ name: "a" }] }, {
			maxDepth: 3,
			maxPaths: 100,
		});
		expect(paths).toEqual([]);
	});

	it("honours the ceiling", () => {
		expect(collectNestedPaths(spec(), { maxDepth: 3, maxPaths: 2 })).toHaveLength(2);
	});
});

describe("resolveKey and isDotPath", () => {
	it("returns the spelling in the record", () => {
		expect(resolveKey({ Build: 1 }, "build")).toBe("Build");
	});

	it("returns the requested spelling when absent, so it can be created", () => {
		expect(resolveKey({}, "build")).toBe("build");
	});

	it("recognises a dotted path", () => {
		expect(isDotPath("build.time")).toBe(true);
		expect(isDotPath("build")).toBe(false);
	});
});
