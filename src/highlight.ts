import * as vscode from 'vscode';

import { getHighlightColors, resolveColor } from './config';
import { findCharacterByAlias, findCharacterCandidates, getRegisteredAliasTexts } from './character';
import { loadRegistry } from './registry';
import { findRegisteredTargetAtPosition, findMatchRanges, isSupportedDocument } from './matcher';
import { HighlightColorRule } from './types';

let highlightDecorationStrong: vscode.TextEditorDecorationType | undefined;
let highlightDecorationWeak: vscode.TextEditorDecorationType | undefined;

/**
 * 基于规则创建高亮装饰器，支持普通颜色和 theme token。
 * @param rule 高亮样式规则。
 * @returns 可复用的文本装饰器实例。
 */
export function createHighlightDecoration(rule: HighlightColorRule): vscode.TextEditorDecorationType {
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

/**
 * 释放旧装饰器并按最新配置重建，确保配置变更立即生效。
 * @returns 无返回值。
 */
export function refreshHighlightDecorations(): void {
	highlightDecorationStrong?.dispose();
	highlightDecorationWeak?.dispose();
	const colors = getHighlightColors();
	highlightDecorationStrong = createHighlightDecoration(colors.strong);
	highlightDecorationWeak = createHighlightDecoration(colors.weak);
}

/**
 * 在扩展停用时释放装饰器资源。
 * @returns 无返回值。
 */
export function disposeHighlightDecorations(): void {
	highlightDecorationStrong?.dispose();
	highlightDecorationWeak?.dispose();
	highlightDecorationStrong = undefined;
	highlightDecorationWeak = undefined;
}

/**
 * 统一更新菜单上下文，确保右键菜单按当前光标状态显示。
 * @param canRegister 是否允许注册角色。
 * @param canUnregisterAlias 是否允许取消注册别名。
 * @param canUnregisterCharacter 是否允许取消注册角色。
 * @param canRename 是否允许重命名。
 * @param canRegisterAlias 是否允许注册别名。
 * @returns 无返回值。
 */
export async function setCommandContexts(
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

/**
 * 根据当前选区/光标刷新强弱高亮，并同步上下文菜单开关。
 * 约束：未命中已注册别名时必须清空所有装饰器，避免残留视觉状态。
 * @param editor 当前活动编辑器。
 * @param folder 当前工作区目录对象。
 * @returns 无返回值。
 */
export async function updateEditorHighlight(editor: vscode.TextEditor, folder: vscode.WorkspaceFolder): Promise<void> {
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
