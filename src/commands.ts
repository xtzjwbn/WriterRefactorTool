import * as vscode from 'vscode';

import { findCharacterCandidates, isAliasRegistered } from './character';
import { updateEditorHighlight } from './highlight';
import { openCharacterManagerPanel } from './panel/webview';
import { createId, ensureRegistryExists, getRegistryUri, loadRegistry, saveRegistry } from './registry';
import { CharacterEntry } from './types';

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

/**
 * 注册扩展命令并绑定命令处理器。
 * @param context VS Code 扩展上下文。
 * @returns 无返回值。
 */
export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.registerSelectedRole', registerSelectedRole),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.registerSelectedAlias', registerSelectedAlias),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.unregisterSelectedAlias', unregisterSelectedAlias),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.unregisterSelectedCharacter', unregisterSelectedCharacter),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.renameSelectedEntry', renameSelectedEntry),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.openRegistry', openRegistry),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('writerRefactor.openCharacterManager', () => {
			openCharacterManagerPanel(context);
		}),
	);
}

/**
 * 将选中文本注册为新角色，并自动创建同名首个别名。
 * @returns 无返回值。
 */
export async function registerSelectedRole(): Promise<void> {
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

	registry.characters.push({
		id: createId('character'),
		name: selectedText,
		aliases: [
			{
				text: selectedText,
			},
		],
	});
	await saveRegistry(workspaceFolder, registry);
	vscode.window.showInformationMessage(`Role "${selectedText}" registered.`);
	await updateEditorHighlight(editor, workspaceFolder);
}

/**
 * 将选中文本挂到已有角色下作为新别名。
 * @returns 无返回值。
 */
export async function registerSelectedAlias(): Promise<void> {
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

	registry.characters = registry.characters.map((character) => (
		character.id === picked.characterId
			? {
				...character,
				aliases: [
					...character.aliases,
					{ text: selectedText },
				],
			}
			: character
	));

	await saveRegistry(workspaceFolder, registry);
	vscode.window.showInformationMessage(`Registered "${selectedText}" as alias under "${picked.label}".`);
	await updateEditorHighlight(editor, workspaceFolder);
}

/**
 * 删除选中文本对应的别名；若角色无别名则同时移除角色。
 * @returns 无返回值。
 */
export async function unregisterSelectedAlias(): Promise<void> {
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
}

/**
 * 删除选中文本对应的角色分类及其所有别名。
 * @returns 无返回值。
 */
export async function unregisterSelectedCharacter(): Promise<void> {
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
}

/**
 * 复用 VS Code 原生 rename 入口触发自定义 RenameProvider。
 * @returns 无返回值。
 */
export async function renameSelectedEntry(): Promise<void> {
	await vscode.commands.executeCommand('editor.action.rename');
}

/**
 * 打开当前 workspace 对应的 registry JSON 文件。
 * @returns 无返回值。
 */
export async function openRegistry(): Promise<void> {
	const workspaceFolder = getWorkspaceFolder();
	if (!workspaceFolder) {
		vscode.window.showWarningMessage('Writer Refactor requires an open workspace folder.');
		return;
	}
	const uri = getRegistryUri(workspaceFolder);
	await ensureRegistryExists(workspaceFolder);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
}
