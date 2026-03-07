import * as vscode from 'vscode';

import { getExcludeRules, getPinyinCompletionMinChars, isPinyinCompletionEnabled } from './config';
import { collectExcludedRanges, isExcluded, isSupportedDocument, isWordLikeChar } from './matcher';
import { loadRegistry } from './registry';

export type CompletionMatchKind = 'alias' | 'pinyinFull' | 'pinyinInitial';

export interface AliasCandidate {
	alias: string;
	characterName: string;
	characterType: string;
	aliasLower: string;
	pinyinFullKeys: string[];
	pinyinInitialKeys: string[];
	searchText: string;
}

export interface MatchedAliasCandidate {
	candidate: AliasCandidate;
	matchKind: CompletionMatchKind;
}

export interface PinyinEngine {
	pinyin: (text: string, options?: Record<string, unknown>) => unknown;
	polyphonic?: (text: string, options?: Record<string, unknown>) => unknown;
}

let cachedPinyinEngine: PinyinEngine | null | undefined;

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
					const pinyinEnabled = isPinyinCompletionEnabled();
					const pinyinMinChars = getPinyinCompletionMinChars();
					const allCandidates: AliasCandidate[] = [];
					const seenAlias = new Set<string>();
					for (const character of registry.characters) {
						for (const alias of character.aliases) {
							const aliasText = alias.text.trim();
							if (!aliasText || seenAlias.has(aliasText)) {
								continue;
							}
							seenAlias.add(aliasText);
							allCandidates.push(buildAliasCandidate(aliasText, character.name, character.type.trim(), pinyinEnabled));
						}
					}
					const matched = findMatchedSuffixPrefix(token, allCandidates, pinyinEnabled, pinyinMinChars);
					if (!matched) {
						return [];
					}
					const { prefix, candidates } = matched;

					const sortedCandidates = sortMatchedCandidates(candidates, prefix);

					const replaceRange = new vscode.Range(
						new vscode.Position(position.line, position.character - prefix.length),
						position,
					);
					return sortedCandidates.map((matchedCandidate, index) => {
						const { candidate } = matchedCandidate;
						const item = new vscode.CompletionItem(candidate.alias, vscode.CompletionItemKind.Text);
						item.detail = `匹配：${toMatchLabel(matchedCandidate.matchKind)} | 角色：${candidate.characterName} | 类型：${candidate.characterType || '空'}`;
						item.insertText = candidate.alias;
						item.filterText = candidate.searchText;
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

function buildAliasCandidate(
	aliasText: string,
	characterName: string,
	characterType: string,
	pinyinEnabled: boolean,
): AliasCandidate {
	const pinyinKeys = pinyinEnabled ? buildPinyinKeys(aliasText) : { fullKeys: [], initialKeys: [] };
	const searchParts = [
		aliasText,
		...pinyinKeys.fullKeys,
		...pinyinKeys.initialKeys,
	].filter((item) => item.length > 0);
	return {
		alias: aliasText,
		characterName,
		characterType,
		aliasLower: aliasText.toLowerCase(),
		pinyinFullKeys: pinyinKeys.fullKeys,
		pinyinInitialKeys: pinyinKeys.initialKeys,
		searchText: searchParts.join(' '),
	};
}

export function findMatchedSuffixPrefix(
	token: string,
	candidates: AliasCandidate[],
	pinyinEnabled: boolean,
	pinyinMinChars: number,
): { prefix: string; candidates: MatchedAliasCandidate[] } | undefined {
	for (let start = 0; start < token.length; start += 1) {
		const prefix = token.slice(start);
		const matched = findMatchedCandidates(prefix, candidates, pinyinEnabled, pinyinMinChars);
		if (matched.length > 0) {
			return { prefix, candidates: matched };
		}
	}
	return undefined;
}

function findMatchedCandidates(
	query: string,
	candidates: AliasCandidate[],
	pinyinEnabled: boolean,
	pinyinMinChars: number,
): MatchedAliasCandidate[] {
	const queryLower = query.toLowerCase();
	const matched: MatchedAliasCandidate[] = [];
	for (const candidate of candidates) {
		const matchKind = matchCandidateByQuery(candidate, queryLower, pinyinEnabled, pinyinMinChars);
		if (!matchKind) {
			continue;
		}
		matched.push({ candidate, matchKind });
	}
	return matched;
}

function matchCandidateByQuery(
	candidate: AliasCandidate,
	queryLower: string,
	pinyinEnabled: boolean,
	pinyinMinChars: number,
): CompletionMatchKind | undefined {
	if (candidate.aliasLower.startsWith(queryLower)) {
		return 'alias';
	}
	if (!pinyinEnabled || queryLower.length < pinyinMinChars) {
		return undefined;
	}
	if (candidate.pinyinFullKeys.some((key) => key.startsWith(queryLower))) {
		return 'pinyinFull';
	}
	if (candidate.pinyinInitialKeys.some((key) => key.startsWith(queryLower))) {
		return 'pinyinInitial';
	}
	return undefined;
}

function compareMatchedCandidate(
	left: MatchedAliasCandidate,
	right: MatchedAliasCandidate,
	prefix: string,
): number {
	const leftPriority = getMatchPriority(left.matchKind);
	const rightPriority = getMatchPriority(right.matchKind);
	if (leftPriority !== rightPriority) {
		return leftPriority - rightPriority;
	}
	const leftDiff = left.candidate.alias.length - prefix.length;
	const rightDiff = right.candidate.alias.length - prefix.length;
	if (leftDiff !== rightDiff) {
		return leftDiff - rightDiff;
	}
	return left.candidate.alias.localeCompare(right.candidate.alias);
}

export function sortMatchedCandidates(
	candidates: MatchedAliasCandidate[],
	prefix: string,
): MatchedAliasCandidate[] {
	return [...candidates].sort((left, right) => compareMatchedCandidate(left, right, prefix));
}

function getMatchPriority(kind: CompletionMatchKind): number {
	switch (kind) {
		case 'alias':
			return 0;
		case 'pinyinFull':
			return 1;
		case 'pinyinInitial':
			return 2;
		default:
			return 99;
	}
}

function toMatchLabel(kind: CompletionMatchKind): string {
	switch (kind) {
		case 'alias':
			return '原文';
		case 'pinyinFull':
			return '全拼';
		case 'pinyinInitial':
			return '首字母';
		default:
			return '未知';
	}
}

export function buildPinyinKeys(
	aliasText: string,
	engineOverride?: PinyinEngine | null,
): { fullKeys: string[]; initialKeys: string[] } {
	const engine = engineOverride === undefined ? getPinyinEngine() : engineOverride;
	if (!engine) {
		return {
			fullKeys: [],
			initialKeys: [],
		};
	}

	const fullKeySet = new Set<string>();
	const initialKeySet = new Set<string>();

	collectNormalizedKeys(
		safeCall(() => engine.pinyin(aliasText, {
			toneType: 'none',
			type: 'string',
			nonZh: 'consecutive',
		})),
		fullKeySet,
	);
	collectNormalizedKeys(
		safeCall(() => engine.pinyin(aliasText, {
			toneType: 'none',
			type: 'string',
			pattern: 'first',
			nonZh: 'consecutive',
		})),
		initialKeySet,
	);

	if (typeof engine.polyphonic === 'function') {
		collectNormalizedKeys(
			safeCall(() => engine.polyphonic?.(aliasText, {
				toneType: 'none',
				type: 'string',
				pattern: 'pinyin',
				nonZh: 'consecutive',
			})),
			fullKeySet,
		);
		collectNormalizedKeys(
			safeCall(() => engine.polyphonic?.(aliasText, {
				toneType: 'none',
				type: 'string',
				pattern: 'first',
				nonZh: 'consecutive',
			})),
			initialKeySet,
		);
	}

	return {
		fullKeys: [...fullKeySet],
		initialKeys: [...initialKeySet],
	};
}

function getPinyinEngine(): PinyinEngine | null {
	if (cachedPinyinEngine !== undefined) {
		return cachedPinyinEngine;
	}
	try {
		const required = typeof require === 'function' ? require('pinyin-pro') as Partial<PinyinEngine> : undefined;
		if (!required || typeof required.pinyin !== 'function') {
			cachedPinyinEngine = null;
			return cachedPinyinEngine;
		}
		cachedPinyinEngine = {
			pinyin: required.pinyin,
			polyphonic: required.polyphonic,
		};
		return cachedPinyinEngine;
	} catch {
		cachedPinyinEngine = null;
		return cachedPinyinEngine;
	}
}

function safeCall(executor: () => unknown): unknown {
	try {
		return executor();
	} catch {
		return undefined;
	}
}

function collectNormalizedKeys(source: unknown, target: Set<string>): void {
	if (typeof source === 'string') {
		const normalized = normalizePinyinKey(source);
		if (normalized) {
			target.add(normalized);
		}
		return;
	}
	if (!Array.isArray(source)) {
		return;
	}
	for (const item of source) {
		collectNormalizedKeys(item, target);
	}
}

export function normalizePinyinKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
