import * as assert from 'assert';
import * as vscode from 'vscode';

import { countVisibleChars, ProjectWordCountIndex, TypingSpeedTracker } from '../wordStats';

suite('Word Stats Test Suite', () => {
	test('countVisibleChars removes all whitespace', () => {
		assert.strictEqual(countVisibleChars('  张 三\nabc\t12  '), 7);
		assert.strictEqual(countVisibleChars(' \n\t '), 0);
		assert.strictEqual(countVisibleChars('Hello世界'), 7);
	});

	test('TypingSpeedTracker keeps only last hour net delta', () => {
		const tracker = new TypingSpeedTracker();
		tracker.push(10, 1_000);
		tracker.push(-3, 1_800_000);
		tracker.push(5, 3_600_000);

		assert.strictEqual(tracker.getNetPerHour(3_600_000), 12);
		assert.strictEqual(tracker.getNetPerHour(3_600_001), 2);
	});

	test('ProjectWordCountIndex initialize/update/remove', async () => {
		const fileA = vscode.Uri.file('/virtual/a.txt');
		const fileB = vscode.Uri.file('/virtual/b.md');
		const fileC = vscode.Uri.file('/virtual/c.ts');

		const documents = new Map<string, vscode.TextDocument>([
			[fileA.toString(), makeDocument(fileA, '张三\n李四')],
			[fileB.toString(), makeDocument(fileB, 'ab cd')],
			[fileC.toString(), makeDocument(fileC, 'ignored')],
		]);

		const index = new ProjectWordCountIndex({
			findFiles: async () => [fileA, fileB, fileC],
			openTextDocument: async (uri) => {
				const found = documents.get(uri.toString());
				if (!found) {
					throw new Error('missing');
				}
				return found;
			},
			concurrency: 2,
		});

		await index.initialize();
		assert.ok(index.isInitialized());
		assert.strictEqual(index.getTotal(), 8);
		assert.strictEqual(index.getCount(fileA), 4);
		assert.strictEqual(index.getCount(fileB), 4);
		assert.strictEqual(index.getCount(fileC), undefined);

		index.updateOpenDocument(fileA, 'a b c');
		assert.strictEqual(index.getCount(fileA), 3);
		assert.strictEqual(index.getTotal(), 7);

		index.remove(fileB);
		assert.strictEqual(index.getCount(fileB), undefined);
		assert.strictEqual(index.getTotal(), 3);
	});
});

function makeDocument(uri: vscode.Uri, text: string): vscode.TextDocument {
	return {
		uri,
		fileName: uri.fsPath,
		languageId: 'plaintext',
		getText: () => text,
	} as unknown as vscode.TextDocument;
}
