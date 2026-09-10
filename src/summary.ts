// A one-line rendering of a nested value, for the collapsed state of a Bases
// table cell. A table row is one line tall and clips its overflow, so the
// stacked tree the Properties panel draws is unreadable there — this is what
// the cell shows until it is focused.

import { isPlainObject } from "./detect";

const ELLIPSIS = "…";

function scalarText(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	// A YAML timestamp reaches the frontmatter as a Date; anything else here
	// is a shape flow() does not descend into, so name it rather than
	// rendering "[object Object]".
	return value instanceof Date ? value.toISOString() : "?";
}

function flow(value: unknown, budget: number): string {
	if (Array.isArray(value)) {
		return `[${joinParts(value.map((item) => () => flow(item, budget)), budget - 2)}]`;
	}
	if (isPlainObject(value)) {
		const parts = Object.entries(value).map(
			([key, item]) => () => `${key}: ${flow(item, budget - key.length - 2)}`
		);
		return `{${joinParts(parts, budget - 2)}}`;
	}
	return scalarText(value);
}

// Renders parts left to right until the budget runs out, so a wide object
// shows its first keys rather than a truncated blob of the whole thing.
function joinParts(parts: (() => string)[], budget: number): string {
	const rendered: string[] = [];
	let used = 0;
	for (const part of parts) {
		if (used >= budget) {
			rendered.push(ELLIPSIS);
			break;
		}
		const text = part();
		rendered.push(text);
		used += text.length + 2;
	}
	return rendered.join(", ");
}

// `budget` is a soft character target, not a hard limit: the CSS ellipsis
// handles the real cell width, and this only keeps the string from being
// megabytes long for a deeply nested value.
export function summarize(value: unknown, budget = 120): string {
	if (Array.isArray(value) && value.length === 0) {
		return "[]";
	}
	if (isPlainObject(value) && Object.keys(value).length === 0) {
		return "{}";
	}
	// The outer braces are noise on the cell's own value; the shape is already
	// clear from the key: value pairs, and dropping them buys width.
	const text = flow(value, budget);
	return isPlainObject(value) ? text.slice(1, -1) : text;
}
