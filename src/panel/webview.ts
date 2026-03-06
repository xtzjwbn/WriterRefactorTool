import * as vscode from 'vscode';

import { addAlias, addCharacter, getPanelSnapshot, removeAlias, removeCharacter, toServiceError, updateAliasText, updateCharacterMeta, updateCharacterName } from './service';
import { ExtToPanelMessage, PanelToExtMessage } from './types';

let managerPanel: vscode.WebviewPanel | undefined;

/**
 * 打开或复用角色管理面板。
 * @param context VS Code 扩展上下文。
 * @returns 无返回值。
 */
export function openCharacterManagerPanel(context: vscode.ExtensionContext): void {
	if (managerPanel) {
		managerPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	managerPanel = vscode.window.createWebviewPanel(
		'writerRefactor.characterManager',
		'Writer Refactor: 角色管理',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'panel', 'media')],
		},
	);

	managerPanel.webview.html = getWebviewHtml(context, managerPanel.webview);

	managerPanel.onDidDispose(() => {
		managerPanel = undefined;
	});

	managerPanel.webview.onDidReceiveMessage(async (message: PanelToExtMessage) => {
		await handlePanelMessage(message);
	});
}

async function handlePanelMessage(message: PanelToExtMessage): Promise<void> {
	const panel = managerPanel;
	if (!panel) {
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		postMessage({
			type: 'ext.error',
			error: { code: 'workspace_required', message: 'Writer Refactor requires an open workspace folder.' },
			requestType: message.type,
		});
		return;
	}

	try {
		switch (message.type) {
			case 'panel.ready':
			case 'panel.refresh': {
				const snapshot = await getPanelSnapshot(workspaceFolder);
				postMessage({ type: 'ext.snapshot', snapshot });
				return;
			}
			case 'panel.character.add': {
				const snapshot = await addCharacter(workspaceFolder, message.name);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '角色已新增。' });
				return;
			}
			case 'panel.character.rename': {
				const snapshot = await updateCharacterName(workspaceFolder, message.characterId, message.name);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '角色名已更新。' });
				return;
			}
			case 'panel.character.updateMeta': {
				const snapshot = await updateCharacterMeta(
					workspaceFolder,
					message.characterId,
					message.characterType,
					message.description,
				);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '角色信息已更新。' });
				return;
			}
			case 'panel.character.delete': {
				const snapshot = await removeCharacter(workspaceFolder, message.characterId, message.confirm);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '角色已删除。' });
				return;
			}
			case 'panel.alias.add': {
				const snapshot = await addAlias(workspaceFolder, message.characterId, message.text);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '别名已新增。' });
				return;
			}
			case 'panel.alias.rename': {
				const snapshot = await updateAliasText(workspaceFolder, message.characterId, message.aliasText, message.text);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '别名已更新。' });
				return;
			}
			case 'panel.alias.delete': {
				const snapshot = await removeAlias(workspaceFolder, message.characterId, message.aliasText);
				postMessage({ type: 'ext.snapshot', snapshot });
				postMessage({ type: 'ext.toast', message: '别名已删除。' });
				return;
			}
			default:
				postMessage({
					type: 'ext.error',
					error: { code: 'unsupported_message', message: '不支持的请求类型。' },
					requestType: (message as { type: string }).type,
				});
		}
	} catch (error) {
		const serviceError = toServiceError(error);
		postMessage({
			type: 'ext.error',
			error: { code: serviceError.code, message: serviceError.message },
			requestType: message.type,
		});
	}
}

function postMessage(message: ExtToPanelMessage): void {
	managerPanel?.webview.postMessage(message);
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'panel', 'media', 'main.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'panel', 'media', 'main.css'));
	const nonce = createNonce();
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Writer Refactor 角色管理</title>
</head>
<body>
	<header class="toolbar">
		<div class="toolbar-title">角色管理</div>
		<div class="toolbar-actions">
			<button id="add-character" type="button">新增角色</button>
			<button id="refresh" type="button">刷新</button>
		</div>
	</header>
	<main>
		<div id="status" class="status">正在加载...</div>
		<div id="toast" class="toast" hidden></div>
		<div id="character-list" class="character-list"></div>
	</main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 16; i += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
