// A nested value inside a Bases table cell.
//
// A `.bases-td` is one row tall with `overflow: hidden`, and only grows
// (`height: fit-content`) while something inside it has focus. Drawing the
// stacked Properties-panel tree into it unfocused therefore shows the first
// row and a half of the object and clips the rest. So the cell has two
// states: a one-line summary at rest, and the full editor once focused.

import { summarize } from "./summary";
import { renderNestedValue, type CommitFn, type EditorMode } from "./widget";

export interface CellOptions {
	mode: EditorMode;
	onModeChange?: (mode: EditorMode) => void;
}

// True when this widget is being rendered into a Bases table cell rather than
// the Properties panel of a note.
export function isTableCell(el: HTMLElement): boolean {
	return el.closest(".bases-td") !== null;
}

export function renderNestedCell(
	root: HTMLElement,
	value: unknown,
	commit: CommitFn,
	options: CellOptions
): void {
	const container = root.createDiv({ cls: "nfp-cell" });
	let latest = value;
	let expanded = false;

	const collapse = () => {
		expanded = false;
		container.empty();
		container.removeClass("is-expanded");
		const summary = container.createDiv({
			cls: "nfp-cell-summary",
			attr: { tabindex: "0", role: "button" },
		});
		const text = summarize(latest);
		summary.setText(text);
		summary.toggleClass("is-empty", text === "" || text === "{}" || text === "[]");
	};

	const expand = () => {
		if (expanded) {
			return;
		}
		expanded = true;
		container.empty();
		container.addClass("is-expanded");
		const editor = container.createDiv({ cls: "nfp-cell-editor" });
		renderNestedValue(
			editor,
			latest,
			(next) => {
				latest = next;
				commit(next);
			},
			{ mode: options.mode, onModeChange: options.onModeChange }
		);
		focusFirstField(editor);
	};

	container.addEventListener("focusin", () => {
		expand();
	});
	container.addEventListener("mousedown", () => {
		// A click lands on the summary, which the tree replaces before the
		// click completes; expanding here means the pointer ends up in the
		// editor rather than on a detached node.
		expand();
	});
	container.addEventListener("focusout", (event) => {
		const next = event.relatedTarget;
		if (next instanceof Node && container.contains(next)) {
			return;
		}
		if (expanded) {
			collapse();
		}
	});

	collapse();
}

function focusFirstField(editor: HTMLElement): void {
	const field = editor.querySelector<HTMLElement>(
		"textarea, input:not([type='checkbox']), input, button"
	);
	field?.focus();
}
