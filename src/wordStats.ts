import * as path from 'path';

import * as vscode from 'vscode';

import { isSupportedDocument } from './matcher';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function countVisibleChars(text: string): number {
	return text.replace(/\s+/gu, '').length;
}

export function isCountableDocument(document: vscode.TextDocument): boolean {
	return isSupportedDocument(document);
}

function isCountableUri(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return false;
	}
	const ext = path.extname(uri.fsPath).toLowerCase();
	return ext === '.txt' || ext === '.md';
}

export class TypingSpeedTracker {
	private readonly entries: Array<{ ts: number; delta: number }> = [];

	public push(delta: number, ts = Date.now()): void {
		if (delta === 0) {
			this.prune(ts);
			return;
		}
		this.entries.push({ ts, delta });
		this.prune(ts);
	}

	public prune(now = Date.now()): void {
		const threshold = now - ONE_HOUR_MS;
		while (this.entries.length > 0 && this.entries[0].ts < threshold) {
			this.entries.shift();
		}
	}

	public getNetPerHour(now = Date.now()): number {
		this.prune(now);
		let total = 0;
		for (const entry of this.entries) {
			total += entry.delta;
		}
		return total;
	}
}

type FindFilesFn = () => Thenable<vscode.Uri[]>;
type OpenTextDocumentFn = (uri: vscode.Uri) => Thenable<vscode.TextDocument>;

interface ProjectWordCountIndexOptions {
	findFiles?: FindFilesFn;
	openTextDocument?: OpenTextDocumentFn;
	concurrency?: number;
}

export class ProjectWordCountIndex {
	private readonly counts = new Map<string, number>();
	private total = 0;
	private initialized = false;
	private readonly findFilesFn: FindFilesFn;
	private readonly openTextDocumentFn: OpenTextDocumentFn;
	private readonly concurrency: number;

	public constructor(options: ProjectWordCountIndexOptions = {}) {
		this.findFilesFn = options.findFiles ?? defaultFindFiles;
		this.openTextDocumentFn = options.openTextDocument ?? vscode.workspace.openTextDocument;
		this.concurrency = Math.max(1, options.concurrency ?? 8);
	}

	public isInitialized(): boolean {
		return this.initialized;
	}

	public getTotal(): number {
		return this.total;
	}

	public getCount(uri: vscode.Uri): number | undefined {
		return this.counts.get(uri.toString());
	}

	public async initialize(onProgress?: () => void): Promise<void> {
		this.counts.clear();
		this.total = 0;
		this.initialized = false;

		const uris = await this.findFilesFn();
		let cursor = 0;
		const workerCount = Math.min(this.concurrency, uris.length || 1);
		await Promise.all(Array.from({ length: workerCount }, async () => {
			while (cursor < uris.length) {
				const current = uris[cursor];
				cursor += 1;
				if (!isCountableUri(current)) {
					continue;
				}
				try {
					const document = await this.openTextDocumentFn(current);
					if (!isCountableDocument(document)) {
						continue;
					}
					this.updateCount(current, countVisibleChars(document.getText()));
					onProgress?.();
				} catch {
					// Ignore unreadable files.
				}
			}
		}));
		this.initialized = true;
	}

	public isCountableUri(uri: vscode.Uri): boolean {
		return isCountableUri(uri);
	}

	public updateOpenDocument(uri: vscode.Uri, text: string): void {
		if (!isCountableUri(uri)) {
			return;
		}
		this.updateCount(uri, countVisibleChars(text));
	}

	public remove(uri: vscode.Uri): void {
		const key = uri.toString();
		const previous = this.counts.get(key);
		if (typeof previous !== 'number') {
			return;
		}
		this.total -= previous;
		this.counts.delete(key);
	}

	private updateCount(uri: vscode.Uri, nextValue: number): void {
		const key = uri.toString();
		const previous = this.counts.get(key) ?? 0;
		this.total += nextValue - previous;
		this.counts.set(key, nextValue);
	}
}

async function defaultFindFiles(): Promise<vscode.Uri[]> {
	return vscode.workspace.findFiles('**/*.{txt,md}', '**/node_modules/**');
}
