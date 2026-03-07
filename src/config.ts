import * as vscode from 'vscode';

import { ExcludeRules, HighlightColorRule, HighlightColors, MatchMode } from './types';

export const DEFAULT_REGISTRY_PATH = 'registry.json';
const DEFAULT_PINYIN_COMPLETION_MIN_CHARS = 2;

const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
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

/**
 * 读取匹配模式配置，并在非法值时回退到 substring。
 * @returns 匹配模式，合法值为 wholeWord 或 substring。
 */
export function getMatchMode(): MatchMode {
	const mode = vscode.workspace.getConfiguration('writerRefactor').get<string>('matchMode');
	return mode === 'wholeWord' ? 'wholeWord' : 'substring';
}

/**
 * 读取并清洗排除规则，保证调用方始终拿到结构完整的配置对象。
 * @returns 规范化后的排除规则配置。
 */
export function getExcludeRules(): ExcludeRules {
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

/**
 * 读取高亮配置并补齐默认值，避免装饰器初始化失败。
 * @returns 规范化后的强弱高亮颜色配置。
 */
export function getHighlightColors(): HighlightColors {
	const raw = vscode.workspace.getConfiguration('writerRefactor').get<Partial<HighlightColors>>('highlightColors') ?? {};
	return {
		strong: sanitizeHighlightRule(raw.strong, DEFAULT_HIGHLIGHT_COLORS.strong),
		weak: sanitizeHighlightRule(raw.weak, DEFAULT_HIGHLIGHT_COLORS.weak),
	};
}

/**
 * 对单条高亮规则做字段级兜底。
 * @param raw 用户配置中的原始规则，可能缺失字段。
 * @param fallback 默认高亮规则。
 * @returns 补齐字段后的高亮规则。
 */
export function sanitizeHighlightRule(
	raw: Partial<HighlightColorRule> | undefined,
	fallback: HighlightColorRule,
): HighlightColorRule {
	return {
		color: pickColor(raw?.color, fallback.color),
		backgroundColor: pickColor(raw?.backgroundColor, fallback.backgroundColor),
		borderColor: pickColor(raw?.borderColor, fallback.borderColor),
		overviewRulerColor: pickColor(raw?.overviewRulerColor, fallback.overviewRulerColor),
	};
}

/**
 * 仅接受非空字符串颜色值，其他情况使用 fallback。
 * @param value 待校验颜色值。
 * @param fallback 回退颜色值。
 * @returns 最终可用的颜色字符串。
 */
export function pickColor(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * 支持 theme:token 语法，将其转换为 VS Code ThemeColor。
 * @param value 颜色配置值。
 * @returns 普通颜色字符串或 VS Code ThemeColor 实例。
 */
export function resolveColor(value: string): string | vscode.ThemeColor {
	const themePrefix = 'theme:';
	if (value.startsWith(themePrefix)) {
		const themeToken = value.slice(themePrefix.length).trim();
		if (themeToken.length > 0) {
			return new vscode.ThemeColor(themeToken);
		}
	}
	return value;
}

/**
 * 读取拼音补全开关，默认开启。
 * @returns true 表示启用拼音参与补全。
 */
export function isPinyinCompletionEnabled(): boolean {
	return vscode.workspace.getConfiguration('writerRefactor').get<boolean>('completion.pinyinEnabled') !== false;
}

/**
 * 读取拼音补全触发最小字符数，非法值时回退到默认值。
 * @returns 拼音补全最小触发字符数，最小为 1。
 */
export function getPinyinCompletionMinChars(): number {
	const value = vscode.workspace.getConfiguration('writerRefactor').get<number>('completion.pinyinMinChars');
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_PINYIN_COMPLETION_MIN_CHARS;
	}
	return Math.max(1, Math.floor(value));
}
