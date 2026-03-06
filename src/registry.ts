import { createHash } from 'crypto';

import * as vscode from 'vscode';

import { DEFAULT_REGISTRY_PATH } from './config';
import { CharacterEntry, RefactorEntry, RegistryFile } from './types';

let idSequence = 0;
let registryStorageRoot: vscode.Uri | undefined;

/**
 * 设置扩展全局存储根目录，用于隔离不同 workspace 的 registry。
 * @param uri VS Code 提供的扩展全局存储目录 URI。
 * @returns 无返回值。
 */
export function setRegistryStorageRoot(uri: vscode.Uri | undefined): void {
	registryStorageRoot = uri;
}

/**
 * 生成稳定的 workspace 存储键，避免多项目间 registry 互相污染。
 * @param folder 当前工作区目录对象。
 * @returns 对应工作区的稳定哈希键。
 */
export function getWorkspaceStorageKey(folder: vscode.WorkspaceFolder): string {
	const hash = createHash('sha256').update(folder.uri.toString()).digest('hex').slice(0, 16);
	return `workspace-${hash}`;
}

/**
 * 解析当前 workspace 对应的 registry 文件 URI。
 * @param folder 当前工作区目录对象。
 * @returns registry 文件 URI。
 */
export function getRegistryUri(folder: vscode.WorkspaceFolder): vscode.Uri {
	const configured = vscode.workspace.getConfiguration('writerRefactor').get<string>('registryPath');
	const relativePath = configured && configured.trim().length > 0
		? configured.trim().replace(/^[/\\]+/, '')
		: DEFAULT_REGISTRY_PATH;
	const base = registryStorageRoot
		?? vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'), '.writer-refactor');
	const workspaceBase = vscode.Uri.joinPath(base, getWorkspaceStorageKey(folder));
	return vscode.Uri.joinPath(workspaceBase, relativePath);
}

/**
 * 确保 registry 文件存在，不存在时创建 version:1 的空结构。
 * @param folder 当前工作区目录对象。
 * @returns 无返回值。
 */
export async function ensureRegistryExists(folder: vscode.WorkspaceFolder): Promise<void> {
	const uri = getRegistryUri(folder);
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		const initial: RegistryFile = { version: 1, characters: [] };
		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(initial, null, 2)}\n`, 'utf8'));
	}
}

/**
 * 加载并标准化 registry；解析失败时自动回写空结构。
 * @param folder 当前工作区目录对象。
 * @returns 标准化后的 registry 数据。
 */
export async function loadRegistry(folder: vscode.WorkspaceFolder): Promise<RegistryFile> {
	await ensureRegistryExists(folder);
	const uri = getRegistryUri(folder);
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<RegistryFile>;
		const characters = normalizeCharacters(parsed.characters);
		return {
			version: 1,
			characters,
		};
	} catch (error) {
		vscode.window.showWarningMessage(`Registry parse failed, recreating file. (${String(error)})`);
		const fallback: RegistryFile = { version: 1, characters: [] };
		await saveRegistry(folder, fallback);
		return fallback;
	}
}

/**
 * 保存 registry，并在写入前做去重与结构标准化。
 * @param folder 当前工作区目录对象。
 * @param registry 待写入的 registry 数据。
 * @returns 无返回值。
 */
export async function saveRegistry(folder: vscode.WorkspaceFolder, registry: RegistryFile): Promise<void> {
	const uri = getRegistryUri(folder);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	const normalized: RegistryFile = {
		version: 1,
		characters: normalizeCharacters(registry.characters),
	};
	await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
}

/**
 * 规范化角色数组。
 * 约束：别名文本在全局范围唯一，空别名角色会被丢弃。
 * @param raw 待规范化的未知输入。
 * @returns 规范化后的角色数组。
 */
export function normalizeCharacters(raw: unknown): CharacterEntry[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const textSeen = new Set<string>();
	const result: CharacterEntry[] = [];
	for (const item of raw) {
		const character = normalizeCharacter(item);
		if (!character) {
			continue;
		}
		const aliases: RefactorEntry[] = [];
		for (const alias of character.aliases) {
			const key = alias.text.trim();
			if (textSeen.has(key)) {
				continue;
			}
			textSeen.add(key);
			aliases.push(alias);
		}
		if (aliases.length === 0) {
			continue;
		}
		result.push({ ...character, aliases });
	}
	return result;
}

/**
 * 将未知输入规范化为单个角色对象；不合法结构返回 undefined。
 * @param raw 待规范化的未知输入。
 * @returns 合法角色对象或 undefined。
 */
export function normalizeCharacter(raw: unknown): CharacterEntry | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const candidate = raw as Partial<CharacterEntry>;
	if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
		return undefined;
	}
	const aliases = Array.isArray(candidate.aliases)
		? candidate.aliases
			.map((alias) => normalizeAlias(alias))
			.filter((alias): alias is RefactorEntry => Boolean(alias))
		: [];
	if (aliases.length === 0) {
		return undefined;
	}
	const name = candidate.name.trim();
	return {
		id: candidate.id,
		name: name.length > 0 ? name : aliases[0].text,
		aliases,
	};
}

/**
 * 将未知输入规范化为别名对象；空文本或字段缺失会被过滤。
 * @param raw 待规范化的未知输入。
 * @returns 合法别名对象或 undefined。
 */
export function normalizeAlias(raw: unknown): RefactorEntry | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const candidate = raw as Partial<RefactorEntry>;
	if (typeof candidate.text !== 'string') {
		return undefined;
	}
	const text = candidate.text.trim();
	if (text.length === 0) {
		return undefined;
	}
	return {
		text,
	};
}

/**
 * 生成角色 ID，格式与旧实现保持一致。
 * @param kind ID 类型。
 * @returns 生成后的唯一 ID 字符串。
 */
export function createId(kind: 'character'): string {
	idSequence += 1;
	const timestamp = Date.now().toString(36);
	const sequence = idSequence.toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `${kind}-${timestamp}-${sequence}-${random}`;
}
