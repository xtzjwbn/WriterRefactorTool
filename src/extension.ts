import * as path from 'path';
import { createHash } from 'crypto';
import * as vscode from 'vscode';

type MatchMode = 'wholeWord' | 'substring';

interface RefactorEntry {
	id: string;
	text: string;
	createdAt: string;
}

interface CharacterEntry {
	id: string;
	name: string;
	createdAt: string;
	aliases: RefactorEntry[];
}

interface RegistryFile {
	version: number;
	characters: CharacterEntry[];
}

interface ExcludeRules {
	excludeFencedCode: boolean;
	excludeInlineCode: boolean;
	customRegex: string[];
}

interface HighlightColorRule {
	color: string;
	backgroundColor: string;
	borderColor: string;
	overviewRulerColor: string;
}

interface HighlightColors {
	strong: HighlightColorRule;
	weak: HighlightColorRule;
}

const DEFAULT_REGISTRY_PATH = 'registry.json';
let highlightDecorationStrong: vscode.TextEditorDecorationType | undefined;
let highlightDecorationWeak: vscode.TextEditorDecorationType | undefined;
let idSequence = 0;
let registryStorageRoot: vscode.Uri | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registryStorageRoot = context.globalStorageUri;
	await setCommandContexts(false, false, false, false, false);
	refreshHighlightDecorations();

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.registerSelectedRole', async () => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const selectedText = editor.document.getText(editor.selection).trim();
			if (!selectedText) {
			vscode.window.showInformationMessage('Please select role text before registering role.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			if (isAliasRegistered(registry.characters, selectedText)) {
				vscode.window.showInformationMessage(`"${selectedText}" is already registered.`);
				return;
			}

			const now = new Date().toISOString();
			registry.characters.push({
				id: createId('character'),
				name: selectedText,
				createdAt: now,
				aliases: [
					{
						id: createId('alias'),
						text: selectedText,
						createdAt: now,
					},
				],
			});
			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Role "${selectedText}" registered.`);
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.registerSelectedAlias', async () => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const selectedText = editor.document.getText(editor.selection).trim();
			if (!selectedText) {
			vscode.window.showInformationMessage('Please select alias text before registering alias.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			if (registry.characters.length === 0) {
				vscode.window.showInformationMessage('No character exists. Register a new character first.');
				return;
			}
			if (isAliasRegistered(registry.characters, selectedText)) {
				vscode.window.showInformationMessage(`"${selectedText}" is already registered.`);
				return;
			}

			const picked = await vscode.window.showQuickPick(
				registry.characters.map((character) => ({
					label: character.name,
					description: `${character.aliases.length} aliases`,
					characterId: character.id,
				})),
				{ placeHolder: 'Select a character category for this alias' },
			);
			if (!picked) {
				return;
			}

			const now = new Date().toISOString();
			registry.characters = registry.characters.map((character) => (
				character.id === picked.characterId
					? {
						...character,
						aliases: [
							...character.aliases,
							{ id: createId('alias'), text: selectedText, createdAt: now },
						],
					}
					: character
			));

			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Registered "${selectedText}" as alias under "${picked.label}".`);
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.unregisterSelectedAlias', async () => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const selectedText = editor.document.getText(editor.selection).trim();
			if (!selectedText) {
				vscode.window.showInformationMessage('Please select an alias before unregistering alias.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			if (!isAliasRegistered(registry.characters, selectedText)) {
				vscode.window.showInformationMessage(`"${selectedText}" is not a registered alias.`);
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Unregister alias "${selectedText}"?`,
				{ modal: true },
				'Unregister Alias',
			);
			if (confirm !== 'Unregister Alias') {
				return;
			}

			registry.characters = registry.characters
				.map((character) => ({
					...character,
					aliases: character.aliases.filter((alias) => alias.text !== selectedText),
				}))
				.filter((character) => character.aliases.length > 0);

			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Alias "${selectedText}" unregistered.`);
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.unregisterSelectedCharacter', async () => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
				return;
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const selectedText = editor.document.getText(editor.selection).trim();
			if (!selectedText) {
				vscode.window.showInformationMessage('Please select text before unregistering character.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			const candidates = findCharacterCandidates(registry.characters, selectedText);
			if (candidates.length === 0) {
				vscode.window.showInformationMessage(`No character found for "${selectedText}".`);
				return;
			}

			let target: CharacterEntry = candidates[0]!;
			if (candidates.length > 1) {
				const picked = await vscode.window.showQuickPick(
					candidates.map((character) => ({
						label: character.name,
						description: `${character.aliases.length} aliases`,
						characterId: character.id,
					})),
					{ placeHolder: 'Select a character category to unregister' },
				);
				if (!picked) {
					return;
				}
				const found = candidates.find((character) => character.id === picked.characterId);
				if (!found) {
					return;
				}
				target = found;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Unregister character "${target.name}" and all aliases?`,
				{ modal: true },
				'Unregister Character',
			);
			if (confirm !== 'Unregister Character') {
				return;
			}

			registry.characters = registry.characters.filter((character) => character.id !== target.id);
			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Character "${target.name}" unregistered.`);
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.renameSelectedEntry', async () => {
			await vscode.commands.executeCommand('editor.action.rename');
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerRenameProvider(
			[
				{ language: 'plaintext', scheme: 'file' },
				{ language: 'markdown', scheme: 'file' },
			],
			{
				prepareRename: async (document, position) => {
					const folder = vscode.workspace.getWorkspaceFolder(document.uri);
					if (!folder) {
						throw new Error('Writer Refactor requires an open workspace folder.');
					}
					const registry = await loadRegistry(folder);
					const target = findRegisteredTargetAtPosition(document, position, getRegisteredAliasTexts(registry.characters));
					if (!target) {
						throw new Error('Cursor must be on a registered refactor object.');
					}
					return { range: target.range, placeholder: target.text };
				},
				provideRenameEdits: async (document, position, newName) => {
					const nextText = newName.trim();
					if (!nextText) {
						throw new Error('New name cannot be empty.');
					}

					const folder = vscode.workspace.getWorkspaceFolder(document.uri);
					if (!folder) {
						throw new Error('Writer Refactor requires an open workspace folder.');
					}
					const registry = await loadRegistry(folder);
					const target = findRegisteredTargetAtPosition(document, position, getRegisteredAliasTexts(registry.characters));
					if (!target) {
						throw new Error('Current token is not a registered refactor object.');
					}
					if (nextText !== target.text && isAliasRegistered(registry.characters, nextText)) {
						throw new Error(`"${nextText}" is already registered.`);
					}

					const uris = await findWorkspaceTextUris();
					const edit = new vscode.WorkspaceEdit();
					for (const uri of uris) {
						const doc = await vscode.workspace.openTextDocument(uri);
						if (!isSupportedDocument(doc)) {
							continue;
						}
						const ranges = findMatchRanges(doc, target.text);
						for (const range of ranges) {
							edit.replace(uri, range, nextText);
						}
					}

					registry.characters = registry.characters.map((character) => ({
						...character,
						aliases: character.aliases.map((alias) => (
							alias.text === target.text
								? { ...alias, text: nextText }
								: alias
						)),
					}));
					await saveRegistry(folder, registry);

					const activeEditor = vscode.window.activeTextEditor;
					if (activeEditor) {
						await updateEditorHighlight(activeEditor, folder);
					}

					return edit;
				},
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.openRegistry', async () => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
				return;
			}
			const uri = getRegistryUri(workspaceFolder);
			await ensureRegistryExists(workspaceFolder);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: false });
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(async (event) => {
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			await updateEditorHighlight(event.textEditor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (!event.affectsConfiguration('writerRefactor')) {
				return;
			}
			refreshHighlightDecorations();
			const workspaceFolder = getWorkspaceFolder();
			const editor = vscode.window.activeTextEditor;
			if (!workspaceFolder) {
				return;
			}
			if (!editor) {
				return;
			}
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);
}

export function deactivate(): void {
	highlightDecorationStrong?.dispose();
	highlightDecorationWeak?.dispose();
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

function getRegistryUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	const configured = vscode.workspace.getConfiguration('writerRefactor').get<string>('registryPath');
	const relativePath = configured && configured.trim().length > 0
		? configured.trim().replace(/^[/\\]+/, '')
		: DEFAULT_REGISTRY_PATH;
	const base = registryStorageRoot ?? vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'), '.writer-refactor');
	const workspaceBase = vscode.Uri.joinPath(base, getWorkspaceStorageKey(folder));
	return vscode.Uri.joinPath(workspaceBase, relativePath);
}

function getWorkspaceStorageKey(folder: vscode.WorkspaceFolder): string {
	const hash = createHash('sha256').update(folder.uri.toString()).digest('hex').slice(0, 16);
	return `workspace-${hash}`;
}

async function ensureRegistryExists(folder: vscode.WorkspaceFolder): Promise<void> {
	const uri = getRegistryUri(folder);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		const initial: RegistryFile = { version: 1, characters: [] };
		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(initial, null, 2)}\n`, 'utf8'));
	}
}

async function loadRegistry(folder: vscode.WorkspaceFolder): Promise<RegistryFile> {
	await ensureRegistryExists(folder);
	const uri = getRegistryUri(folder);
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<RegistryFile>;
		const characters = normalizeCharacters(parsed.characters);
		return {
			version: 1,
			characters,
		};
	} catch (error) {
		vscode.window.showWarningMessage(`Registry parse failed, recreating file. (${String(error)})`);
		const fallback: RegistryFile = { version: 1, characters: [] };
		await saveRegistry(folder, fallback);
		return fallback;
	}
}

async function saveRegistry(folder: vscode.WorkspaceFolder, registry: RegistryFile): Promise<void> {
	const uri = getRegistryUri(folder);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	const normalized: RegistryFile = {
		version: 1,
		characters: normalizeCharacters(registry.characters),
	};
	await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
}

function normalizeCharacters(raw: unknown): CharacterEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const textSeen = new Set<string>();
	const result: CharacterEntry[] = [];
	for (const item of raw) {
		const character = normalizeCharacter(item);
		if (!character) {
			continue;
		}
		const aliases: RefactorEntry[] = [];
		for (const alias of character.aliases) {
			const key = alias.text.trim();
			if (textSeen.has(key)) {
				continue;
			}
			textSeen.add(key);
			aliases.push(alias);
		}
		if (aliases.length === 0) {
			continue;
		}
		result.push({ ...character, aliases });
	}
	return result;
}

function normalizeCharacter(raw: unknown): CharacterEntry | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const candidate = raw as Partial<CharacterEntry>;
	if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.createdAt !== 'string') {
		return undefined;
	}
	const aliases = Array.isArray(candidate.aliases)
		? candidate.aliases
			.map((alias) => normalizeAlias(alias))
			.filter((alias): alias is RefactorEntry => Boolean(alias))
		: [];
	if (aliases.length === 0) {
		return undefined;
	}
	const name = candidate.name.trim();
	return {
		id: candidate.id,
		name: name.length > 0 ? name : aliases[0].text,
		createdAt: candidate.createdAt,
		aliases,
	};
}

function normalizeAlias(raw: unknown): RefactorEntry | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const candidate = raw as Partial<RefactorEntry>;
	if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string' || typeof candidate.createdAt !== 'string') {
		return undefined;
	}
	const text = candidate.text.trim();
	if (text.length === 0) {
		return undefined;
	}
	return {
		id: candidate.id,
		text,
		createdAt: candidate.createdAt,
	};
}

function isAliasRegistered(characters: CharacterEntry[], text: string): boolean {
	const target = text.trim();
	return characters.some((character) => character.aliases.some((alias) => alias.text === target));
}

function getRegisteredAliasTexts(characters: CharacterEntry[]): string[] {
	return characters.flatMap((character) => character.aliases.map((alias) => alias.text));
}

function createId(kind: 'character' | 'alias'): string {
	idSequence += 1;
	const timestamp = Date.now().toString(36);
	const sequence = idSequence.toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `${kind}-${timestamp}-${sequence}-${random}`;
}

function getMatchMode(): MatchMode {
	const mode = vscode.workspace.getConfiguration('writerRefactor').get<string>('matchMode');
	return mode === 'wholeWord' ? 'wholeWord' : 'substring';
}

function getExcludeRules(): ExcludeRules {
	const raw = vscode.workspace.getConfiguration('writerRefactor').get<Partial<ExcludeRules>>('excludeRules') ?? {};
	const customRegex = Array.isArray(raw.customRegex)
		? raw.customRegex.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
		: [];
	return {
		excludeFencedCode: raw.excludeFencedCode !== false,
		excludeInlineCode: raw.excludeInlineCode !== false,
		customRegex,
	};
}

function getHighlightColors(): HighlightColors {
	const defaults: HighlightColors = {
		strong: {
			color: 'theme:editorWarning.foreground',
			backgroundColor: 'theme:editor.wordHighlightBackground',
			borderColor: 'theme:editor.wordHighlightStrongBorder',
			overviewRulerColor: 'theme:editor.findMatchHighlightBackground',
		},
		weak: {
			color: 'theme:editor.foreground',
			backgroundColor: 'theme:editor.wordHighlightTextBackground',
			borderColor: 'theme:editor.wordHighlightBorder',
			overviewRulerColor: 'theme:editor.wordHighlightTextBackground',
		},
	};
	const raw = vscode.workspace.getConfiguration('writerRefactor').get<Partial<HighlightColors>>('highlightColors') ?? {};
	return {
		strong: sanitizeHighlightRule(raw.strong, defaults.strong),
		weak: sanitizeHighlightRule(raw.weak, defaults.weak),
	};
}

function sanitizeHighlightRule(raw: Partial<HighlightColorRule> | undefined, fallback: HighlightColorRule): HighlightColorRule {
	return {
		color: pickColor(raw?.color, fallback.color),
		backgroundColor: pickColor(raw?.backgroundColor, fallback.backgroundColor),
		borderColor: pickColor(raw?.borderColor, fallback.borderColor),
		overviewRulerColor: pickColor(raw?.overviewRulerColor, fallback.overviewRulerColor),
	};
}

function pickColor(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function resolveColor(value: string): string | vscode.ThemeColor {
	const themePrefix = 'theme:';
	if (value.startsWith(themePrefix)) {
		const themeToken = value.slice(themePrefix.length).trim();
		if (themeToken.length > 0) {
			return new vscode.ThemeColor(themeToken);
		}
	}
	return value;
}

function createHighlightDecoration(rule: HighlightColorRule): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		color: resolveColor(rule.color),
		backgroundColor: resolveColor(rule.backgroundColor),
		borderRadius: '4px',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: resolveColor(rule.borderColor),
		overviewRulerColor: resolveColor(rule.overviewRulerColor),
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});
}

function refreshHighlightDecorations(): void {
	highlightDecorationStrong?.dispose();
	highlightDecorationWeak?.dispose();
	const colors = getHighlightColors();
	highlightDecorationStrong = createHighlightDecoration(colors.strong);
	highlightDecorationWeak = createHighlightDecoration(colors.weak);
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
	if (document.uri.scheme !== 'file') {
		return false;
	}
	const ext = path.extname(document.fileName).toLowerCase();
	if (ext === '.txt' || ext === '.md') {
		return true;
	}
	return document.languageId === 'plaintext' || document.languageId === 'markdown';
}

function findMatchRanges(document: vscode.TextDocument, source: string): vscode.Range[] {
	if (source.length === 0) {
		return [];
	}
	const text = document.getText();
	const excluded = collectExcludedRanges(text, document.languageId, getExcludeRules());
	const mode = getMatchMode();
	const ranges: vscode.Range[] = [];
	let fromIndex = 0;
	while (fromIndex <= text.length - source.length) {
		const index = text.indexOf(source, fromIndex);
		if (index < 0) {
			break;
		}
		const end = index + source.length;
		if (!isExcluded(index, end, excluded) && (mode === 'substring' || isWholeWordBoundary(text, index, end))) {
			ranges.push(new vscode.Range(document.positionAt(index), document.positionAt(end)));
		}
		fromIndex = index + Math.max(source.length, 1);
	}
	return ranges;
}

function collectExcludedRanges(text: string, languageId: string, rules: ExcludeRules): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	if (languageId === 'markdown' && rules.excludeFencedCode) {
		collectRegexRanges(text, /```[\s\S]*?```/g, ranges);
		collectRegexRanges(text, /~~~[\s\S]*?~~~/g, ranges);
	}
	if (languageId === 'markdown' && rules.excludeInlineCode) {
		collectRegexRanges(text, /`[^`\n]+`/g, ranges);
	}
	for (const pattern of rules.customRegex) {
		try {
			collectRegexRanges(text, new RegExp(pattern, 'g'), ranges);
		} catch {
			// Ignore invalid regex pattern from user settings.
		}
	}
	return ranges.sort((a, b) => a.start - b.start);
}

function collectRegexRanges(text: string, regex: RegExp, target: Array<{ start: number; end: number }>): void {
	for (const match of text.matchAll(regex)) {
		if (typeof match.index !== 'number' || match[0].length === 0) {
			continue;
		}
		target.push({ start: match.index, end: match.index + match[0].length });
	}
}

function isExcluded(start: number, end: number, ranges: Array<{ start: number; end: number }>): boolean {
	for (const range of ranges) {
		if (range.start >= end) {
			break;
		}
		if (range.end > start && range.start < end) {
			return true;
		}
	}
	return false;
}

function isWholeWordBoundary(text: string, start: number, end: number): boolean {
	const before = start > 0 ? text[start - 1] : '';
	const after = end < text.length ? text[end] : '';
	return !isWordLikeChar(before) && !isWordLikeChar(after);
}

function isWordLikeChar(char: string): boolean {
	if (!char) {
		return false;
	}
	return /[\p{L}\p{N}_]/u.test(char);
}

function findRegisteredTargetAtPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
	registeredTexts: string[],
): { text: string; range: vscode.Range } | undefined {
	const offset = document.offsetAt(position);
	const candidates = [...new Set(registeredTexts.filter((text) => text.trim().length > 0))]
		.sort((a, b) => b.length - a.length);

	for (const text of candidates) {
		const ranges = findMatchRanges(document, text);
		for (const range of ranges) {
			const start = document.offsetAt(range.start);
			const end = document.offsetAt(range.end);
			if (offset >= start && offset <= end) {
				return { text, range };
			}
		}
	}
	return undefined;
}

async function findWorkspaceTextUris(): Promise<vscode.Uri[]> {
	return vscode.workspace.findFiles('**/*.{txt,md}', '**/node_modules/**');
}

async function updateEditorHighlight(editor: vscode.TextEditor, folder: vscode.WorkspaceFolder): Promise<void> {
	if (!highlightDecorationStrong || !highlightDecorationWeak) {
		return;
	}
	if (!isSupportedDocument(editor.document)) {
		editor.setDecorations(highlightDecorationStrong, []);
		editor.setDecorations(highlightDecorationWeak, []);
		await setCommandContexts(false, false, false, false, false);
		return;
	}

	const registry = await loadRegistry(folder);
	const registeredTexts = getRegisteredAliasTexts(registry.characters);

	const selectedText = editor.document.getText(editor.selection).trim();
	const hasSelection = selectedText.length > 0;
	const selectedIsRegistered = hasSelection && registeredTexts.includes(selectedText);
	const selectedCharacterCandidates = hasSelection
		? findCharacterCandidates(registry.characters, selectedText)
		: [];
	const canUnregisterAlias = selectedIsRegistered;
	const canUnregisterCharacter = selectedCharacterCandidates.length > 0;
	const canRegisterAlias = hasSelection && !selectedIsRegistered && registry.characters.length > 0;
	let highlightText = selectedText;
	if (!highlightText) {
		const targetAtCursor = findRegisteredTargetAtPosition(editor.document, editor.selection.active, registeredTexts);
		highlightText = targetAtCursor?.text ?? '';
	}

	if (!highlightText || !registeredTexts.includes(highlightText)) {
		editor.setDecorations(highlightDecorationStrong, []);
		editor.setDecorations(highlightDecorationWeak, []);
		await setCommandContexts(
			hasSelection && !selectedIsRegistered,
			canUnregisterAlias,
			canUnregisterCharacter,
			false,
			canRegisterAlias,
		);
		return;
	}

	const character = findCharacterByAlias(registry.characters, highlightText);
	if (!character) {
		editor.setDecorations(highlightDecorationStrong, []);
		editor.setDecorations(highlightDecorationWeak, []);
		await setCommandContexts(
			hasSelection && !selectedIsRegistered,
			canUnregisterAlias,
			canUnregisterCharacter,
			false,
			canRegisterAlias,
		);
		return;
	}

	const weakRanges = character.aliases
		.filter((alias) => alias.text !== highlightText)
		.flatMap((alias) => findMatchRanges(editor.document, alias.text));
	const strongRanges = findMatchRanges(editor.document, highlightText);
	editor.setDecorations(highlightDecorationWeak, weakRanges);
	editor.setDecorations(highlightDecorationStrong, strongRanges);
	await setCommandContexts(
		hasSelection && !selectedIsRegistered,
		canUnregisterAlias,
		canUnregisterCharacter,
		true,
		canRegisterAlias,
	);
}

function findCharacterByAlias(characters: CharacterEntry[], aliasText: string): CharacterEntry | undefined {
	return characters.find((character) => character.aliases.some((alias) => alias.text === aliasText));
}

function findCharacterCandidates(characters: CharacterEntry[], selectedText: string): CharacterEntry[] {
	return characters.filter((character) => (
		character.name === selectedText
		|| character.aliases.some((alias) => alias.text === selectedText)
	));
}

async function setCommandContexts(
	canRegister: boolean,
	canUnregisterAlias: boolean,
	canUnregisterCharacter: boolean,
	canRename: boolean,
	canRegisterAlias: boolean,
): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canRegister', canRegister);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canUnregisterAlias', canUnregisterAlias);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canUnregisterCharacter', canUnregisterCharacter);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canRename', canRename);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canRegisterAlias', canRegisterAlias);
}
