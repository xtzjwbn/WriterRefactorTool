import * as path from 'path';

import * as vscode from 'vscode';

import { getExcludeRules, getMatchMode } from './config';
import { ExcludeRules, RangeLike } from './types';

/**
 * 仅允许 file scheme 下的 txt/md 文档进入重命名和高亮流程。
 * @param document 待检查文档对象。
 * @returns 文档是否属于支持的文本类型。
 */
export function isSupportedDocument(document: vscode.TextDocument): boolean {
	if (document.uri.scheme !== 'file') {
		return false;
	}
	const ext = path.extname(document.fileName).toLowerCase();
	if (ext === '.txt' || ext === '.md') {
		return true;
	}
	return document.languageId === 'plaintext' || document.languageId === 'markdown';
}

/**
 * 按配置规则在文档内查找 source 命中范围。
 * @param document 待匹配文档对象。
 * @param source 目标匹配文本。
 * @returns 命中的 VS Code 范围数组。
 */
export function findMatchRanges(document: vscode.TextDocument, source: string): vscode.Range[] {
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

/**
 * 收集应被排除的文本区间（markdown 代码块、行内代码、自定义正则）。
 * @param text 文档全文字符串。
 * @param languageId 文档语言 ID。
 * @param rules 排除规则配置。
 * @returns 按起始位置排序的排除范围数组。
 */
export function collectExcludedRanges(text: string, languageId: string, rules: ExcludeRules): RangeLike[] {
	const ranges: RangeLike[] = [];
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

/**
 * 将正则命中结果映射为 offset 范围并写入目标数组。
 * @param text 文本内容。
 * @param regex 全局正则表达式。
 * @param target 用于累积结果的范围数组。
 * @returns 无返回值。
 */
export function collectRegexRanges(text: string, regex: RegExp, target: RangeLike[]): void {
	for (const match of text.matchAll(regex)) {
		if (typeof match.index !== 'number' || match[0].length === 0) {
			continue;
		}
		target.push({ start: match.index, end: match.index + match[0].length });
	}
}

/**
 * 判断 [start, end) 是否和任一排除区间重叠。
 * @param start 匹配起始 offset（含）。
 * @param end 匹配结束 offset（不含）。
 * @param ranges 排除范围数组。
 * @returns 若与任一排除区间重叠则返回 true。
 */
export function isExcluded(start: number, end: number, ranges: RangeLike[]): boolean {
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

/**
 * wholeWord 模式下校验两侧边界，避免命中词中子串。
 * @param text 文档全文字符串。
 * @param start 命中起始 offset（含）。
 * @param end 命中结束 offset（不含）。
 * @returns 是否满足整词边界条件。
 */
export function isWholeWordBoundary(text: string, start: number, end: number): boolean {
	const before = start > 0 ? text[start - 1] : '';
	const after = end < text.length ? text[end] : '';
	return !isWordLikeChar(before) && !isWordLikeChar(after);
}

/**
 * 统一的“词字符”定义，兼容 Unicode 字母、数字和下划线。
 * @param char 待判断单字符字符串。
 * @returns 是否属于词字符。
 */
export function isWordLikeChar(char: string): boolean {
	if (!char) {
		return false;
	}
	return /[\p{L}\p{N}_]/u.test(char);
}

/**
 * 在光标位置查找注册别名命中。
 * 约束：按文本长度降序匹配，优先命中更长别名以降低歧义。
 * @param document 当前文档对象。
 * @param position 当前光标位置。
 * @param registeredTexts 已注册别名文本列表。
 * @returns 命中的文本及范围；未命中时返回 undefined。
 */
export function findRegisteredTargetAtPosition(
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

/**
 * 扫描工作区中用于写作重命名的文本文件 URI。
 * @returns 匹配到的 txt/md 文件 URI 列表。
 */
export async function findWorkspaceTextUris(): Promise<vscode.Uri[]> {
	return vscode.workspace.findFiles('**/*.{txt,md}', '**/node_modules/**');
}
