import { CharacterEntry } from './types';

/**
 * 判断文本是否已作为任一角色别名注册。
 * @param characters 当前角色列表。
 * @param text 待查询文本。
 * @returns 若文本已注册为别名则返回 true。
 */
export function isAliasRegistered(characters: CharacterEntry[], text: string): boolean {
	const target = text.trim();
	return characters.some((character) => character.aliases.some((alias) => alias.text === target));
}

/**
 * 返回当前注册表中的全部别名文本。
 * @param characters 当前角色列表。
 * @returns 扁平化后的别名文本数组。
 */
export function getRegisteredAliasTexts(characters: CharacterEntry[]): string[] {
	return characters.flatMap((character) => character.aliases.map((alias) => alias.text));
}

/**
 * 按别名文本查找所属角色。
 * @param characters 当前角色列表。
 * @param aliasText 别名文本。
 * @returns 命中的角色；未命中时返回 undefined。
 */
export function findCharacterByAlias(characters: CharacterEntry[], aliasText: string): CharacterEntry | undefined {
	return characters.find((character) => character.aliases.some((alias) => alias.text === aliasText));
}

/**
 * 基于选中文本查找可视为同一角色的候选集合（角色名或任一别名命中）。
 * @param characters 当前角色列表。
 * @param selectedText 选中文本。
 * @returns 匹配到的角色候选列表。
 */
export function findCharacterCandidates(characters: CharacterEntry[], selectedText: string): CharacterEntry[] {
	return characters.filter((character) => (
		character.name === selectedText
		|| character.aliases.some((alias) => alias.text === selectedText)
	));
}
