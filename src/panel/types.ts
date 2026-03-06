export interface PanelAlias {
	text: string;
}

export interface PanelCharacter {
	id: string;
	name: string;
	aliases: PanelAlias[];
}

export interface PanelSnapshot {
	workspaceName: string;
	characters: PanelCharacter[];
}

export interface PanelError {
	code: string;
	message: string;
}

export type PanelToExtMessage =
	| { type: 'panel.ready' }
	| { type: 'panel.refresh' }
	| { type: 'panel.character.add'; name: string }
	| { type: 'panel.character.rename'; characterId: string; name: string }
	| { type: 'panel.character.delete'; characterId: string; confirm: boolean }
	| { type: 'panel.alias.add'; characterId: string; text: string }
	| { type: 'panel.alias.rename'; characterId: string; aliasText: string; text: string }
	| { type: 'panel.alias.delete'; characterId: string; aliasText: string };

export type ExtToPanelMessage =
	| { type: 'ext.snapshot'; snapshot: PanelSnapshot }
	| { type: 'ext.error'; error: PanelError; requestType?: string }
	| { type: 'ext.toast'; message: string };
