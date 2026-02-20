import * as path from 'path';
import * as vscode from 'vscode';

type MatchMode = 'wholeWord' | 'substring';

interface RefactorEntry {
	id: string;
	text: string;
	createdAt: string;
}

interface RegistryFile {
	version: number;
	entries: RefactorEntry[];
}

interface ExcludeRules {
	excludeFencedCode: boolean;
	excludeInlineCode: boolean;
	customRegex: string[];
}

const DEFAULT_REGISTRY_PATH = '.writer-refactor/registry.json';
let highlightDecoration: vscode.TextEditorDecorationType | undefined;
let isProductionMode = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	isProductionMode = context.extensionMode === vscode.ExtensionMode.Production;
	await setCommandContexts(false, false, false);
	highlightDecoration = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor('editorWarning.foreground'),
		backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
		borderRadius: '4px',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: new vscode.ThemeColor('editor.wordHighlightStrongBorder'),
		overviewRulerColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
		overviewRulerLane: vscode.OverviewRulerLane.Center,
	});
	context.subscriptions.push(highlightDecoration);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.registerSelectedText', async () => {
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
				vscode.window.showInformationMessage('Please select text before registering.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			if (registry.entries.some((entry) => entry.text === selectedText)) {
				vscode.window.showInformationMessage(`"${selectedText}" is already registered.`);
				return;
			}

			registry.entries.push({
				id: createEntryId(selectedText),
				text: selectedText,
				createdAt: new Date().toISOString(),
			});
			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Registered "${selectedText}" as refactor object.`);
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.unregisterSelectedText', async () => {
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
				vscode.window.showInformationMessage('Please select text before unregistering.');
				return;
			}

			const registry = await loadRegistry(workspaceFolder);
			const exists = registry.entries.some((entry) => entry.text === selectedText);
			if (!exists) {
				vscode.window.showInformationMessage(`"${selectedText}" is not registered.`);
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Unregister "${selectedText}"?`,
				{ modal: true },
				'Unregister',
			);
			if (confirm !== 'Unregister') {
				return;
			}

			registry.entries = registry.entries.filter((entry) => entry.text !== selectedText);
			await saveRegistry(workspaceFolder, registry);
			vscode.window.showInformationMessage(`Unregistered "${selectedText}".`);
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
					const target = findRegisteredTargetAtPosition(document, position, registry.entries.map((entry) => entry.text));
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
					const target = findRegisteredTargetAtPosition(document, position, registry.entries.map((entry) => entry.text));
					if (!target) {
						throw new Error('Current token is not a registered refactor object.');
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

					registry.entries = registry.entries.map((entry) => (
						entry.text === target.text
							? { ...entry, text: nextText }
							: entry
					));
					registry.entries = dedupeEntries(registry.entries);
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
				await setCommandContexts(false, false, false);
				return;
			}
			await updateEditorHighlight(event.textEditor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor) {
				await setCommandContexts(false, false, false);
				return;
			}
			const workspaceFolder = getWorkspaceFolder();
			if (!workspaceFolder) {
				await setCommandContexts(false, false, false);
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
			const workspaceFolder = getWorkspaceFolder();
			const editor = vscode.window.activeTextEditor;
			if (!workspaceFolder || !editor) {
				return;
			}
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);
}

export function deactivate(): void {
	highlightDecoration?.dispose();
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

function getRegistryUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	const configured = vscode.workspace.getConfiguration('writerRefactor').get<string>('registryPath');
	const relativePath = configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_REGISTRY_PATH;
	return vscode.Uri.joinPath(folder.uri, relativePath);
}

async function ensureRegistryExists(folder: vscode.WorkspaceFolder): Promise<void> {
	const uri = getRegistryUri(folder);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		const initial: RegistryFile = { version: 1, entries: [] };
		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(initial, null, 2)}\n`, 'utf8'));
	}
}

async function loadRegistry(folder: vscode.WorkspaceFolder): Promise<RegistryFile> {
	await ensureRegistryExists(folder);
	const uri = getRegistryUri(folder);
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<RegistryFile>;
		const entries = Array.isArray(parsed.entries)
			? parsed.entries
				.filter((entry): entry is RefactorEntry => Boolean(entry?.id) && typeof entry.text === 'string' && typeof entry.createdAt === 'string')
				.map((entry) => ({ ...entry, text: entry.text.trim() }))
				.filter((entry) => entry.text.length > 0)
			: [];
		return {
			version: typeof parsed.version === 'number' ? parsed.version : 1,
			entries: dedupeEntries(entries),
		};
	} catch (error) {
		vscode.window.showWarningMessage(`Registry parse failed, recreating file. (${String(error)})`);
		const fallback: RegistryFile = { version: 1, entries: [] };
		await saveRegistry(folder, fallback);
		return fallback;
	}
}

async function saveRegistry(folder: vscode.WorkspaceFolder, registry: RegistryFile): Promise<void> {
	const uri = getRegistryUri(folder);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	const normalized: RegistryFile = {
		version: 1,
		entries: dedupeEntries(registry.entries),
	};
	await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
}

function dedupeEntries(entries: RefactorEntry[]): RefactorEntry[] {
	const seen = new Set<string>();
	const result: RefactorEntry[] = [];
	for (const entry of entries) {
		if (seen.has(entry.text)) {
			continue;
		}
		seen.add(entry.text);
		result.push(entry);
	}
	return result;
}

function createEntryId(text: string): string {
	if (isProductionMode) {
		const timestampPart = Date.now().toString(36);
		const randomPart = Math.random().toString(36).slice(2, 10);
		return `${timestampPart}-${randomPart}`;
	}

	const normalized = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
	const prefix = normalized.length > 0 ? normalized : 'entry';
	return `${prefix}-${Date.now().toString(36)}`;
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
	if (!highlightDecoration) {
		return;
	}
	if (!isSupportedDocument(editor.document)) {
		editor.setDecorations(highlightDecoration, []);
		await setCommandContexts(false, false, false);
		return;
	}
	const registry = await loadRegistry(folder);
	const registeredTexts = registry.entries.map((entry) => entry.text);

	const selectedText = editor.document.getText(editor.selection).trim();
	const hasSelection = selectedText.length > 0;
	const selectedIsRegistered = hasSelection && registeredTexts.includes(selectedText);
	let highlightText = selectedText;
	if (!highlightText) {
		const targetAtCursor = findRegisteredTargetAtPosition(
			editor.document,
			editor.selection.active,
			registeredTexts,
		);
		highlightText = targetAtCursor?.text ?? '';
	}


	// todo : 这里register和unregister的显隐其实还需要盘一下
	if (!highlightText || !registeredTexts.includes(highlightText)) {
		editor.setDecorations(highlightDecoration, []);
		await setCommandContexts(hasSelection && !selectedIsRegistered, selectedIsRegistered, false);
		return;
	}
	const ranges = findMatchRanges(editor.document, highlightText);
	editor.setDecorations(highlightDecoration, ranges);
	await setCommandContexts(hasSelection && !selectedIsRegistered, selectedIsRegistered, true);
}

async function setCommandContexts(canRegister: boolean, canUnregister: boolean, canRename: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canRegister', canRegister);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canUnregister', canUnregister);
	await vscode.commands.executeCommand('setContext', 'writerRefactor.canRename', canRename);
}
