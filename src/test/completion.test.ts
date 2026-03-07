import * as assert from 'assert';

import {
	AliasCandidate,
	buildPinyinKeys,
	findMatchedSuffixPrefix,
	normalizePinyinKey,
	sortMatchedCandidates,
} from '../completion';

suite('Completion Pinyin Test Suite', () => {
	function makeCandidate(
		alias: string,
		pinyinFullKeys: string[] = [],
		pinyinInitialKeys: string[] = [],
	): AliasCandidate {
		return {
			alias,
			characterName: alias,
			characterType: '',
			aliasLower: alias.toLowerCase(),
			pinyinFullKeys,
			pinyinInitialKeys,
			searchText: [alias, ...pinyinFullKeys, ...pinyinInitialKeys].join(' '),
		};
	}

	test('matches alias text directly', () => {
		const candidates: AliasCandidate[] = [makeCandidate('李寻欢', ['lixunhuan'], ['lxh'])];
		const result = findMatchedSuffixPrefix('李', candidates, true, 2);
		assert.ok(result);
		assert.strictEqual(result?.prefix, '李');
		assert.strictEqual(result?.candidates[0]?.matchKind, 'alias');
	});

	test('matches full pinyin prefix', () => {
		const candidates: AliasCandidate[] = [makeCandidate('李寻欢', ['lixunhuan'], ['lxh'])];
		const shortResult = findMatchedSuffixPrefix('li', candidates, true, 2);
		assert.ok(shortResult);
		assert.strictEqual(shortResult?.candidates[0]?.matchKind, 'pinyinFull');

		const longResult = findMatchedSuffixPrefix('lix', candidates, true, 2);
		assert.ok(longResult);
		assert.strictEqual(longResult?.candidates[0]?.matchKind, 'pinyinFull');
	});

	test('matches initials prefix', () => {
		const candidates: AliasCandidate[] = [makeCandidate('李寻欢', ['lixunhuan'], ['lxh'])];
		const result = findMatchedSuffixPrefix('lxh', candidates, true, 2);
		assert.ok(result);
		assert.strictEqual(result?.candidates[0]?.matchKind, 'pinyinInitial');
	});

	test('respects pinyin threshold', () => {
		const candidates: AliasCandidate[] = [makeCandidate('李寻欢', ['lixunhuan'], ['lxh'])];
		const result = findMatchedSuffixPrefix('l', candidates, true, 2);
		assert.strictEqual(result, undefined);
	});

	test('supports suffix sliding for replacement range', () => {
		const candidates: AliasCandidate[] = [makeCandidate('李寻欢', ['lixunhuan'], ['lxh'])];
		const result = findMatchedSuffixPrefix('xxlix', candidates, true, 2);
		assert.ok(result);
		assert.strictEqual(result?.prefix, 'lix');
	});

	test('sorts by alias > full pinyin > initials', () => {
		const prefix = 'li';
		const sorted = sortMatchedCandidates(
			[
				{ candidate: makeCandidate('莉莉', ['lili'], ['ll']), matchKind: 'pinyinFull' },
				{ candidate: makeCandidate('李', ['li'], ['l']), matchKind: 'alias' },
				{ candidate: makeCandidate('李寻欢', ['lixunhuan'], ['lxh']), matchKind: 'pinyinInitial' },
			],
			prefix,
		);
		assert.strictEqual(sorted[0]?.matchKind, 'alias');
		assert.strictEqual(sorted[1]?.matchKind, 'pinyinFull');
		assert.strictEqual(sorted[2]?.matchKind, 'pinyinInitial');
	});

	test('normalizes pinyin keys', () => {
		assert.strictEqual(normalizePinyinKey('Li Xun_Huan!'), 'lixunhuan');
	});

	test('collects multi-pronunciation keys from polyphonic engine', () => {
		const mockEngine = {
			pinyin: (_text: string, options?: Record<string, unknown>) => {
				if (options?.pattern === 'first') {
					return 'zy';
				}
				return 'zhong yang';
			},
			polyphonic: (_text: string, options?: Record<string, unknown>) => {
				if (options?.pattern === 'first') {
					return ['cy', 'zy'];
				}
				return ['chong yang', 'zhong yang'];
			},
		};
		const keys = buildPinyinKeys('重阳', mockEngine);
		assert.ok(keys.fullKeys.includes('chongyang'));
		assert.ok(keys.fullKeys.includes('zhongyang'));
		assert.ok(keys.initialKeys.includes('cy'));
		assert.ok(keys.initialKeys.includes('zy'));
	});
});
