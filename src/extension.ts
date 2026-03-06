import * as vscode from 'vscode';

import { getRegisteredAliasTexts, isAliasRegistered } from './character';
import { registerCommands } from './commands';
import { disposeHighlightDecorations, refreshHighlightDecorations, setCommandContexts, updateEditorHighlight } from './highlight';
import { registerCharacterHoverProvider } from './hover';
import { findRegisteredTargetAtPosition, findMatchRanges, findWorkspaceTextUris, isSupportedDocument } from './matcher';
import { loadRegistry, saveRegistry, setRegistryStorageRoot } from './registry';

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
	registerCharacterHoverProvider(context);

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
			if (!editor) {
				await setCommandContexts(false, false, false, false, false);
				return;
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
}

/**
 * 扩展停用入口：释放高亮装饰器资源。
 * @returns 无返回值。
 */
export function deactivate(): void {
	disposeHighlightDecorations();
}
