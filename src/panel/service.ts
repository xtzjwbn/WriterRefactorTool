import * as vscode from 'vscode';

import { createId, loadRegistry, saveRegistry } from '../registry';
import { CharacterEntry, RefactorEntry, RegistryFile } from '../types';
import { PanelCharacter, PanelSnapshot } from './types';
import { PanelValidationError, assertAliasUnique, validateAliasText, validateCharacterName } from './validator';

/** 面板服务层错误类型，统一给 webview 返回结构化错误。 */
export class PanelServiceError extends Error {
	/**
	 * @param code 错误码。
	 * @param message 用户可读错误信息。
	 */
	constructor(public readonly code: string, message: string) {
		super(message);
		this.name = 'PanelServiceError';
	}
}

/**
 * 读取并转换为面板可消费的数据快照。
 * @param folder 当前工作区目录对象。
 * @returns 面板快照数据。
 */
export async function getPanelSnapshot(folder: vscode.WorkspaceFolder): Promise<PanelSnapshot> {
	const registry = await loadRegistry(folder);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 新增角色（自动创建同名首个别名）。
 * @param folder 当前工作区目录对象。
 * @param name 角色名。
 * @returns 更新后的面板快照。
 */
export async function addCharacter(folder: vscode.WorkspaceFolder, name: string): Promise<PanelSnapshot> {
	const normalizedName = validateCharacterName(name);
	const registry = await loadRegistry(folder);
	assertAliasUnique(registry.characters, normalizedName);

	const now = new Date().toISOString();
	registry.characters.push({
		id: createId('character'),
		name: normalizedName,
		createdAt: now,
		aliases: [
			{
				id: createId('alias'),
				text: normalizedName,
				createdAt: now,
			},
		],
	});

	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 修改角色名（仅影响分类展示）。
 * @param folder 当前工作区目录对象。
 * @param characterId 目标角色 ID。
 * @param name 新角色名。
 * @returns 更新后的面板快照。
 */
export async function updateCharacterName(
	folder: vscode.WorkspaceFolder,
	characterId: string,
	name: string,
): Promise<PanelSnapshot> {
	const normalizedName = validateCharacterName(name);
	const registry = await loadRegistry(folder);
	const character = registry.characters.find((item) => item.id === characterId);
	if (!character) {
		throw new PanelServiceError('character_not_found', '未找到目标角色。');
	}
	character.name = normalizedName;
	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 删除角色及其全部别名。
 * @param folder 当前工作区目录对象。
 * @param characterId 目标角色 ID。
 * @param confirm 是否已确认删除。
 * @returns 更新后的面板快照。
 */
export async function removeCharacter(
	folder: vscode.WorkspaceFolder,
	characterId: string,
	confirm: boolean,
): Promise<PanelSnapshot> {
	if (!confirm) {
		throw new PanelServiceError('confirm_required', '删除角色前需要确认。');
	}
	const registry = await loadRegistry(folder);
	const nextCharacters = registry.characters.filter((item) => item.id !== characterId);
	if (nextCharacters.length === registry.characters.length) {
		throw new PanelServiceError('character_not_found', '未找到目标角色。');
	}
	registry.characters = nextCharacters;
	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 给目标角色新增别名。
 * @param folder 当前工作区目录对象。
 * @param characterId 目标角色 ID。
 * @param text 新别名文本。
 * @returns 更新后的面板快照。
 */
export async function addAlias(
	folder: vscode.WorkspaceFolder,
	characterId: string,
	text: string,
): Promise<PanelSnapshot> {
	const normalizedText = validateAliasText(text);
	const registry = await loadRegistry(folder);
	assertAliasUnique(registry.characters, normalizedText);

	const character = registry.characters.find((item) => item.id === characterId);
	if (!character) {
		throw new PanelServiceError('character_not_found', '未找到目标角色。');
	}

	character.aliases.push({
		id: createId('alias'),
		text: normalizedText,
		createdAt: new Date().toISOString(),
	});

	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 修改目标别名文本。
 * @param folder 当前工作区目录对象。
 * @param characterId 角色 ID。
 * @param aliasId 别名 ID。
 * @param text 新别名文本。
 * @returns 更新后的面板快照。
 */
export async function updateAliasText(
	folder: vscode.WorkspaceFolder,
	characterId: string,
	aliasId: string,
	text: string,
): Promise<PanelSnapshot> {
	const normalizedText = validateAliasText(text);
	const registry = await loadRegistry(folder);
	assertAliasUnique(registry.characters, normalizedText, aliasId);

	const character = registry.characters.find((item) => item.id === characterId);
	if (!character) {
		throw new PanelServiceError('character_not_found', '未找到目标角色。');
	}

	const alias = character.aliases.find((item) => item.id === aliasId);
	if (!alias) {
		throw new PanelServiceError('alias_not_found', '未找到目标别名。');
	}

	alias.text = normalizedText;
	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 删除目标别名；若角色下无别名则自动移除该角色。
 * @param folder 当前工作区目录对象。
 * @param characterId 角色 ID。
 * @param aliasId 别名 ID。
 * @returns 更新后的面板快照。
 */
export async function removeAlias(
	folder: vscode.WorkspaceFolder,
	characterId: string,
	aliasId: string,
): Promise<PanelSnapshot> {
	const registry = await loadRegistry(folder);
	const character = registry.characters.find((item) => item.id === characterId);
	if (!character) {
		throw new PanelServiceError('character_not_found', '未找到目标角色。');
	}

	const nextAliases = character.aliases.filter((item) => item.id !== aliasId);
	if (nextAliases.length === character.aliases.length) {
		throw new PanelServiceError('alias_not_found', '未找到目标别名。');
	}

	if (nextAliases.length === 0) {
		registry.characters = registry.characters.filter((item) => item.id !== characterId);
	} else {
		character.aliases = nextAliases;
	}

	await saveRegistry(folder, registry);
	return toPanelSnapshot(folder.name, registry);
}

/**
 * 将未知错误标准化为面板服务错误。
 * @param error 捕获到的异常。
 * @returns 标准化后的服务错误对象。
 */
export function toServiceError(error: unknown): PanelServiceError {
	if (error instanceof PanelServiceError) {
		return error;
	}
	if (error instanceof PanelValidationError) {
		return new PanelServiceError(error.code, error.message);
	}
	return new PanelServiceError('unknown_error', `操作失败：${String(error)}`);
}

function toPanelSnapshot(workspaceName: string, registry: RegistryFile): PanelSnapshot {
	return {
		workspaceName,
		characters: registry.characters.map((character) => toPanelCharacter(character)),
		updatedAt: new Date().toISOString(),
	};
}

function toPanelCharacter(character: CharacterEntry): PanelCharacter {
	return {
		id: character.id,
		name: character.name,
		aliases: character.aliases.map((alias) => toPanelAlias(alias)),
	};
}

function toPanelAlias(alias: RefactorEntry): { id: string; text: string } {
	return {
		id: alias.id,
		text: alias.text,
	};
}
