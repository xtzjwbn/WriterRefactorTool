(function () {
	const vscode = acquireVsCodeApi();

	const statusEl = document.getElementById('status');
	const listEl = document.getElementById('character-list');
	const toastEl = document.getElementById('toast');
	const addCharacterBtn = document.getElementById('add-character');
	const refreshBtn = document.getElementById('refresh');

	let snapshot = null;
	let editing = null;
	const aliasExpandedByCharacterId = new Map();

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message || typeof message.type !== 'string') {
			return;
		}

		if (message.type === 'ext.snapshot') {
			snapshot = message.snapshot;
			render();
			setStatus(`Workspace: ${snapshot.workspaceName}`);
			return;
		}

		if (message.type === 'ext.error') {
			showToast(message.error && message.error.message ? message.error.message : '操作失败。', true);
			return;
		}

		if (message.type === 'ext.toast') {
			showToast(message.message || '已更新。', false);
		}
	});

	addCharacterBtn.addEventListener('click', () => {
		if (editing) {
			return;
		}
		editing = { type: 'new-character' };
		render();
	});

	refreshBtn.addEventListener('click', () => {
		vscode.postMessage({ type: 'panel.refresh' });
	});

	function setStatus(message) {
		statusEl.textContent = message;
	}

	function showToast(message, isError) {
		toastEl.hidden = false;
		toastEl.textContent = message;
		toastEl.className = isError ? 'toast error' : 'toast';
		window.clearTimeout(showToast.timer);
		showToast.timer = window.setTimeout(() => {
			toastEl.hidden = true;
		}, 2200);
	}

	function beginEdit(type, payload) {
		editing = Object.assign({ type }, payload);
		render();
	}

	function cancelEdit() {
		editing = null;
		render();
	}

	function submitEdit(value) {
		if (!editing) {
			return;
		}
		const text = value.trim();
		switch (editing.type) {
			case 'new-character':
				vscode.postMessage({ type: 'panel.character.add', name: text });
				break;
			case 'rename-character':
				vscode.postMessage({
					type: 'panel.character.rename',
					characterId: editing.characterId,
					name: text,
				});
				break;
			case 'new-alias':
				vscode.postMessage({
					type: 'panel.alias.add',
					characterId: editing.characterId,
					text,
				});
				break;
			case 'rename-alias':
				vscode.postMessage({
					type: 'panel.alias.rename',
					characterId: editing.characterId,
					aliasText: editing.aliasText,
					text,
				});
				break;
			default:
				break;
		}
		editing = null;
		render();
	}

	function submitMetaEdit(characterId, characterType, description) {
		vscode.postMessage({
			type: 'panel.character.updateMeta',
			characterId,
			characterType: characterType.trim(),
			description: description.trim(),
		});
		editing = null;
		render();
	}

	function render() {
		listEl.innerHTML = '';
		if (!snapshot || !Array.isArray(snapshot.characters)) {
			setStatus('正在加载...');
			return;
		}
		syncAliasExpandedState();
		if (snapshot.characters.length === 0 && (!editing || editing.type !== 'new-character')) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.textContent = '暂无角色，点击“新增角色”开始。';
			listEl.appendChild(empty);
			return;
		}

		if (editing && editing.type === 'new-character') {
			listEl.appendChild(renderInlineEditor('输入角色名并回车保存', '', submitEdit, cancelEdit));
		}

		snapshot.characters.forEach((character) => {
			listEl.appendChild(renderCharacterCard(character));
		});
	}

	function renderCharacterCard(character) {
		const card = document.createElement('section');
		card.className = 'character-card';

		const header = document.createElement('div');
		header.className = 'character-header';

		if (editing && editing.type === 'rename-character' && editing.characterId === character.id) {
			header.appendChild(
				renderInlineEditor('输入角色名并回车保存', character.name, submitEdit, cancelEdit),
			);
		} else {
			const title = document.createElement('div');
			title.className = 'character-title';
			title.textContent = `${character.name} (${character.aliases.length})`;
			header.appendChild(title);

			const actions = document.createElement('div');
			actions.className = 'actions';
			actions.appendChild(createActionButton('编辑', () => beginEdit('rename-character', { characterId: character.id })));
			actions.appendChild(createActionButton('编辑信息', () => beginEdit('edit-character-meta', { characterId: character.id })));
			actions.appendChild(createActionButton('新增别名', () => beginEdit('new-alias', { characterId: character.id })));
			actions.appendChild(createActionButton('删除角色', () => {
				const confirmed = window.confirm(`删除角色“${character.name}”及其所有别名？`);
				if (!confirmed) {
					return;
				}
				vscode.postMessage({ type: 'panel.character.delete', characterId: character.id, confirm: true });
			}));
			header.appendChild(actions);
		}

		card.appendChild(header);
		card.appendChild(renderCharacterMeta(character));
		card.appendChild(renderAliasGroup(character));
		return card;
	}

	function renderAliasGroup(character) {
		const isExpanded = isAliasGroupExpanded(character);
		const group = document.createElement('section');
		group.className = isExpanded ? 'alias-group' : 'alias-group is-collapsed';

		const toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'alias-group-toggle';
		toggle.setAttribute('aria-expanded', String(isExpanded));
		toggle.addEventListener('click', () => {
			const current = aliasExpandedByCharacterId.get(character.id);
			const currentExpanded = typeof current === 'boolean' ? current : true;
			aliasExpandedByCharacterId.set(character.id, !currentExpanded);
			render();
		});

		const title = document.createElement('span');
		title.className = 'alias-group-title';
		title.textContent = '角色别名';
		toggle.appendChild(title);

		const indicator = document.createElement('span');
		indicator.className = 'alias-group-indicator';
		indicator.textContent = isExpanded ? '收起' : '展开';
		toggle.appendChild(indicator);

		group.appendChild(toggle);
		if (isExpanded) {
			group.appendChild(renderAliasList(character));
		}
		return group;
	}

	function renderAliasList(character) {
		const aliasList = document.createElement('ul');
		aliasList.className = 'alias-list';

		if (editing && editing.type === 'new-alias' && editing.characterId === character.id) {
			const row = document.createElement('li');
			row.className = 'alias-row';
			row.appendChild(renderInlineEditor('输入别名并回车保存', '', submitEdit, cancelEdit));
			aliasList.appendChild(row);
		}

		character.aliases.forEach((alias) => {
			const row = document.createElement('li');
			row.className = 'alias-row';
			if (
				editing
				&& editing.type === 'rename-alias'
				&& editing.characterId === character.id
				&& editing.aliasText === alias.text
			) {
				row.appendChild(renderInlineEditor('输入别名并回车保存', alias.text, submitEdit, cancelEdit));
			} else {
				const text = document.createElement('span');
				text.className = 'alias-text';
				text.textContent = alias.text;
				row.appendChild(text);

				const actions = document.createElement('div');
				actions.className = 'actions';
				actions.appendChild(createActionButton('编辑', () => beginEdit('rename-alias', {
					characterId: character.id,
					aliasText: alias.text,
				})));
				actions.appendChild(createActionButton('删除', () => {
					vscode.postMessage({ type: 'panel.alias.delete', characterId: character.id, aliasText: alias.text });
				}));
				row.appendChild(actions);
			}
			aliasList.appendChild(row);
		});

		return aliasList;
	}

	function isAliasGroupExpanded(character) {
		const shouldForceExpanded = isEditingAliasInCharacter(character);
		if (shouldForceExpanded) {
			aliasExpandedByCharacterId.set(character.id, true);
			return true;
		}
		const value = aliasExpandedByCharacterId.get(character.id);
		if (typeof value !== 'boolean') {
			aliasExpandedByCharacterId.set(character.id, true);
			return true;
		}
		return value;
	}

	function isEditingAliasInCharacter(character) {
		if (!editing) {
			return false;
		}
		if (editing.type === 'new-alias' && editing.characterId === character.id) {
			return true;
		}
		if (editing.type !== 'rename-alias') {
			return false;
		}
		if (editing.characterId === character.id) {
			return true;
		}
		return character.aliases.some((alias) => alias.text === editing.aliasText);
	}

	function syncAliasExpandedState() {
		const characterIds = new Set(snapshot.characters.map((character) => character.id));
		for (const id of aliasExpandedByCharacterId.keys()) {
			if (!characterIds.has(id)) {
				aliasExpandedByCharacterId.delete(id);
			}
		}
	}

	function renderCharacterMeta(character) {
		const meta = document.createElement('div');
		meta.className = 'character-meta';

		if (editing && editing.type === 'edit-character-meta' && editing.characterId === character.id) {
			meta.appendChild(renderCharacterMetaEditor(character));
			return meta;
		}

		meta.appendChild(createMetaItem('类型', character.type));
		meta.appendChild(createMetaItem('描述', character.description));
		return meta;
	}

	function createMetaItem(label, value) {
		const row = document.createElement('div');
		row.className = 'meta-row';

		const name = document.createElement('span');
		name.className = 'meta-label';
		name.textContent = `${label}：`;
		row.appendChild(name);

		const text = document.createElement('span');
		text.className = value ? 'meta-value' : 'meta-value empty';
		text.textContent = value || '空';
		row.appendChild(text);
		return row;
	}

	function renderCharacterMetaEditor(character) {
		const editor = document.createElement('div');
		editor.className = 'meta-editor';

		const typeInput = document.createElement('input');
		typeInput.type = 'text';
		typeInput.placeholder = '输入角色类型';
		typeInput.value = character.type || '';
		editor.appendChild(typeInput);

		const descriptionInput = document.createElement('textarea');
		descriptionInput.placeholder = '输入角色描述';
		descriptionInput.value = character.description || '';
		descriptionInput.rows = 3;
		editor.appendChild(descriptionInput);

		const actions = document.createElement('div');
		actions.className = 'actions';
		actions.appendChild(createActionButton('保存信息', () => {
			submitMetaEdit(character.id, typeInput.value, descriptionInput.value);
		}));
		actions.appendChild(createActionButton('取消', cancelEdit));
		editor.appendChild(actions);

		window.setTimeout(() => {
			typeInput.focus();
			typeInput.select();
		}, 0);
		return editor;
	}

	function renderInlineEditor(placeholder, initialValue, onSubmit, onCancel) {
		const box = document.createElement('div');
		box.className = 'inline-editor';
		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = placeholder;
		input.value = initialValue;

		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				onSubmit(input.value);
				return;
			}
			if (event.key === 'Escape') {
				onCancel();
			}
		});

		input.addEventListener('blur', () => {
			onCancel();
		});

		box.appendChild(input);
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
		return box;
	}

	function createActionButton(label, onClick) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'action-btn';
		button.textContent = label;
		button.addEventListener('click', onClick);
		return button;
	}

	vscode.postMessage({ type: 'panel.ready' });
})();
