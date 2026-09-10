import { parseYaml, setIcon, stringifyYaml } from "obsidian";
import { isPlainObject } from "./detect";
import {
	addArrayItem,
	addObjectKey,
	blankLike,
	cloneValue,
	getAtPath,
	removeAtPath,
	renameKey,
	setAtPath,
	type Leaf,
	type Path,
} from "./edit-ops";

export type CommitFn = (value: unknown) => void;

// "tree" draws one row per key — the document-style editor, and the default.
// "yaml" hands the whole value over as text, the escape hatch for shapes the
// row editor is clumsy at: reordering keys, pasting a block in from elsewhere.
export type EditorMode = "tree" | "yaml";

export interface NestedEditorOptions {
	// Read at every draw rather than captured once. The mode is one global
	// preference, not a per-cell state: Obsidian renders every visible cell
	// up front, so a captured value leaves every OTHER cell drawing in
	// whichever mode was current when the table was built.
	mode(): EditorMode;
	// When set, the editor draws a mode switch and reports the user's choice
	// so the caller can store it.
	setMode?(mode: EditorMode): void;
}

// A drawn editor, so a caller holding one can ask it to redraw when the
// global mode changed underneath it.
export interface NestedEditorHandle {
	redraw(): void;
}

const DEFAULT_OPTIONS: NestedEditorOptions = { mode: () => "tree" };

// Handlers must read and write through these, never through render-time
// snapshots: Obsidian does not re-render a property widget after every
// change, so a snapshot can be stale by the time a handler runs.
interface TreeOps {
	current(): unknown;
	scalar(next: unknown): void;
	structural(next: unknown): void;
}

// Renders one nested property value as an editable tree. All persistence goes
// through `commit`, which receives the full updated top-level value. The
// widget owns a mutable model and redraws itself after structural changes
// (add/remove/rename) rather than relying on Obsidian re-rendering.
export function renderNestedValue(
	root: HTMLElement,
	value: unknown,
	commit: CommitFn,
	options: NestedEditorOptions = DEFAULT_OPTIONS
): NestedEditorHandle {
	let model = cloneValue(value);
	const draw = () => {
		const mode = options.mode();
		root.empty();
		root.addClass("nfp-root");
		if (options.setMode) {
			renderModeSwitch(root, mode, (next) => {
				options.setMode?.(next);
				draw();
				// The redraw removes whatever held focus. In a table cell that
				// reads as focus leaving, which closes the cell — so the new
				// editor takes focus straight away.
				focusFirstField(root);
			});
		}
		if (mode === "yaml") {
			renderYaml(root, ops);
		} else {
			renderNode(root, model, [], ops);
		}
	};
	const ops: TreeOps = {
		current: () => model,
		scalar: (next) => {
			model = next;
			commit(model);
		},
		structural: (next) => {
			model = next;
			commit(model);
			draw();
			// The redraw removes whatever held focus. Inside a table cell that
			// drops :focus-within, which clips the editor back to one row, so
			// the new drawing takes focus.
			focusFirstField(root);
		},
	};
	draw();
	return { redraw: draw };
}

// The first thing a freshly drawn editor should hand focus to.
export function focusFirstField(root: HTMLElement): void {
	const field = root.querySelector<HTMLElement>(
		"textarea, input:not([type='checkbox']), input, button"
	);
	field?.focus();
}

function renderModeSwitch(
	root: HTMLElement,
	mode: EditorMode,
	onPick: (mode: EditorMode) => void
): void {
	const next: EditorMode = mode === "tree" ? "yaml" : "tree";
	const button = root.createEl("button", {
		cls: "clickable-icon nfp-mode-switch",
		attr: {
			"aria-label": next === "yaml" ? "Edit as YAML" : "Edit as document",
		},
	});
	setIcon(button, next === "yaml" ? "lucide-file-code" : "lucide-list-tree");
	// Clicking must not move focus: in a table cell or a popover, losing focus
	// collapses the editor before the click is delivered.
	button.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		onPick(next);
	});
}

// The whole value as YAML text. Obsidian's own serializer is used in both
// directions, so what is shown is what would be written to the file.
function renderYaml(root: HTMLElement, ops: TreeOps): void {
	const textarea = root.createEl("textarea", { cls: "nfp-yaml" });
	const errorEl = root.createDiv({ cls: "nfp-yaml-error nfp-hidden" });
	const serialize = (value: unknown): string => {
		const text = stringifyYaml(value);
		return text === "\n" ? "" : text.replace(/\n$/, "");
	};
	let committed = serialize(ops.current());
	textarea.value = committed;
	const fit = () => {
		textarea.rows = Math.min(textarea.value.split("\n").length + 1, 20);
	};
	fit();

	const commitText = (): boolean => {
		if (!textarea.isConnected || textarea.value === committed) {
			return true;
		}
		let parsed: unknown;
		try {
			// An empty document parses to null; the property's own shape is a
			// better empty than that, so keep whichever container it had.
			parsed =
				textarea.value.trim() === ""
					? emptyLike(ops.current())
					: parseYaml(textarea.value);
		} catch (error) {
			errorEl.setText(error instanceof Error ? error.message : String(error));
			errorEl.removeClass("nfp-hidden");
			return false;
		}
		errorEl.addClass("nfp-hidden");
		committed = textarea.value;
		ops.scalar(parsed);
		return true;
	};

	textarea.addEventListener("input", fit);
	textarea.addEventListener("blur", () => {
		commitText();
	});
	textarea.addEventListener("keydown", (event) => {
		// Enter is a newline here, so committing needs its own chord. Both are
		// stopped from reaching Obsidian's metadata-editor keymap.
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopPropagation();
			if (commitText()) {
				textarea.blur();
			}
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			textarea.value = committed;
			errorEl.addClass("nfp-hidden");
			fit();
			textarea.blur();
		} else if (event.key === "Enter") {
			event.stopPropagation();
		}
	});
}

function emptyLike(value: unknown): unknown {
	if (Array.isArray(value)) {
		return [];
	}
	return isPlainObject(value) ? {} : null;
}

function renderNode(el: HTMLElement, node: unknown, path: Path, ops: TreeOps): void {
	if (Array.isArray(node)) {
		renderArray(el, node, path, ops);
	} else if (isPlainObject(node)) {
		renderObject(el, node, path, ops);
	} else {
		renderLeaf(el, node as Leaf, path, ops);
	}
}

function renderObject(
	el: HTMLElement,
	node: Record<string, unknown>,
	path: Path,
	ops: TreeOps
): void {
	const container = el.createDiv({ cls: "nfp-object" });
	for (const [key, value] of Object.entries(node)) {
		const row = container.createDiv({ cls: "nfp-row" });
		renderKey(row, key, [...path, key], ops);
		const valueEl = row.createDiv({ cls: "nfp-value" });
		renderNode(valueEl, value, [...path, key], ops);
		addRemoveButton(row, [...path, key], ops);
	}
	const addButton = createAddButton(container, "Add property");
	addButton.addEventListener("click", () => {
		openAddForm(container, addButton, (form, dismiss) => {
			const input = form.createEl("input", {
				cls: "nfp-input",
				type: "text",
				attr: { placeholder: "Property name" },
			});
			const submit = (make: () => unknown) => {
				const key = input.value.trim();
				const target = getAtPath(ops.current(), path);
				if (!key || (isPlainObject(target) && key in target)) {
					input.focus();
					return;
				}
				dismiss();
				ops.structural(addObjectKey(ops.current(), path, key, make()));
			};
			appendKindButtons(form, submit);
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					submit(() => "");
				}
			});
			input.focus();
		});
	});
}

// An object key, editable in place. Renaming rebuilds the object to keep key
// order, so it is a structural change and the tree redraws under it.
function renderKey(row: HTMLElement, key: string, path: Path, ops: TreeOps): void {
	const input = row.createEl("input", {
		cls: "nfp-key nfp-key-input",
		type: "text",
	});
	input.value = key;
	const fit = () => {
		input.size = Math.max(input.value.length, 1);
	};
	fit();
	input.addEventListener("input", fit);

	const commitKey = () => {
		if (!input.isConnected) {
			return;
		}
		const next = input.value.trim();
		const parent = getAtPath(ops.current(), path.slice(0, -1));
		// An empty or colliding name would silently drop a value; refuse it
		// and hand the field back rather than guessing at an alternative.
		if (next === "" || (next !== key && isPlainObject(parent) && next in parent)) {
			input.value = key;
			fit();
			return;
		}
		if (next !== key) {
			ops.structural(renameKey(ops.current(), path, next));
		}
	};

	input.addEventListener("blur", commitKey);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			input.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			input.value = key;
			fit();
			input.blur();
		}
	});
}

function renderArray(el: HTMLElement, node: unknown[], path: Path, ops: TreeOps): void {
	const container = el.createDiv({ cls: "nfp-array" });
	node.forEach((item, index) => {
		const itemEl = container.createDiv({ cls: "nfp-array-item" });
		const body = itemEl.createDiv({ cls: "nfp-array-item-body" });
		renderNode(body, item, [...path, index], ops);
		addRemoveButton(itemEl, [...path, index], ops);
	});
	const addButton = createAddButton(container, "Add item");
	addButton.addEventListener("click", () => {
		// Non-empty arrays keep growing in the shape of their last item; an
		// empty array offers a choice of what its items should be.
		const target = getAtPath(ops.current(), path);
		const items = Array.isArray(target) ? target : [];
		if (items.length > 0) {
			ops.structural(addArrayItem(ops.current(), path, blankLike(items[items.length - 1])));
			return;
		}
		openAddForm(container, addButton, (form, dismiss) => {
			appendKindButtons(form, (make) => {
				dismiss();
				ops.structural(addArrayItem(ops.current(), path, make()));
			});
			const first = form.querySelector("button");
			if (first instanceof HTMLElement) {
				first.focus();
			}
		});
	});
}

function renderLeaf(el: HTMLElement, value: Leaf, path: Path, ops: TreeOps): void {
	if (typeof value === "boolean") {
		const input = el.createEl("input", { cls: "nfp-input", type: "checkbox" });
		input.checked = value;
		input.addEventListener("change", () => {
			ops.scalar(setAtPath(ops.current(), path, input.checked));
		});
		return;
	}

	const isNumber = typeof value === "number";
	const input = el.createEl("input", {
		cls: "nfp-input",
		type: isNumber ? "number" : "text",
	});
	// Tracks the last committed value so repeated blurs don't re-commit and
	// Escape reverts to what's actually stored.
	let committed: Leaf = value;
	input.value = value === null || value === undefined ? "" : String(value);

	const commitInput = () => {
		// A structural redraw can detach this input before its blur runs;
		// the path may no longer exist, so drop the stale event.
		if (!input.isConnected) {
			return;
		}
		const raw = input.value;
		const parsed: Leaf =
			isNumber && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
		if (parsed !== committed) {
			committed = parsed;
			ops.scalar(setAtPath(ops.current(), path, parsed));
		}
	};

	input.addEventListener("blur", commitInput);
	// Handled keys must not reach Obsidian's own metadata-editor handlers.
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			input.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			input.value = committed === null || committed === undefined ? "" : String(committed);
			input.blur();
		}
	});
}

// The kinds of empty value a new property or item can start as; picking
// object or list is how deeper nesting levels get created.
const EMPTY_KINDS: { icon: string; label: string; make: () => unknown }[] = [
	{ icon: "lucide-text", label: "Add text", make: () => "" },
	{ icon: "lucide-braces", label: "Add object", make: () => ({}) },
	{ icon: "lucide-list-tree", label: "Add list", make: () => [] },
];

// Swap the add button for an inline form; dismissed on Escape or when focus
// leaves the form (focusout with an outside relatedTarget, so moving between
// the form's own controls doesn't cancel it).
function openAddForm(
	container: HTMLElement,
	addButton: HTMLElement,
	build: (form: HTMLElement, dismiss: () => void) => void
): void {
	addButton.addClass("nfp-hidden");
	const form = container.createDiv({ cls: "nfp-add-form" });
	// Obsidian's Enter keymap blurs the input before our keydown handler runs,
	// and the blur cascade can already tear the form out of the DOM; dismiss
	// must be idempotent and never throw, or submit dies before committing.
	const dismiss = () => {
		try {
			form.remove();
		} catch {
			// already detached by a blur-triggered re-render
		}
		addButton.removeClass("nfp-hidden");
	};
	form.addEventListener("focusout", (event) => {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !form.contains(next)) {
			dismiss();
		}
	});
	form.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
	});
	build(form, dismiss);
}

function appendKindButtons(
	form: HTMLElement,
	submit: (make: () => unknown) => void
): void {
	for (const kind of EMPTY_KINDS) {
		const button = form.createEl("button", {
			cls: "clickable-icon nfp-kind-btn",
			attr: { "aria-label": kind.label },
		});
		setIcon(button, kind.icon);
		// macOS does not focus a button on mousedown, so without this the key
		// input blurs to nothing, focusout tears the form down, and the click
		// never lands: the form appeared to close instead of adding anything.
		button.addEventListener("mousedown", (event) => {
			event.preventDefault();
		});
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			submit(kind.make);
		});
	}
}

// Native "+ Add property" markup so the buttons inherit Obsidian's own
// default and hover styling in every theme.
function createAddButton(container: HTMLElement, label: string): HTMLElement {
	const button = container.createDiv({ cls: "metadata-add-button text-icon-button nfp-add" });
	setIcon(button.createSpan({ cls: "text-button-icon" }), "lucide-plus");
	button.createSpan({ cls: "text-button-label", text: label });
	// Keep the click from blurring whatever holds the editor open — a hover
	// popover or a focused table cell closes the moment focus leaves it.
	button.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	return button;
}

function addRemoveButton(row: HTMLElement, path: Path, ops: TreeOps): void {
	const button = row.createEl("button", {
		cls: "nfp-remove",
		attr: { "aria-label": "Remove" },
		text: "×",
	});
	// Keep a focused input from blurring (and committing) mid-click; the
	// blur/re-render race otherwise swallows the click entirely.
	button.addEventListener("mousedown", (event) => {
		event.preventDefault();
	});
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		ops.structural(removeAtPath(ops.current(), path));
	});
}
