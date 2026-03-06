export type MatchMode = 'wholeWord' | 'substring';

export interface RefactorEntry {
	text: string;
}

export interface CharacterEntry {
	id: string;
	name: string;
	type: string;
	description: string;
	aliases: RefactorEntry[];
}

export interface RegistryFile {
	version: number;
	characters: CharacterEntry[];
}

export interface ExcludeRules {
	excludeFencedCode: boolean;
	excludeInlineCode: boolean;
	customRegex: string[];
}

export interface HighlightColorRule {
	color: string;
	backgroundColor: string;
	borderColor: string;
	overviewRulerColor: string;
}

export interface HighlightColors {
	strong: HighlightColorRule;
	weak: HighlightColorRule;
}

export interface RangeLike {
	start: number;
	end: number;
}
