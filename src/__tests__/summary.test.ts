import { describe, expect, it } from "vitest";
import { summarize } from "../summary";

describe("summarize", () => {
	it("renders an object's pairs without the outer braces", () => {
		expect(summarize({ time: 25, hp: 1000 })).toBe("time: 25, hp: 1000");
	});

	it("keeps braces on a nested object so the shape is visible", () => {
		expect(summarize({ cost: { energy: 800 }, time: 25 })).toBe(
			"cost: {energy: 800}, time: 25"
		);
	});

	it("renders a list in flow style", () => {
		expect(summarize([4, 4])).toBe("[4, 4]");
	});

	it("marks an empty object and an empty list", () => {
		expect(summarize({})).toBe("{}");
		expect(summarize([])).toBe("[]");
	});

	it("renders null as empty rather than the word null", () => {
		expect(summarize({ a: null })).toBe("a: ");
	});

	it("truncates once the budget runs out", () => {
		const wide = Object.fromEntries(
			Array.from({ length: 40 }, (_, i) => [`k${i}`, i])
		);
		const text = summarize(wide, 40);
		expect(text.endsWith("…")).toBe(true);
		expect(text.length).toBeLessThan(80);
	});
});
