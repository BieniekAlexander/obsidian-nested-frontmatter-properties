// Loads the SHIPPED bundle the way Obsidian does — require("obsidian") swapped
// for a stand-in, Obsidian's DOM helper prototypes installed — then drives
// onload, a widget render in a table cell and in a panel, and the Bases
// patches. Catches load-time and render-time breakage that the source-level
// unit tests cannot see, because it runs the built artifact.
//
// Run with `npm run test:bundle` (after a build). Exits non-zero on any
// failed expectation.
import { Window } from "happy-dom";
import { createRequire } from "node:module";
import Module from "node:module";
import { copyFileSync, rmSync } from "node:fs";

const window = new Window({ url: "app://obsidian.md" });
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.MouseEvent = window.MouseEvent;
globalThis.FocusEvent = window.FocusEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.activeDocument = window.document;

// Obsidian's DOM helper prototypes.
const proto = window.HTMLElement.prototype;
proto.createEl = function (tag, info) {
	const el = window.document.createElement(tag);
	if (info?.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(" ")));
	if (info?.text) el.textContent = info.text;
	if (info?.type) el.type = info.type;
	if (info?.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (info) { return this.createEl("div", info); };
proto.createSpan = function (info) { return this.createEl("span", info); };
proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
proto.addClass = function (...c) { this.classList.add(...c); };
proto.removeClass = function (...c) { this.classList.remove(...c); };
proto.toggleClass = function (c, on) { this.classList.toggle(c, on); };
proto.setText = function (t) { this.textContent = t; };
proto.setAttr = function (k, v) { v === null ? this.removeAttribute(k) : this.setAttribute(k, String(v)); };

// A stand-in "obsidian" module, including the Bases classes with the same
// method names the real ones have.
class BasesEntry {
	getRawProperty(name) {
		return Object.hasOwn(this.frontmatter, name) ? this.frontmatter[name] : null;
	}
	getValue() { return null; }
}
class BasesView {
	async updateProperty(file, key, value) { this.written = { key, value }; }
}
class QueryController { getProperties() { return ["note.build"]; } }

const obsidian = {
	Plugin: class Plugin {
		constructor(app) { this.app = app; this._registered = []; }
		register(fn) { this._registered.push(fn); }
		registerEvent() {}
		addSettingTab() { this.settingTabAdded = true; }
		async loadData() { return null; }
		async saveData() {}
	},
	MarkdownView: class MarkdownView {},
	PluginSettingTab: class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
	Setting: class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addDropdown() { return this; } addToggle() { return this; } addSlider() { return this; } },
	setIcon() {},
	parseYaml: (t) => JSON.parse(t),
	stringifyYaml: (v) => JSON.stringify(v),
	BasesEntry,
	BasesView,
	QueryController,
};

const failures = [];
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(actual)}`);
	if (!ok) {
		failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return obsidian;
	return originalLoad.call(this, request, parent, isMain);
};

const bundlePath = new URL("../main.cjs", import.meta.url);
copyFileSync(new URL("../main.js", import.meta.url), bundlePath);
const bundle = require(bundlePath.pathname);
const PluginClass = bundle.default ?? bundle;
check("bundle exports a plugin class", typeof PluginClass, "function");

const widgets = {};
let layoutReady;
const app = {
	metadataTypeManager: {
		registeredTypeWidgets: widgets,
		getTypeInfo: () => ({ inferred: { type: "unknown" } }),
		setType() {},
		getAssignedType: () => null,
	},
	workspace: {
		onLayoutReady: (fn) => { layoutReady = fn; },
		getLeavesOfType: () => [],
		on: () => ({}),
	},
	vault: { getFileByPath: () => null },
	fileManager: { processFrontMatter: async () => {} },
	metadataCache: { getFileCache: () => null },
};

const plugin = new PluginClass(app);
await plugin.onload();
check("onload registers a settings tab", plugin.settingTabAdded === true, true);
layoutReady();
check("registers both widgets", Object.keys(widgets), ["nested-frontmatter:object", "nested-frontmatter:list"]);

// Render the object widget into a fake Bases table cell and into a panel.
const widget = widgets["nested-frontmatter:object"];
const value = { cost: { energy: 800 }, time: 25, requires: [] };

const td = document.createElement("div");
td.classList.add("bases-td");
const cellEl = td.createDiv({ cls: "bases-table-cell bases-metadata-value" });
document.body.appendChild(td);
widget.render(cellEl, value, { key: "build", sourcePath: "x.md", onChange() {} });
check("cell shows a one-line summary at rest", cellEl.querySelector(".nfp-cell-summary")?.textContent, "cost: {energy: 800}, time: 25, requires: []");
check("cell does not draw the editor before focus", cellEl.querySelector(".nfp-root") !== null, false);

cellEl.querySelector(".nfp-cell-summary").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
check("cell opens the editor on mousedown", cellEl.querySelector(".nfp-root") !== null, true);
check("expanded cell has editable keys", Array.from(cellEl.querySelectorAll(".nfp-key")).map((e) => e.value), ["cost", "energy", "time", "requires"]);

const panel = document.createElement("div");
document.body.appendChild(panel);
widget.render(panel, value, { key: "build", sourcePath: "x.md", onChange() {} });
check("panel is the tree root itself", panel.classList.contains("nfp-root"), true);
check("panel draws the tree immediately", Array.from(panel.querySelectorAll(".nfp-key")).map((e) => e.value), ["cost", "energy", "time", "requires"]);

// Bases patches applied against the stand-in prototypes.
const entry = Object.assign(Object.create(BasesEntry.prototype), {
	frontmatter: { build: { cost: { energy: 800 }, time: 25 } },
});
check("nested read, two levels", entry.getRawProperty("build.time"), 25);
check("nested read, three levels", entry.getRawProperty("build.cost.energy"), 800);
check("a plain top-level read is untouched", entry.getRawProperty("build"), { cost: { energy: 800 }, time: 25 });

rmSync(bundlePath, { force: true });
if (failures.length > 0) {
	console.error(`\n${failures.length} bundle check(s) failed:\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("\nsmoke-bundle: shipped bundle loads and renders");
