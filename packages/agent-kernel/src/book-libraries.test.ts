import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookLibraryService } from "./book-libraries";
import { FileAgentKernelStore } from "./store";

const paths: string[] = [];
afterEach(async () => {
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("BookLibraryService", () => {
	test("indexes a local folder and enforces per-agent access", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-books-"));
		paths.push(root);
		const books = join(root, "books");
		await mkdir(books, { recursive: true });
		await Bun.write(join(books, "javascript.txt"), "A closure is a function together with its lexical environment. Closures preserve access to outer variables.");
		const store = new FileAgentKernelStore(join(root, "store"));
		await store.initialize();
		const service = new BookLibraryService(store);
		const library = await service.createLibrary({ name: "JavaScript", sourcePath: books });
		const scan = await service.scanLibrary(library.id);
		expect(scan.library.documentCount).toBe(1);
		expect(scan.library.chunkCount).toBeGreaterThan(0);

		await service.assignLibrary({ libraryId: library.id, agentId: "TUTOR", access: "teach" });
		const allowed = await service.search({ agentId: "TUTOR", query: "What is a closure?" });
		expect(allowed.length).toBeGreaterThan(0);
		expect(allowed[0]?.citation).toContain("javascript");
		await expect(service.search({ agentId: "OTHER", query: "closure", libraryIds: [library.id] })).rejects.toThrow("not authorized");
	});

	test("keeps an existing index when an external source is unavailable", async () => {
		const root = await mkdtemp(join(tmpdir(), "christina-external-books-"));
		paths.push(root);
		const file = join(root, "book.txt");
		await writeFile(file, "Retrieval augmented generation grounds answers in selected passages.", "utf8");
		const store = new FileAgentKernelStore(join(root, "store"));
		await store.initialize();
		const service = new BookLibraryService(store);
		const library = await service.createLibrary({ name: "External", sourcePath: file });
		await service.scanLibrary(library.id);
		await rm(file);
		const unavailable = await service.scanLibrary(library.id);
		expect(unavailable.library.status).toBe("unavailable");
		expect((await store.listBookChunks(library.id)).length).toBeGreaterThan(0);
	});
});
