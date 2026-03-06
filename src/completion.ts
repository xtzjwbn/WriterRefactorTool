import * as vscode from 'vscode';

import { getExcludeRules } from './config';
import { collectExcludedRanges, isExcluded, isSupportedDocument, isWordLikeChar } from './matcher';
import { loadRegistry } from './registry';

interface AliasCandidate {
	alias: string;
	characterName: string;
	characterType: string;
}

/**
 * 注册别名前缀补全能力：从全量 alias 池中做前缀匹配并返回建议项。
 * @param context VS Code 扩展上下文。
 * @returns 无返回值。
 */
export function registerAliasCompletionProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			[
				{ language: 'plaintext', scheme: 'file' },
				{ language: 'plaintext', scheme: 'untitled' },
				{ language: 'markdown', scheme: 'file' },
				{ language: 'markdown', scheme: 'untitled' },
			],
			{
				provideCompletionItems: async (document, position) => {
					if (!isCompletionSupportedDocument(document)) {
						return [];
					}

					if (document.languageId === 'markdown') {
						const offset = document.offsetAt(position);
						const excluded = collectExcludedRanges(document.getText(), document.languageId, getExcludeRules());
						if (isExcluded(offset, offset + 1, excluded)) {
							return [];
						}
					}

					const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
						?? vscode.workspace.workspaceFolders?.[0];
					if (!workspaceFolder) {
						return [];
					}

					const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
					const tokenStartCharacter = findPrefixStartCharacter(linePrefix);
					const token = linePrefix.slice(tokenStartCharacter);
					if (token.length < 1) {
						return [];
					}

					const registry = await loadRegistry(workspaceFolder);
					const allCandidates: AliasCandidate[] = [];
					const seenAlias = new Set<string>();
					for (const character of registry.characters) {
						for (const alias of character.aliases) {
							const aliasText = alias.text.trim();
							if (!aliasText || seenAlias.has(aliasText)) {
								continue;
							}
							seenAlias.add(aliasText);
							allCandidates.push({
								alias: aliasText,
								characterName: character.name,
								characterType: character.type.trim(),
							});
						}
					}
					const matched = findMatchedSuffixPrefix(token, allCandidates);
					if (!matched) {
						return [];
					}
					const { prefix, candidates } = matched;

					const sortedCandidates = [...candidates]
						.sort((left, right) => {
							const leftDiff = left.alias.length - prefix.length;
							const rightDiff = right.alias.length - prefix.length;
							if (leftDiff !== rightDiff) {
								return leftDiff - rightDiff;
							}
							return left.alias.localeCompare(right.alias);
						});

					const replaceRange = new vscode.Range(
						new vscode.Position(position.line, position.character - prefix.length),
						position,
					);
					return sortedCandidates.map((candidate, index) => {
						const item = new vscode.CompletionItem(candidate.alias, vscode.CompletionItemKind.Text);
						item.detail = `角色：${candidate.characterName} | 类型：${candidate.characterType || '空'}`;
						item.insertText = candidate.alias;
						item.filterText = candidate.alias;
						item.range = replaceRange;
						item.sortText = `${String(index).padStart(6, '0')}_${candidate.alias}`;
						return item;
					});
				},
			},
		),
	);
}

function isCompletionSupportedDocument(document: vscode.TextDocument): boolean {
	if (isSupportedDocument(document)) {
		return true;
	}
	if (document.uri.scheme !== 'untitled') {
		return false;
	}
	return document.languageId === 'plaintext' || document.languageId === 'markdown';
}

function findPrefixStartCharacter(linePrefix: string): number {
	let index = linePrefix.length;
	while (index > 0) {
		const char = linePrefix.charAt(index - 1);
		if (!isWordLikeChar(char)) {
			break;
		}
		index -= 1;
	}
	return index;
}

function findMatchedSuffixPrefix(
	token: string,
	candidates: AliasCandidate[],
): { prefix: string; candidates: AliasCandidate[] } | undefined {
	for (let start = 0; start < token.length; start += 1) {
		const prefix = token.slice(start);
		const matched = candidates.filter((candidate) => candidate.alias.startsWith(prefix));
		if (matched.length > 0) {
			return { prefix, candidates: matched };
		}
	}
	return undefined;
}
