import { CharacterEntry } from '../types';

const MAX_NAME_LENGTH = 200;

/** 面板参数校验失败时抛出的业务错误。 */
export class PanelValidationError extends Error {
	/**
	 * @param code 结构化错误码。
	 * @param message 用户可读错误信息。
	 */
	constructor(public readonly code: string, message: string) {
		super(message);
		this.name = 'PanelValidationError';
	}
}

/**
 * 校验并返回角色名。
 * @param name 原始角色名输入。
 * @returns trim 后可用的角色名。
 */
export function validateCharacterName(name: string): string {
	const normalized = name.trim();
	if (!normalized) {
		throw new PanelValidationError('character_name_empty', '角色名不能为空。');
	}
	if (normalized.length > MAX_NAME_LENGTH) {
		throw new PanelValidationError('character_name_too_long', `角色名长度不能超过 ${MAX_NAME_LENGTH}。`);
	}
	return normalized;
}

/**
 * 校验并返回别名文本。
 * @param text 原始别名输入。
 * @returns trim 后可用的别名文本。
 */
export function validateAliasText(text: string): string {
	const normalized = text.trim();
	if (!normalized) {
		throw new PanelValidationError('alias_text_empty', '别名不能为空。');
	}
	if (normalized.length > MAX_NAME_LENGTH) {
		throw new PanelValidationError('alias_text_too_long', `别名长度不能超过 ${MAX_NAME_LENGTH}。`);
	}
	return normalized;
}

/**
 * 确保别名在全局范围唯一。
 * @param characters 注册表中的角色列表。
 * @param nextAliasText 待校验别名文本。
 * @param ignoreAliasId 校验时忽略的别名 ID（用于重命名自身）。
 * @returns 无返回值。
 */
export function assertAliasUnique(
	characters: CharacterEntry[],
	nextAliasText: string,
	ignoreAliasId?: string,
): void {
	for (const character of characters) {
		for (const alias of character.aliases) {
			if (ignoreAliasId && alias.id === ignoreAliasId) {
				continue;
			}
			if (alias.text === nextAliasText) {
				throw new PanelValidationError('alias_conflict', `别名“${nextAliasText}”已存在。`);
			}
		}
	}
}
