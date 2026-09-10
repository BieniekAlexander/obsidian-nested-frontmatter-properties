// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Minimal shims for the Obsidian DOM helper prototypes the widget uses.
interface ElInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string>;
	type?: string;
}

beforeAll(() => {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto["createEl"] = function (this: HTMLElement, tag: string, info?: ElInfo) {
		const el = document.createElement(tag);
		if (info?.cls) {
			const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(" ");
			el.classList.add(...classes);
		}
		if (info?.text) {
			el.textContent = info.text;
		}
		if (info?.type && el instanceof HTMLInputElement) {
			el.type = info.type;
		}
		if (info?.attr) {
			for (const [k, v] of Object.entries(info.attr)) {
				el.setAttribute(k, v);
			}
		}
		this.appendChild(el);
		return el;
	};
	proto["createDiv"] = function (this: HTMLElement, info?: ElInfo) {
		return (this as unknown as { createEl: (t: string, i?: ElInfo) => HTMLElement }).createEl("div", info);
	};
	proto["createSpan"] = function (this: HTMLElement, info?: ElInfo) {
		return (this as unknown as { createEl: (t: string, i?: ElInfo) => HTMLElement }).createEl("span", info);
	};
	proto["empty"] = function (this: HTMLElement) {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
	};
	proto["addClass"] = function (this: HTMLElement, ...classes: string[]) {
		this.classList.add(...classes);
	};
	proto["removeClass"] = function (this: HTMLElement, ...classes: string[]) {
		this.classList.remove(...classes);
	};
});

import { renderNestedValue } from "../widget";

let root: HTMLElement;
let commits: unknown[];

const render = (value: unknown) => {
	root = document.createElement("div");
	document.body.appendChild(root);
	commits = [];
	renderNestedValue(root, value, (v) => commits.push(structuredClone(v)));
};

const keyNames = (scope: Element): string[] =>
	Array.from(scope.querySelectorAll<HTMLInputElement>(".nfp-key")).map((el) => el.value);

const click = (el: Element | null) => {
	expect(el).not.toBeNull();
	(el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const pressEnter = (el: Element | null) => {
	expect(el).not.toBeNull();
	(el as HTMLElement).dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
	);
};

const addProperty = (scope: Element, name: string, kindLabel?: string) => {
	const addButton = Array.from(scope.querySelectorAll(".nfp-add")).find(
		(el) => el.textContent?.includes("Add property")
	);
	click(addButton ?? null);
	const input = scope.querySelector<HTMLInputElement>(".nfp-add-form input");
	expect(input).not.toBeNull();
	input!.value = name;
	if (kindLabel) {
		click(scope.querySelector(`.nfp-add-form [aria-label="${kindLabel}"]`));
	} else {
		pressEnter(input);
	}
};

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("adding properties", () => {
	it("adds a text property on Enter and renders its row", () => {
		render({});
		addProperty(root, "title");
		expect(commits).toEqual([{ title: "" }]);
		expect(keyNames(root)).toEqual(["title"]);
	});

	it("adds an object property, then a property inside it", () => {
		render({});
		addProperty(root, "config", "Add object");
		expect(commits).toEqual([{ config: {} }]);

		// The nested object's own add button is inside its row.
		const nested = root.querySelector(".nfp-value");
		expect(nested).not.toBeNull();
		addProperty(nested!, "mode");
		expect(commits[1]).toEqual({ config: { mode: "" } });
		expect(keyNames(root)).toEqual(["config", "mode"]);
	});

	it("adds a list property and an object item inside it", () => {
		render({});
		addProperty(root, "authors", "Add list");
		expect(commits[0]).toEqual({ authors: [] });

		const addItem = Array.from(root.querySelectorAll(".nfp-add")).find(
			(el) => el.textContent?.includes("Add item")
		);
		click(addItem ?? null);
		click(root.querySelector('.nfp-add-form [aria-label="Add object"]'));
		expect(commits[1]).toEqual({ authors: [{}] });
	});

	it("does not commit duplicate or empty names", () => {
		render({ title: "x" });
		addProperty(root, "title");
		addProperty(root, "  ");
		expect(commits).toEqual([]);
	});
});

describe("blur-cascade resilience", () => {
	// Obsidian's Enter keymap blurs the input before our keydown handler runs;
	// the blur cascade dismisses the form and can leave form.remove() throwing
	// (NotFoundError). Submit must still commit.
	it("commits on Enter even when blur already dismissed the form", () => {
		render({});
		click(Array.from(root.querySelectorAll(".nfp-add")).find((el) => el.textContent?.includes("Add property")) ?? null);
		const form = root.querySelector<HTMLElement>(".nfp-add-form")!;
		const input = form.querySelector<HTMLInputElement>("input")!;
		input.value = "late";
		// Simulate the keymap blur: focusout with no related target dismisses.
		input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		expect(root.querySelector(".nfp-add-form")).toBeNull();
		// A second removal attempt throws, as observed in the live app.
		form.remove = () => {
			throw new DOMException("The node to be removed is no longer a child of this node.", "NotFoundError");
		};
		pressEnter(input);
		expect(commits).toEqual([{ late: "" }]);
	});
});

describe("removing properties", () => {
	it("removes an object property via its remove button", () => {
		render({ title: "x", count: 2 });
		click(root.querySelector(".nfp-remove"));
		expect(commits).toEqual([{ count: 2 }]);
		expect(keyNames(root)).toEqual(["count"]);
	});

	it("removes an array item", () => {
		render([{ name: "a" }, { name: "b" }]);
		const itemRemove = root.querySelector(".nfp-array-item > .nfp-remove");
		click(itemRemove);
		expect(commits).toEqual([[{ name: "b" }]]);
	});

	it("sequential structural edits compose instead of clobbering", () => {
		render({ a: 1, b: 2, c: 3 });
		click(root.querySelector(".nfp-remove"));
		click(root.querySelector(".nfp-remove"));
		expect(commits).toEqual([{ b: 2, c: 3 }, { c: 3 }]);
	});
});

describe("editing values after structural changes", () => {
	it("scalar edit then removal keeps the edit", () => {
		render({ a: "old", b: "keep" });
		const input = root.querySelector<HTMLInputElement>('.nfp-value input[type="text"]');
		input!.value = "new";
		input!.dispatchEvent(new FocusEvent("blur"));
		expect(commits[0]).toEqual({ a: "new", b: "keep" });

		// Remove the second row; the first edit must survive in the commit.
		const removes = root.querySelectorAll(".nfp-remove");
		click(removes[1] ?? null);
		expect(commits[1]).toEqual({ a: "new" });
	});
});

describe("renaming object keys", () => {
	const renameFirstKey = (to: string) => {
		const key = root.querySelector<HTMLInputElement>(".nfp-key")!;
		key.value = to;
		key.dispatchEvent(new FocusEvent("blur"));
		return key;
	};

	it("renames a key and keeps its value and position", () => {
		render({ a: 1, b: 2 });
		renameFirstKey("alpha");
		expect(commits).toEqual([{ alpha: 1, b: 2 }]);
		expect(keyNames(root)).toEqual(["alpha", "b"]);
	});

	it("renames a nested key without disturbing its siblings", () => {
		render({ build: { time: 25, cost: 3 } });
		const nestedKey = root.querySelectorAll<HTMLInputElement>(".nfp-key")[1]!;
		nestedKey.value = "seconds";
		nestedKey.dispatchEvent(new FocusEvent("blur"));
		expect(commits).toEqual([{ build: { seconds: 25, cost: 3 } }]);
	});

	it("refuses a name already taken by a sibling", () => {
		render({ a: 1, b: 2 });
		const key = renameFirstKey("b");
		expect(commits).toEqual([]);
		expect(key.value).toBe("a");
	});

	it("refuses an empty name", () => {
		render({ a: 1 });
		const key = renameFirstKey("   ");
		expect(commits).toEqual([]);
		expect(key.value).toBe("a");
	});

	it("reverts on Escape without committing", () => {
		render({ a: 1 });
		const key = root.querySelector<HTMLInputElement>(".nfp-key")!;
		key.value = "zzz";
		key.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
		);
		expect(key.value).toBe("a");
		expect(commits).toEqual([]);
	});
});

describe("add-form buttons hold focus", () => {
	// On macOS a mousedown on a <button> does not focus it, so without
	// preventDefault the key input blurs to nothing, focusout tears the form
	// down, and the click lands on a detached node: the form appears to close
	// without adding anything.
	it("suppresses the default mousedown on kind buttons", () => {
		render({});
		click(
			Array.from(root.querySelectorAll(".nfp-add")).find((el) =>
				el.textContent?.includes("Add property")
			) ?? null
		);
		const button = root.querySelector<HTMLElement>('.nfp-add-form [aria-label="Add object"]')!;
		const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it("suppresses the default mousedown on the add button itself", () => {
		render({});
		const addButton = Array.from(root.querySelectorAll(".nfp-add")).find((el) =>
			el.textContent?.includes("Add property")
		) as HTMLElement;
		const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		addButton.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});
});

describe("the editor mode is one global preference", () => {
	// Obsidian renders every visible cell up front, so an editor that captured
	// the mode at render time keeps drawing in whichever mode was current when
	// the table was built — the mode has to be read at each draw instead.
	it("reads the mode at every draw rather than capturing it", () => {
		let mode: "tree" | "yaml" = "tree";
		root = document.createElement("div");
		document.body.appendChild(root);
		const handle = renderNestedValue(root, { a: 1 }, () => undefined, {
			mode: () => mode,
		});
		expect(root.querySelector("textarea")).toBeNull();

		mode = "yaml";
		handle.redraw();
		expect(root.querySelector("textarea")).not.toBeNull();
	});

	it("reports a switch through setMode instead of keeping it locally", () => {
		let mode: "tree" | "yaml" = "tree";
		root = document.createElement("div");
		document.body.appendChild(root);
		renderNestedValue(root, { a: 1 }, () => undefined, {
			mode: () => mode,
			setMode: (next) => {
				mode = next;
			},
		});
		click(root.querySelector(".nfp-mode-switch"));
		expect(mode).toBe("yaml");
	});

	it("draws no mode switch when the caller cannot store the choice", () => {
		render({ a: 1 });
		expect(root.querySelector(".nfp-mode-switch")).toBeNull();
	});
});
