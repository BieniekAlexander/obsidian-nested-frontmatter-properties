import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { EditorMode } from "./widget";

export interface NestedFrontmatterSettings {
	// How a nested value is edited, in the Properties panel and in Bases
	// cells alike. The mode switch on the editor writes back to this.
	editorMode: EditorMode;
	// Whether dotted frontmatter paths are offered as Bases columns.
	nestedBasesProperties: boolean;
	// Segments below the top-level key offered as columns; 3 reaches
	// `build.cost.energy`.
	nestedDepth: number;
}

export const DEFAULT_SETTINGS: NestedFrontmatterSettings = {
	editorMode: "tree",
	nestedBasesProperties: true,
	nestedDepth: 3,
};

export interface SettingsHost extends Plugin {
	settings: NestedFrontmatterSettings;
	saveSettings(): Promise<void>;
	refreshBasesIntegration(): void;
}

export class NestedFrontmatterSettingTab extends PluginSettingTab {
	private host: SettingsHost;

	constructor(app: App, host: SettingsHost) {
		super(app, host);
		this.host = host;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Editor style")
			.setDesc(
				"How nested values are edited. Rows gives one field per key; YAML text edits the whole value as plain text."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("tree", "Rows")
					.addOption("yaml", "YAML text")
					.setValue(this.host.settings.editorMode)
					.onChange(async (value) => {
						this.host.settings.editorMode = value === "yaml" ? "yaml" : "tree";
						await this.host.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Nested properties as columns")
			.setDesc(
				"Offer dotted paths such as build.time as columns in a base, editable in place. Turn this off to leave bases untouched."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.host.settings.nestedBasesProperties)
					.onChange(async (value) => {
						this.host.settings.nestedBasesProperties = value;
						await this.host.saveSettings();
						this.host.refreshBasesIntegration();
					});
			});

		new Setting(containerEl)
			.setName("Nested property depth")
			.setDesc("How far into an object the offered column paths go.")
			.addSlider((slider) => {
				slider
					.setLimits(1, 6, 1)
					.setValue(this.host.settings.nestedDepth)
					.onChange(async (value) => {
						this.host.settings.nestedDepth = value;
						await this.host.saveSettings();
					});
			});
	}
}
