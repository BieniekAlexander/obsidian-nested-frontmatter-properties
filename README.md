# Nested Frontmatter Properties

View and edit nested frontmatter properties — arrays of objects and nested
objects — directly in Obsidian's Properties panel, instead of the stock
"unsupported type" warning showing raw text.

## What it does

```yaml
---
title: My book note
authors:
  - name: Ann Author
    pages: 320
  - name: Ben Writer
    pages: 12
meta:
  draft: true
---
```

Without the plugin, Obsidian's Properties panel shows those values as raw text
with an "unknown type" warning:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/properties-before-dark.png">
  <img alt="Properties panel without the plugin: authors and meta shown as raw JSON with unknown-type icons" src="docs/img/properties-before-light.png" width="600">
</picture>

With the plugin, the same `authors` and `meta` properties render as indented,
editable rows:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/properties-after-dark.png">
  <img alt="Properties panel with the plugin: nested name/pages rows per author, a draft checkbox, and add-property/add-item buttons" src="docs/img/properties-after-light.png" width="600">
</picture>

Values Obsidian already supports (text, lists of scalars, numbers, dates,
checkboxes) are never touched.

- Edit leaf values inline (text, number, checkbox inferred from the current value)
- Add and remove array items and object keys, choosing text, object, or list
  for each new value:

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/add-property-dark.png">
    <img alt="Inline add-property form inside an array item, with a key input and text/object/list type buttons" src="docs/img/add-property-light.png" width="600">
  </picture>

- Everything is written back through Obsidian's public frontmatter API

## Fork additions

This fork adds three things to upstream, all aimed at using nested frontmatter
as a spreadsheet in a base:

### Nested paths as live Bases columns

A Bases property id keeps everything after the *first* dot as the property
name, so `note.build.time` already arrives as a note-sourced property named
`build.time` — and Bases gives note-sourced properties the editable metadata
widget, not the read-only renderer a formula gets. The only thing missing was
that `build.time` was looked up as a literal frontmatter key, which no file
has.

Four Bases methods are taught to read a dotted name as a path
(`src/bases.ts`), and the column, its inline editor, sorting, filtering and
grouping all fall out of Bases' existing note-property handling:

| Method | What the patch adds |
|---|---|
| `BasesEntry.getRawProperty` | reads the dotted path out of the frontmatter |
| `BasesEntry.getValue` | walks the note's Value tree so sort/filter/group compare like with like |
| `BasesView.updateProperty` | writes the leaf, inside the same undoable transaction Bases uses |
| `QueryController.getProperties` | offers the dotted paths found in the result set, so they are pickable in the properties menu |

Unlike an `Add formula` column, the cell holds live data: editing it writes
back to the file. A literal key that really is spelled with a dot always wins,
so nothing that works today changes.

### Nested values in a table cell

A `.bases-td` is one row tall with `overflow: hidden`, and only grows while
something inside it holds focus — so the stacked Properties-panel tree drew
its first row and a half into the cell and clipped the rest. A cell now shows
a one-line summary at rest and opens the full editor on focus, which is also
when Obsidian's own `height: fit-content` gives it the room.

### Editing keys, and YAML as an editing mode

- Object keys are editable in place; renaming rebuilds the object so key order
  is preserved.
- A mode switch on the editor swaps the document-style rows for a YAML text
  area over the whole value, for the shapes rows are clumsy at — reordering
  keys, pasting a block in from elsewhere. Obsidian's own `parseYaml` /
  `stringifyYaml` do the work, so no YAML library is bundled and what is shown
  is what would be written. The mode is one preference shared by every editor,
  not per-cell state, and it defaults to the document view.
- Fixed: on macOS a mousedown on a `<button>` does not focus it, so the
  add-property form's key input blurred to nothing, `focusout` tore the form
  down, and the click landed on a detached node — the form appeared to close
  without adding anything. The kind buttons and the add button now suppress
  their own mousedown, as the remove button already did.

A settings tab carries the editor style (the same preference the switch
writes), an off switch for the Bases integration, and how deep the offered
column paths go.

### Building this fork

```bash
npm install
npm run build
# then copy main.js, manifest.json and styles.css into
# <vault>/.obsidian/plugins/nested-frontmatter-properties/
```

The version is bumped to 1.1.0 so Obsidian does not offer to "update" the
fork back to the released 1.0.1. A future upstream release above 1.1.0 would
be offered, and accepting it would overwrite this build.

## How this differs from Nested Properties

The [Nested Properties](https://github.com/mnaoumov/obsidian-nested-properties)
plugin covers similar ground with a larger feature set (vault-wide key renames,
type conversion, collapsible trees). This plugin is an independent,
from-scratch implementation with a different goal: the smallest possible
trusted surface. It ships under 10 KB with no bundled framework, no Electron
or Node API references, and a CI gate that keeps it that way.

## Design principles

This plugin is deliberately minimal, built to carry zero automated risk flags on
the community plugin store:

- **No network access, no telemetry, no dynamic code (`eval`), no clipboard or
  `localStorage` access, no Electron or Node APIs.** Works on mobile.
- **All writes use the public `processFrontMatter` API.** No YAML library is
  bundled; Obsidian does all parsing and serialization.
- **One runtime dependency**: [`monkey-around`](https://github.com/pjeby/monkey-around)
  (~1 KB), used to wrap a single method reversibly.
- **CI enforces the above**: every build greps the shipped bundle for forbidden
  tokens (`ipcRenderer`, `eval`, `innerHTML`, `fetch`, …) and fails if any appear.
  Releases carry GitHub build provenance attestation.

## Undocumented API notice

Obsidian has no public API for custom property widgets. To render inside the
native Properties panel, this plugin registers a widget in
`metadataTypeManager.registeredTypeWidgets` and wraps `getTypeInfo` so values the
stock UI marks unsupported resolve to it. This is plain in-renderer JavaScript at
the same privilege level as any plugin code — it grants no access beyond the
plugin sandbox. Every internal access is feature-detected: if a future Obsidian
update changes these internals, the plugin deactivates itself and the stock
behavior returns unchanged.

## Installation

Until listed in the community store: copy `main.js`, `manifest.json`, and
`styles.css` from the latest release into
`<vault>/.obsidian/plugins/nested-frontmatter-properties/`.

## Development

```bash
npm install
npm run dev      # watch build
npm test         # unit tests (pure edit/detect logic)
npm run build    # typecheck + production build + bundle token check
```
