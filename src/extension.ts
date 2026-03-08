import * as vscode from 'vscode';

import { getRegisteredAliasTexts, isAliasRegistered } from './character';
import { registerAliasCompletionProvider } from './completion';
import { registerCommands } from './commands';
import { disposeHighlightDecorations, refreshHighlightDecorations, setCommandContexts, updateEditorHighlight } from './highlight';
import { registerCharacterHoverProvider } from './hover';
import { findRegisteredTargetAtPosition, findMatchRanges, findWorkspaceTextUris, isSupportedDocument } from './matcher';
import { loadRegistry, saveRegistry, setRegistryStorageRoot } from './registry';
import { countVisibleChars, isCountableDocument, ProjectWordCountIndex, TypingSpeedTracker } from './wordStats';

const REFRESH_DEBOUNCE_MS = 100;
const SPEED_REFRESH_INTERVAL_MS = 30_000;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/**
 * 扩展入口：初始化状态、注册命令、挂载重命名与编辑器事件。
 * @param context VS Code 扩展上下文。
 * @returns 无返回值。
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	setRegistryStorageRoot(context.globalStorageUri);
	await setCommandContexts(false, false, false, false, false);
	refreshHighlightDecorations();

	registerCommands(context);
	registerAliasCompletionProvider(context);
	registerCharacterHoverProvider(context);

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
	statusBar.show();
	context.subscriptions.push(statusBar);

	const projectIndex = new ProjectWordCountIndex();
	const speedTracker = new TypingSpeedTracker();
	const documentSnapshots = new Map<string, string>();
	let refreshTimer: NodeJS.Timeout | undefined;
	for (const document of vscode.workspace.textDocuments) {
		if (!isCountableDocument(document)) {
			continue;
		}
		documentSnapshots.set(document.uri.toString(), document.getText());
	}

	const refreshStatusBar = (): void => {
		const activeEditor = vscode.window.activeTextEditor;
		const projectText = projectIndex.isInitialized() ? formatNumber(projectIndex.getTotal()) : '...';
		const speedText = formatNumber(speedTracker.getNetPerHour());

		if (!activeEditor || !isCountableDocument(activeEditor.document)) {
			statusBar.text = `项目 ${projectText} | 当前 - | 速度 ${speedText} 字/小时`;
			return;
		}

		const selectedChars = getSelectedVisibleChars(activeEditor);
		if (selectedChars > 0) {
			statusBar.text = `项目 ${projectText} | 选中 ${formatNumber(selectedChars)} | 速度 ${speedText} 字/小时`;
			return;
		}

		const docCount = projectIndex.getCount(activeEditor.document.uri)
			?? countVisibleChars(activeEditor.document.getText());
		statusBar.text = `项目 ${projectText} | 当前 ${formatNumber(docCount)} | 速度 ${speedText} 字/小时`;
	};

	const scheduleRefresh = (): void => {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			refreshStatusBar();
		}, REFRESH_DEBOUNCE_MS);
	};

	const rebuildProjectIndex = async (): Promise<void> => {
		await projectIndex.initialize(() => {
			scheduleRefresh();
		});
		documentSnapshots.clear();
		for (const document of vscode.workspace.textDocuments) {
			if (!isCountableDocument(document)) {
				continue;
			}
			documentSnapshots.set(document.uri.toString(), document.getText());
			projectIndex.updateOpenDocument(document.uri, document.getText());
		}
		scheduleRefresh();
	};

	void rebuildProjectIndex();

	const speedInterval = setInterval(() => {
		scheduleRefresh();
	}, SPEED_REFRESH_INTERVAL_MS);
	context.subscriptions.push({
		dispose: () => {
			clearInterval(speedInterval);
			if (refreshTimer) {
				clearTimeout(refreshTimer);
				refreshTimer = undefined;
			}
		},
	});

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
		vscode.window.onDidChangeTextEditorSelection(async (event) => {
			scheduleRefresh();
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			await updateEditorHighlight(event.textEditor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			scheduleRefresh();
			if (!editor) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			if (isCountableDocument(editor.document)) {
				documentSnapshots.set(editor.document.uri.toString(), editor.document.getText());
				projectIndex.updateOpenDocument(editor.document.uri, editor.document.getText());
			}
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				await setCommandContexts(false, false, false, false, false);
				return;
			}
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (!isCountableDocument(event.document)) {
				return;
			}
			const key = event.document.uri.toString();
			const previousText = documentSnapshots.get(key);
			if (typeof previousText !== 'string') {
				documentSnapshots.set(key, event.document.getText());
				projectIndex.updateOpenDocument(event.document.uri, event.document.getText());
				scheduleRefresh();
				return;
			}
			const delta = getNetVisibleDelta(previousText, event.contentChanges);
			documentSnapshots.set(key, event.document.getText());
			projectIndex.updateOpenDocument(event.document.uri, event.document.getText());

			const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
			if (activeUri === key) {
				speedTracker.push(delta);
			}
			scheduleRefresh();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidCreateFiles(async (event) => {
			for (const file of event.files) {
				if (!projectIndex.isCountableUri(file)) {
					continue;
				}
				try {
					const document = await vscode.workspace.openTextDocument(file);
					documentSnapshots.set(file.toString(), document.getText());
					projectIndex.updateOpenDocument(file, document.getText());
				} catch {
					// Ignore unreadable files.
				}
			}
			scheduleRefresh();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((event) => {
			for (const file of event.files) {
				documentSnapshots.delete(file.toString());
				projectIndex.remove(file);
			}
			scheduleRefresh();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidRenameFiles(async (event) => {
			for (const file of event.files) {
				documentSnapshots.delete(file.oldUri.toString());
				projectIndex.remove(file.oldUri);
				if (!projectIndex.isCountableUri(file.newUri)) {
					continue;
				}
				try {
					const document = await vscode.workspace.openTextDocument(file.newUri);
					documentSnapshots.set(file.newUri.toString(), document.getText());
					projectIndex.updateOpenDocument(file.newUri, document.getText());
				} catch {
					// Ignore unreadable files.
				}
			}
			scheduleRefresh();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void rebuildProjectIndex();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (!event.affectsConfiguration('writerRefactor')) {
				return;
			}
			refreshHighlightDecorations();
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const editor = vscode.window.activeTextEditor;
			if (!workspaceFolder || !editor) {
				return;
			}
			await updateEditorHighlight(editor, workspaceFolder);
		}),
	);

	scheduleRefresh();
}

/**
 * 扩展停用入口：释放高亮装饰器资源。
 * @returns 无返回值。
 */
export function deactivate(): void {
	disposeHighlightDecorations();
}

function formatNumber(value: number): string {
	return NUMBER_FORMAT.format(value);
}

function getSelectedVisibleChars(editor: vscode.TextEditor): number {
	let total = 0;
	for (const selection of editor.selections) {
		if (selection.isEmpty) {
			continue;
		}
		total += countVisibleChars(editor.document.getText(selection));
	}
	return total;
}

function getNetVisibleDelta(previousText: string, changes: readonly vscode.TextDocumentContentChangeEvent[]): number {
	let current = previousText;
	let delta = 0;
	for (const change of changes) {
		const beforeSlice = current.slice(change.rangeOffset, change.rangeOffset + change.rangeLength);
		delta += countVisibleChars(change.text) - countVisibleChars(beforeSlice);
		current = current.slice(0, change.rangeOffset) + change.text + current.slice(change.rangeOffset + change.rangeLength);
	}
	return delta;
}
