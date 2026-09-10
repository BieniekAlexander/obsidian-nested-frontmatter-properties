// A nested value inside a Bases table cell.
//
// A `.bases-td` is one row tall with `overflow: hidden`, and only grows
// (`height: fit-content`) while something inside it has focus. Drawing the
// stacked Properties-panel tree into it unfocused therefore shows the first
// row and a half of the object and clips the rest. So the cell has two
// states: a one-line summary at rest, and the full editor once focused.
//
// Both states are built once and toggled with `hidden`, never destroyed and
// rebuilt. Rebuilding on focus races against the focus change that triggered
// it: hiding the focused summary fires `focusout` with a null relatedTarget,
// which reads as "focus left the cell" and collapses the editor that was mid
// construction — the cell ends up half-drawn with its rows shrunk to nothing.

import { summarize } from "./summary";
import { focusFirstField, renderNestedValue, type CommitFn, type EditorMode } from "./widget";

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
	const summary = container.createDiv({
		cls: "nfp-cell-summary",
		attr: { tabindex: "0", role: "button" },
	});
	const editor = container.createDiv({ cls: "nfp-cell-editor" });
	editor.hidden = true;

	let latest = value;
	let expanded = false;
	let built = false;
	// Hiding an element that HOLDS focus fires focusout (removing one does
	// not), so expanding would otherwise close the cell the instant it opened.
	// Focus is moved into the editor before the summary is hidden, and this
	// guards the rest of the swap.
	let swapping = false;

	const showSummary = () => {
		const text = summarize(latest);
		summary.setText(text);
		summary.toggleClass("is-empty", text === "" || text === "{}" || text === "[]");
	};

	const expand = () => {
		if (expanded) {
			return;
		}
		expanded = true;
		swapping = true;
		container.addClass("is-expanded");
		editor.hidden = false;
		if (!built) {
			built = true;
			renderNestedValue(
				editor,
				latest,
				(next) => {
					latest = next;
					commit(next);
				},
				{ mode: options.mode, onModeChange: options.onModeChange }
			);
		}
		// Order matters: focus lands in the editor first, so the summary is
		// no longer the focused element when it is hidden.
		focusFirstField(editor);
		summary.hidden = true;
		swapping = false;
	};

	const collapse = () => {
		if (!expanded) {
			return;
		}
		expanded = false;
		container.removeClass("is-expanded");
		summary.hidden = false;
		editor.hidden = true;
		showSummary();
	};

	container.addEventListener("focusin", expand);
	// A click on the summary must open the editor even though the summary is
	// what was pressed. Suppressing the default is what makes it work: the
	// browser would otherwise assign focus to the element the pointer hit —
	// the summary, which expanding has just hidden — sending focus to the
	// body and collapsing the cell again. Only the opening click is
	// suppressed, so clicking between fields once open behaves normally.
	container.addEventListener("mousedown", (event) => {
		if (expanded) {
			return;
		}
		event.preventDefault();
		expand();
	});
	// Only a focusout that lands OUTSIDE the cell closes it. Deferring this to
	// check `activeElement` instead looks more robust and is not: focus is
	// briefly on nothing while the editor is being shown, so the deferred
	// check collapses the cell as fast as it opens.
	// `relatedTarget` is null for several transitions that are NOT focus
	// leaving the cell — hiding the focused summary, and the editor redrawing
	// itself on a mode switch, which removes the focused element and focuses
	// its replacement. So where focus actually ended up is only knowable once
	// the event has settled.
	container.addEventListener("focusout", () => {
		if (swapping) {
			return;
		}
		const doc = container.ownerDocument;
		const view = doc.defaultView;
		if (!view) {
			return;
		}
		view.setTimeout(() => {
			if (!swapping && !container.contains(doc.activeElement)) {
				collapse();
			}
		}, 0);
	});

	showSummary();
}
