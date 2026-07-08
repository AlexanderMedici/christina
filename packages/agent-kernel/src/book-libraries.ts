import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { AgentKernelStore } from "./store";
import type {
	BookChunkRecord,
	BookDocumentFormat,
	BookDocumentRecord,
	BookLibraryRecord,
	BookLibraryScanResult,
	BookSearchResult,
	ContextBlock,
	KnowledgeAgentProfile,
	LibraryAccessLevel,
	LibraryAgentAssignment,
} from "./types";

const DEFAULT_EXTENSIONS = [".pdf", ".epub", ".txt", ".md", ".markdown", ".html", ".htm", ".json", ".csv"];
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;
const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "he", "her", "his",
	"i", "in", "is", "it", "its", "of", "on", "or", "our", "she", "that", "the", "their", "them", "they",
	"this", "to", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
]);

function normalizeExtensions(values?: string[]): string[] {
	return [...new Set((values?.length ? values : DEFAULT_EXTENSIONS).map((value) => {
		const lowered = value.trim().toLowerCase();
		return lowered.startsWith(".") ? lowered : `.${lowered}`;
	}))];
}

function documentFormat(path: string): BookDocumentFormat | undefined {
	switch (extname(path).toLowerCase()) {
		case ".pdf": return "pdf";
		case ".epub": return "epub";
		case ".md":
		case ".markdown": return "markdown";
		case ".html":
		case ".htm": return "html";
		case ".json": return "json";
		case ".csv": return "csv";
		case ".txt": return "text";
		default: return undefined;
	}
}

function normalizeSearchToken(token: string): string {
	if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
	if (token.length > 4 && /(?:ches|shes|xes|zes|sses)$/.test(token)) return token.slice(0, -2);
	if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
	return token;
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.split(/\s+/)
		.map(normalizeSearchToken)
		.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stripMarkup(value: string): string {
	return value
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

function titleFromPath(path: string): string {
	return basename(path, extname(path)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function stableId(prefix: string, value: string): string {
	return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function checksum(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function estimateTokens(value: string): number {
	return Math.max(1, Math.ceil(value.length / 4));
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}

function chunkText(input: {
	text: string;
	libraryId: string;
	documentId: string;
	title: string;
	author?: string;
	section?: string;
	createdAt: string;
	maxChars?: number;
	overlapChars?: number;
}): BookChunkRecord[] {
	const maxChars = input.maxChars ?? 1_800;
	const overlapChars = input.overlapChars ?? 220;
	const paragraphs = input.text
		.replace(/\r/g, "")
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	const chunks: string[] = [];
	let current = "";
	for (const paragraph of paragraphs) {
		if (paragraph.length > maxChars) {
			if (current) {
				chunks.push(current.trim());
				current = "";
			}
			for (let offset = 0; offset < paragraph.length; offset += Math.max(1, maxChars - overlapChars)) {
				chunks.push(paragraph.slice(offset, offset + maxChars).trim());
			}
			continue;
		}
		const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
		if (candidate.length <= maxChars) {
			current = candidate;
			continue;
		}
		chunks.push(current.trim());
		const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
		current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
	}
	if (current.trim()) chunks.push(current.trim());
	return chunks.filter(Boolean).map((text, ordinal) => ({
		id: stableId("chunk", `${input.documentId}:${ordinal}:${text}`),
		libraryId: input.libraryId,
		documentId: input.documentId,
		ordinal,
		text,
		title: input.title,
		author: input.author,
		section: input.section,
		tokenEstimate: estimateTokens(text),
		searchTerms: [...new Set(tokenize(`${input.title} ${input.author ?? ""} ${input.section ?? ""} ${text}`))],
		createdAt: input.createdAt,
	}));
}

async function extractPdf(path: string): Promise<{ text: string; title?: string; author?: string; chapterCount?: number }> {
	const moduleName = "pdf-parse";
	const imported = await import(moduleName) as unknown as {
		PDFParse: new (options: { data: Uint8Array }) => {
			getText(): Promise<{ text: string; total?: number }>;
			getInfo(): Promise<{ infoData?: { Title?: string; Author?: string }; total?: number }>;
			destroy(): Promise<void>;
		};
	};
	const data = new Uint8Array(await readFile(path));
	const parser = new imported.PDFParse({ data });
	try {
		const [textResult, infoResult] = await Promise.all([parser.getText(), parser.getInfo()]);
		return {
			text: textResult.text,
			title: infoResult.infoData?.Title,
			author: infoResult.infoData?.Author,
			chapterCount: textResult.total ?? infoResult.total,
		};
	} finally {
		await parser.destroy();
	}
}

async function extractEpub(path: string): Promise<{ text: string; title?: string; author?: string; chapterCount?: number }> {
	const moduleName = "epub";
	const imported = await import(moduleName) as unknown as {
		default: new (path: string) => {
			parse(): Promise<void>;
			metadata: { title?: string; creator?: string };
			flow: Array<{ id: string; title?: string }>;
			getChapter(id: string): Promise<string>;
		};
	};
	const epub = new imported.default(path);
	await epub.parse();
	const sections: string[] = [];
	for (const chapter of epub.flow) {
		const body = stripMarkup(await epub.getChapter(chapter.id));
		if (body) sections.push(`${chapter.title ? `# ${chapter.title}\n\n` : ""}${body}`);
	}
	return {
		text: sections.join("\n\n"),
		title: epub.metadata.title,
		author: epub.metadata.creator,
		chapterCount: epub.flow.length,
	};
}

async function extractDocument(path: string, format: BookDocumentFormat): Promise<{
	text: string;
	title?: string;
	author?: string;
	chapterCount?: number;
}> {
	if (format === "pdf") return extractPdf(path);
	if (format === "epub") return extractEpub(path);
	const raw = await readFile(path, "utf8");
	if (format === "html") return { text: stripMarkup(raw) };
	if (format === "json") {
		try {
			return { text: JSON.stringify(JSON.parse(raw), null, 2) };
		} catch {
			return { text: raw };
		}
	}
	return { text: raw };
}

async function discoverFiles(library: BookLibraryRecord): Promise<string[]> {
	const source = await realpath(library.sourcePath);
	const sourceInfo = await stat(source);
	const allowed = new Set(library.includeExtensions);
	if (sourceInfo.isFile()) return allowed.has(extname(source).toLowerCase()) ? [source] : [];
	if (!sourceInfo.isDirectory()) return [];
	const files: string[] = [];
	const queue = [source];
	while (queue.length > 0) {
		const dir = queue.shift();
		if (!dir) break;
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const candidate = resolve(dir, entry.name);
			if (entry.isSymbolicLink()) {
				if (!library.followSymlinks) continue;
				const resolved = await realpath(candidate);
				if (!isInside(source, resolved)) continue;
				const info = await stat(resolved);
				if (info.isDirectory() && library.recursive) queue.push(resolved);
				else if (info.isFile() && allowed.has(extname(resolved).toLowerCase())) files.push(resolved);
				continue;
			}
			if (entry.isDirectory()) {
				if (library.recursive) queue.push(candidate);
				continue;
			}
			if (entry.isFile() && allowed.has(extname(candidate).toLowerCase())) files.push(candidate);
		}
	}
	return files.sort();
}

function citationFor(result: { library: BookLibraryRecord; document: BookDocumentRecord; chunk: BookChunkRecord }): string {
	const author = result.document.author ? `${result.document.author}, ` : "";
	const section = result.chunk.section ? `, ${result.chunk.section}` : "";
	return `${author}${result.document.title}${section} [${result.library.name}; chunk ${result.chunk.ordinal + 1}]`;
}

export class BookLibraryService {
	constructor(private readonly store: AgentKernelStore) {}

	async createLibrary(input: {
		name: string;
		sourcePath: string;
		includeExtensions?: string[];
		recursive?: boolean;
		followSymlinks?: boolean;
		maxFileSizeBytes?: number;
		metadata?: Record<string, unknown>;
	}): Promise<BookLibraryRecord> {
		const sourcePath = resolve(input.sourcePath);
		let sourceKind: "file" | "directory" = "directory";
		let status: BookLibraryRecord["status"] = "ready";
		let error: string | undefined;
		try {
			const sourceInfo = await stat(sourcePath);
			sourceKind = sourceInfo.isFile() ? "file" : "directory";
		} catch (caught) {
			status = "unavailable";
			error = caught instanceof Error ? caught.message : String(caught);
		}
		const now = new Date().toISOString();
		const library: BookLibraryRecord = {
			id: randomUUID(),
			name: input.name.trim(),
			sourcePath,
			sourceKind,
			status,
			includeExtensions: normalizeExtensions(input.includeExtensions),
			recursive: input.recursive ?? true,
			followSymlinks: input.followSymlinks ?? false,
			maxFileSizeBytes: input.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE,
			createdAt: now,
			updatedAt: now,
			documentCount: 0,
			chunkCount: 0,
			error,
			metadata: input.metadata,
		};
		await this.store.putBookLibrary(library);
		return library;
	}

	listLibraries(): Promise<BookLibraryRecord[]> {
		return this.store.listBookLibraries();
	}

	async deleteLibrary(libraryId: string): Promise<void> {
		const documents = await this.store.listBookDocuments(libraryId);
		for (const document of documents) {
			await this.store.deleteBookChunksForDocument(document.id);
			await this.store.deleteBookDocument(document.id);
		}
		const assignments = await this.store.listLibraryAssignments(undefined, libraryId);
		await Promise.all(assignments.map((assignment) => this.store.deleteLibraryAssignment(assignment.id)));
		const profiles = await this.store.listKnowledgeAgents();
		for (const profile of profiles) {
			if (!profile.libraryIds.includes(libraryId)) continue;
			const libraryIds = profile.libraryIds.filter((id) => id !== libraryId);
			await this.store.putKnowledgeAgent({
				...profile,
				libraryIds,
				status: libraryIds.length > 0 ? profile.status : "disabled",
				updatedAt: new Date().toISOString(),
			});
		}
		await this.store.deleteBookLibrary(libraryId);
	}

	async scanLibrary(libraryId: string): Promise<BookLibraryScanResult> {
		const existing = await this.store.getBookLibrary(libraryId);
		if (!existing) throw new Error(`Book library not found: ${libraryId}`);
		const startedAt = new Date().toISOString();
		await this.store.putBookLibrary({ ...existing, status: "scanning", updatedAt: startedAt, error: undefined });
		const warnings: string[] = [];
		let files: string[];
		try {
			files = await discoverFiles(existing);
		} catch (error) {
			const unavailable: BookLibraryRecord = {
				...existing,
				status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "unavailable" : "error",
				updatedAt: new Date().toISOString(),
				error: error instanceof Error ? error.message : String(error),
			};
			await this.store.putBookLibrary(unavailable);
			return { library: unavailable, indexed: 0, skipped: 0, failed: 0, removed: 0, warnings: [unavailable.error ?? "Source unavailable."] };
		}

		const currentDocuments = await this.store.listBookDocuments(libraryId);
		const byPath = new Map(currentDocuments.map((document) => [document.absolutePath, document]));
		const seen = new Set<string>();
		let indexed = 0;
		let skipped = 0;
		let failed = 0;
		for (const path of files) {
			seen.add(path);
			const info = await lstat(path);
			const format = documentFormat(path);
			if (!format || info.size > existing.maxFileSizeBytes) {
				skipped += 1;
				if (info.size > existing.maxFileSizeBytes) warnings.push(`Skipped oversized file: ${path}`);
				continue;
			}
			const bytes = await readFile(path);
			const digest = checksum(bytes);
			const previous = byPath.get(path);
			if (previous?.checksum === digest && previous.status === "indexed") {
				skipped += 1;
				continue;
			}
			const documentId = previous?.id ?? stableId("book", `${libraryId}:${path}`);
			try {
				const extracted = await extractDocument(path, format);
				const cleanText = stripMarkup(extracted.text);
				if (!cleanText) throw new Error("No readable text was extracted. This may be an image-only or protected book.");
				const title = extracted.title?.trim() || titleFromPath(path);
				const now = new Date().toISOString();
				const chunks = chunkText({
					text: cleanText,
					libraryId,
					documentId,
					title,
					author: extracted.author?.trim(),
					createdAt: now,
				});
				await this.store.deleteBookChunksForDocument(documentId);
				await Promise.all(chunks.map((chunk) => this.store.putBookChunk(chunk)));
				const document: BookDocumentRecord = {
					id: documentId,
					libraryId,
					absolutePath: path,
					relativePath: existing.sourceKind === "file" ? basename(path) : relative(await realpath(existing.sourcePath), path),
					title,
					author: extracted.author?.trim(),
					format,
					status: "indexed",
					sizeBytes: info.size,
					modifiedAt: info.mtime.toISOString(),
					checksum: digest,
					chapterCount: extracted.chapterCount,
					chunkCount: chunks.length,
					indexedAt: now,
				};
				await this.store.putBookDocument(document);
				indexed += 1;
			} catch (error) {
				const now = new Date().toISOString();
				await this.store.deleteBookChunksForDocument(documentId);
				await this.store.putBookDocument({
					id: documentId,
					libraryId,
					absolutePath: path,
					relativePath: existing.sourceKind === "file" ? basename(path) : relative(await realpath(existing.sourcePath), path),
					title: titleFromPath(path),
					format,
					status: "error",
					sizeBytes: info.size,
					modifiedAt: info.mtime.toISOString(),
					checksum: digest,
					chunkCount: 0,
					indexedAt: now,
					error: error instanceof Error ? error.message : String(error),
				});
				failed += 1;
			}
		}

		let removed = 0;
		for (const document of currentDocuments) {
			if (seen.has(document.absolutePath)) continue;
			await this.store.deleteBookChunksForDocument(document.id);
			await this.store.deleteBookDocument(document.id);
			removed += 1;
		}
		const documents = await this.store.listBookDocuments(libraryId);
		const chunks = await this.store.listBookChunks(libraryId);
		const completedAt = new Date().toISOString();
		const library: BookLibraryRecord = {
			...existing,
			status: "ready",
			updatedAt: completedAt,
			lastScannedAt: completedAt,
			lastAvailableAt: completedAt,
			documentCount: documents.filter((document) => document.status === "indexed").length,
			chunkCount: chunks.length,
			error: failed > 0 ? `${failed} document(s) could not be indexed.` : undefined,
		};
		await this.store.putBookLibrary(library);
		return { library, indexed, skipped, failed, removed, warnings };
	}

	async assignLibrary(input: {
		libraryId: string;
		agentId: string;
		access?: LibraryAccessLevel;
		createdBy?: string;
		note?: string;
	}): Promise<LibraryAgentAssignment> {
		if (!await this.store.getBookLibrary(input.libraryId)) throw new Error(`Book library not found: ${input.libraryId}`);
		const existing = await this.store.listLibraryAssignments(input.agentId, input.libraryId);
		for (const assignment of existing) await this.store.deleteLibraryAssignment(assignment.id);
		const assignment: LibraryAgentAssignment = {
			id: randomUUID(),
			libraryId: input.libraryId,
			agentId: input.agentId,
			access: input.access ?? "read",
			createdAt: new Date().toISOString(),
			createdBy: input.createdBy ?? "user",
			note: input.note,
		};
		await this.store.putLibraryAssignment(assignment);
		return assignment;
	}

	async revokeLibrary(libraryId: string, agentId: string): Promise<void> {
		const assignments = await this.store.listLibraryAssignments(agentId, libraryId);
		await Promise.all(assignments.map((assignment) => this.store.deleteLibraryAssignment(assignment.id)));
	}

	listAssignments(agentId?: string, libraryId?: string): Promise<LibraryAgentAssignment[]> {
		return this.store.listLibraryAssignments(agentId, libraryId);
	}

	async accessibleLibraryIds(agentId: string, requestedLibraryIds?: string[]): Promise<string[]> {
		const assignments = await this.store.listLibraryAssignments(agentId);
		const allowed = new Set(assignments.map((assignment) => assignment.libraryId));
		if (!requestedLibraryIds) return [...allowed];
		for (const id of requestedLibraryIds) {
			if (!allowed.has(id)) throw new Error(`Agent ${agentId} is not authorized to access library ${id}.`);
		}
		return [...new Set(requestedLibraryIds)];
	}

	async search(input: {
		agentId: string;
		query: string;
		libraryIds?: string[];
		maxResults?: number;
		maxTokens?: number;
	}): Promise<BookSearchResult[]> {
		const libraryIds = await this.accessibleLibraryIds(input.agentId, input.libraryIds);
		if (libraryIds.length === 0) return [];
		const queryTerms = [...new Set(tokenize(input.query))];
		if (queryTerms.length === 0) return [];
		const [libraries, documents, chunks] = await Promise.all([
			this.store.listBookLibraries(),
			Promise.all(libraryIds.map((id) => this.store.listBookDocuments(id))).then((groups) => groups.flat()),
			Promise.all(libraryIds.map((id) => this.store.listBookChunks(id))).then((groups) => groups.flat()),
		]);
		const libraryMap = new Map(libraries.map((library) => [library.id, library]));
		const documentMap = new Map(documents.map((document) => [document.id, document]));
		const documentFrequency = new Map<string, number>();
		for (const term of queryTerms) {
			documentFrequency.set(term, chunks.filter((chunk) => chunk.searchTerms.includes(term)).length);
		}
		const phrase = input.query.trim().toLowerCase();
		const scored = chunks.map((chunk) => {
			const tokens = tokenize(chunk.text);
			const counts = new Map<string, number>();
			for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
			let score = 0;
			for (const term of queryTerms) {
				const tf = counts.get(term) ?? 0;
				if (tf === 0) continue;
				const df = documentFrequency.get(term) ?? 0;
				const idf = Math.log(1 + (chunks.length + 1) / (df + 1));
				score += (1 + Math.log(tf)) * idf;
			}
			if (phrase.length > 5 && chunk.text.toLowerCase().includes(phrase)) score += 8;
			if (chunk.title.toLowerCase().includes(phrase)) score += 4;
			return { chunk, score };
		}).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

		const results: BookSearchResult[] = [];
		let tokens = 0;
		for (const item of scored) {
			if (results.length >= (input.maxResults ?? 8)) break;
			if (tokens + item.chunk.tokenEstimate > (input.maxTokens ?? 8_000) && results.length > 0) continue;
			const document = documentMap.get(item.chunk.documentId);
			const library = libraryMap.get(item.chunk.libraryId);
			if (!document || !library || document.status !== "indexed") continue;
			const result: BookSearchResult = {
				chunk: item.chunk,
				document,
				library,
				score: Math.round(item.score * 100) / 100,
				citation: citationFor({ chunk: item.chunk, document, library }),
			};
			results.push(result);
			tokens += item.chunk.tokenEstimate;
		}
		return results;
	}

	async contextForAgent(input: {
		agentId: string;
		query: string;
		libraryIds?: string[];
		maxResults?: number;
		maxTokens?: number;
	}): Promise<{ block?: ContextBlock; results: BookSearchResult[] }> {
		const results = await this.search(input);
		if (results.length === 0) return { results };
		const content = [
			"PRIVATE BOOK LIBRARY CONTEXT",
			`Authorized agent: ${input.agentId}`,
			"Use only the excerpts below for book-specific claims. Cite them with the exact [BOOK n] marker. Do not imply that you read material not shown here.",
			...results.map((result, index) => `\n[BOOK ${index + 1}] ${result.citation}\n${result.chunk.text}`),
		].join("\n");
		return {
			results,
			block: {
				id: `private-books-${stableId("ctx", `${input.agentId}:${input.query}`).slice(-16)}`,
				kind: "memory",
				priority: 97,
				pinned: true,
				compactable: false,
				source: `private-book-library:${input.agentId}`,
				content,
			},
		};
	}

	async createKnowledgeAgent(input: {
		name: string;
		runtimeId: string;
		model: string;
		localOnly?: boolean;
		libraryIds: string[];
		teachingStyle?: KnowledgeAgentProfile["teachingStyle"];
		metadata?: Record<string, unknown>;
	}): Promise<KnowledgeAgentProfile> {
		const now = new Date().toISOString();
		const profile: KnowledgeAgentProfile = {
			id: randomUUID(),
			name: input.name.trim(),
			runtimeId: input.runtimeId,
			model: input.model,
			localOnly: input.localOnly ?? true,
			libraryIds: [...new Set(input.libraryIds)],
			teachingStyle: input.teachingStyle ?? "step-by-step",
			status: "active",
			createdAt: now,
			updatedAt: now,
			metadata: input.metadata,
		};
		for (const libraryId of profile.libraryIds) await this.assignLibrary({ libraryId, agentId: profile.id, access: "teach" });
		await this.store.putKnowledgeAgent(profile);
		return profile;
	}

	getKnowledgeAgent(id: string): Promise<KnowledgeAgentProfile | undefined> {
		return this.store.getKnowledgeAgent(id);
	}

	listKnowledgeAgents(): Promise<KnowledgeAgentProfile[]> {
		return this.store.listKnowledgeAgents();
	}
}
