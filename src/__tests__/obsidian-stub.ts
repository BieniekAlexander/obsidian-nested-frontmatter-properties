// Test stand-in for the "obsidian" package, which ships types only and has
// no runtime entry outside the app. Aliased in vitest.config.ts.
export const setIcon = (): void => {};
export class Plugin {}
export class MarkdownView {}
export class PluginSettingTab {}
export class Setting {}

// Bases classes exist only inside the app; the integration feature-detects
// them, and these stand-ins keep it detecting "absent" under test.
export const BasesEntry = undefined as unknown as never;
export const BasesView = undefined as unknown as never;
export const QueryController = undefined as unknown as never;
export const parsePropertyId = undefined as unknown as never;

// A YAML stand-in is deliberately not provided: the widget's YAML mode is
// exercised against the real serializer in the app, not here.
export const parseYaml = (text: string): unknown => JSON.parse(text);
export const stringifyYaml = (value: unknown): string => JSON.stringify(value);
