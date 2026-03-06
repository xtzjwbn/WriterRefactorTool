import * as vscode from 'vscode';

import { findCharacterByAlias, getRegisteredAliasTexts } from './character';
import { findRegisteredTargetAtPosition, isSupportedDocument } from './matcher';
import { loadRegistry } from './registry';

/**
 * 注册角色/别名悬停提示：命中已注册 alias 时展示角色类型与描述。
 * @param context VS Code 扩展上下文。
 * @returns 无返回值。
 */
export function registerCharacterHoverProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			[
				{ language: 'plaintext', scheme: 'file' },
				{ language: 'markdown', scheme: 'file' },
			],
			{
				provideHover: async (document, position) => {
					if (!isSupportedDocument(document)) {
						return undefined;
					}

					const folder = vscode.workspace.getWorkspaceFolder(document.uri);
					if (!folder) {
						return undefined;
					}

					const registry = await loadRegistry(folder);
					const target = findRegisteredTargetAtPosition(
						document,
						position,
						getRegisteredAliasTexts(registry.characters),
					);
					if (!target) {
						return undefined;
					}

					const character = findCharacterByAlias(registry.characters, target.text);
					if (!character) {
						return undefined;
					}

					const characterType = character.type.trim();
					const description = character.description.trim();
					const otherAliases = character.aliases
						.map((alias) => alias.text.trim())
						.filter((aliasText) => aliasText.length > 0 && aliasText !== target.text);
					const sections: string[] = [];
					if (characterType) {
						sections.push(`类型：${characterType}`);
					}
					if (description) {
						sections.push(`描述：${description}`);
					}
					if (otherAliases.length > 0) {
						sections.push(`其他别名：${otherAliases.join('、')}`);
					}
					if (sections.length === 0) {
						return undefined;
					}
					const content = new vscode.MarkdownString(sections.join('\n\n'));
					return new vscode.Hover(content, target.range);
				},
			},
		),
	);
}
