// A nested value inside a Bases table cell.
//
// A `.bases-td` is one row tall with `overflow: hidden`, and only grows
// (`height: fit-content`) while something inside it has focus. Drawing the
// stacked Properties-panel tree into it unfocused therefore shows the first
// row and a half of the object and clips the rest. So the cell shows a
// one-line summary at rest and the full editor once focused.
//
// Which of the two is visible is decided entirely by CSS, off the same
// `:focus-within` that grows the cell. Tracking it in JS instead means the
// flag and the real focus state can disagree — and every way they disagree
// looks the same to the user: a cell stuck open, clipped back to one row,
// showing a slice of its own editor. Focus is the single source of truth, so
// there is nothing left to get out of step.

import { summarize } from "./summary";
import {
	focusFirstField,
	renderNestedValue,
	type CommitFn,
	type EditorMode,
	type NestedEditorHandle,
} from "./widget";

export interface CellOptions {
	mode(): EditorMode;
	setMode?(mode: EditorMode): void;
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
	const summary = container.createDiv({
		cls: "nfp-cell-summary",
		attr: { tabindex: "0", role: "button" },
	});
	const editor = container.createDiv({ cls: "nfp-cell-editor" });

	let latest = value;
	let handle: NestedEditorHandle | null = null;
	// The mode the editor was last drawn in. A cell opened before the mode
	// changed elsewhere still holds its old drawing, so reopening it redraws
	// rather than showing a stale one.
	let drawnMode: EditorMode | null = null;

	const showSummary = () => {
		const text = summarize(latest);
		summary.setText(text);
		summary.toggleClass("is-empty", text === "" || text === "{}" || text === "[]");
	};

	// Building on demand keeps a table of hundreds of rows to one summary each.
	const openEditor = () => {
		if (handle === null) {
			handle = renderNestedValue(
				editor,
				latest,
				(next) => {
					latest = next;
					commit(next);
					showSummary();
				},
				options
			);
		} else if (drawnMode !== options.mode()) {
			handle.redraw();
		}
		drawnMode = options.mode();
		focusFirstField(editor);
	};

	// Suppressing the default is what makes the click work: the browser would
	// otherwise focus the summary, which CSS hides the moment anything in the
	// cell has focus — sending focus to the body and closing the cell again.
	summary.addEventListener("mousedown", (event) => {
		event.preventDefault();
		openEditor();
	});
	// Reaching the cell by keyboard focuses the summary; hand that straight on
	// to the editor. Focus stays inside the cell throughout, so the swap the
	// stylesheet performs is not visible as a flicker.
	summary.addEventListener("focus", openEditor);

	showSummary();
}
