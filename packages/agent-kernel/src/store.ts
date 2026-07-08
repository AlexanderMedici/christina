import {
	appendFile,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
	AgentEvent,
	AgentRun,
	AgentSession,
	AgentTask,
	ApprovalRecord,
	CheckpointRecord,
	ChristinaOrchestration,
	BookLibraryRecord,
	BookDocumentRecord,
	BookChunkRecord,
	LibraryAgentAssignment,
	KnowledgeAgentProfile,
	MemoryRecord,
	SessionMessage,
	SkillDefinition,
} from "./types";

function safeId(value: string): string {
	if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
		throw new Error(`Invalid storage id: ${value}`);
	}
	return value;
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	try {
		await rename(tempPath, path);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (
			process.platform !== "win32" ||
			(code !== "EEXIST" && code !== "EPERM")
		) {
			throw error;
		}
		// Windows may refuse to replace an existing target. Keep user data intact by
		// removing only the old JSON record, then moving the fully-written temp file.
		await rm(path, { force: true });
		await rename(tempPath, path);
	}
}

async function listJson<T>(dir: string): Promise<T[]> {
	try {
		const names = (await readdir(dir)) as string[];
		const values = await Promise.all(
			names
				.filter((name: string) => name.endsWith(".json"))
				.map((name: string) => readJson<T>(join(dir, name))),
		);
		const result: T[] = [];
		for (const value of values) {
			if (value !== undefined) result.push(value as T);
		}
		return result;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export interface AgentKernelStore {
	initialize(): Promise<void>;
	putSession(session: AgentSession): Promise<void>;
	getSession(id: string): Promise<AgentSession | undefined>;
	listSessions(): Promise<AgentSession[]>;
	putRun(run: AgentRun): Promise<void>;
	getRun(id: string): Promise<AgentRun | undefined>;
	listRuns(sessionId?: string): Promise<AgentRun[]>;
	appendEvent(event: AgentEvent): Promise<void>;
	listEvents(runId: string): Promise<AgentEvent[]>;
	putApproval(approval: ApprovalRecord): Promise<void>;
	getApproval(id: string): Promise<ApprovalRecord | undefined>;
	listApprovals(runId?: string): Promise<ApprovalRecord[]>;
	putMemory(memory: MemoryRecord): Promise<void>;
	getMemory(id: string): Promise<MemoryRecord | undefined>;
	listMemories(): Promise<MemoryRecord[]>;
	putSkill(skill: SkillDefinition): Promise<void>;
	listSkills(): Promise<SkillDefinition[]>;
	putTask(task: AgentTask): Promise<void>;
	getTask(id: string): Promise<AgentTask | undefined>;
	listTasks(graphId?: string): Promise<AgentTask[]>;
	putMessage(message: SessionMessage): Promise<void>;
	getMessage(id: string): Promise<SessionMessage | undefined>;
	listMessages(sessionId?: string): Promise<SessionMessage[]>;
	putCheckpoint(checkpoint: CheckpointRecord): Promise<void>;
	getCheckpoint(id: string): Promise<CheckpointRecord | undefined>;
	listCheckpoints(sessionId?: string): Promise<CheckpointRecord[]>;
	putOrchestration(orchestration: ChristinaOrchestration): Promise<void>;
	getOrchestration(id: string): Promise<ChristinaOrchestration | undefined>;
	listOrchestrations(): Promise<ChristinaOrchestration[]>;
	putBookLibrary(library: BookLibraryRecord): Promise<void>;
	getBookLibrary(id: string): Promise<BookLibraryRecord | undefined>;
	listBookLibraries(): Promise<BookLibraryRecord[]>;
	deleteBookLibrary(id: string): Promise<void>;
	putBookDocument(document: BookDocumentRecord): Promise<void>;
	getBookDocument(id: string): Promise<BookDocumentRecord | undefined>;
	listBookDocuments(libraryId?: string): Promise<BookDocumentRecord[]>;
	deleteBookDocument(id: string): Promise<void>;
	putBookChunk(chunk: BookChunkRecord): Promise<void>;
	listBookChunks(libraryId?: string, documentId?: string): Promise<BookChunkRecord[]>;
	deleteBookChunksForDocument(documentId: string): Promise<void>;
	putLibraryAssignment(assignment: LibraryAgentAssignment): Promise<void>;
	listLibraryAssignments(agentId?: string, libraryId?: string): Promise<LibraryAgentAssignment[]>;
	deleteLibraryAssignment(id: string): Promise<void>;
	putKnowledgeAgent(profile: KnowledgeAgentProfile): Promise<void>;
	getKnowledgeAgent(id: string): Promise<KnowledgeAgentProfile | undefined>;
	listKnowledgeAgents(): Promise<KnowledgeAgentProfile[]>;
}

export class FileAgentKernelStore implements AgentKernelStore {
	private readonly sessionsDir: string;
	private readonly runsDir: string;
	private readonly eventsDir: string;
	private readonly approvalsDir: string;
	private readonly memoriesDir: string;
	private readonly skillsDir: string;
	private readonly tasksDir: string;
	private readonly messagesDir: string;
	private readonly checkpointsDir: string;
	private readonly orchestrationsDir: string;
	private readonly bookLibrariesDir: string;
	private readonly bookDocumentsDir: string;
	private readonly bookChunksDir: string;
	private readonly libraryAssignmentsDir: string;
	private readonly knowledgeAgentsDir: string;
	private eventWriteQueue = Promise.resolve();

	constructor(public readonly rootDir: string) {
		this.sessionsDir = join(rootDir, "sessions");
		this.runsDir = join(rootDir, "runs");
		this.eventsDir = join(rootDir, "events");
		this.approvalsDir = join(rootDir, "approvals");
		this.memoriesDir = join(rootDir, "memory");
		this.skillsDir = join(rootDir, "skills");
		this.tasksDir = join(rootDir, "tasks");
		this.messagesDir = join(rootDir, "messages");
		this.checkpointsDir = join(rootDir, "checkpoints");
		this.orchestrationsDir = join(rootDir, "orchestrations");
		this.bookLibrariesDir = join(rootDir, "book-libraries", "libraries");
		this.bookDocumentsDir = join(rootDir, "book-libraries", "documents");
		this.bookChunksDir = join(rootDir, "book-libraries", "chunks");
		this.libraryAssignmentsDir = join(rootDir, "book-libraries", "assignments");
		this.knowledgeAgentsDir = join(rootDir, "book-libraries", "agents");
	}

	async initialize(): Promise<void> {
		await Promise.all(
			[
				this.sessionsDir,
				this.runsDir,
				this.eventsDir,
				this.approvalsDir,
				this.memoriesDir,
				this.skillsDir,
				this.tasksDir,
				this.messagesDir,
				this.checkpointsDir,
				this.orchestrationsDir,
				this.bookLibrariesDir,
				this.bookDocumentsDir,
				this.bookChunksDir,
				this.libraryAssignmentsDir,
				this.knowledgeAgentsDir,
			].map((dir) => mkdir(dir, { recursive: true })),
		);
	}

	putSession(session: AgentSession): Promise<void> {
		return atomicWrite(
			join(this.sessionsDir, `${safeId(session.id)}.json`),
			session,
		);
	}

	getSession(id: string): Promise<AgentSession | undefined> {
		return readJson(join(this.sessionsDir, `${safeId(id)}.json`));
	}

	async listSessions(): Promise<AgentSession[]> {
		return (await listJson<AgentSession>(this.sessionsDir)).sort((a, b) =>
			b.lastActiveAt.localeCompare(a.lastActiveAt),
		);
	}

	putRun(run: AgentRun): Promise<void> {
		return atomicWrite(join(this.runsDir, `${safeId(run.id)}.json`), run);
	}

	getRun(id: string): Promise<AgentRun | undefined> {
		return readJson(join(this.runsDir, `${safeId(id)}.json`));
	}

	async listRuns(sessionId?: string): Promise<AgentRun[]> {
		const runs = await listJson<AgentRun>(this.runsDir);
		return runs
			.filter((run) => !sessionId || run.sessionId === sessionId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	appendEvent(event: AgentEvent): Promise<void> {
		const path = join(this.eventsDir, `${safeId(event.runId)}.jsonl`);
		this.eventWriteQueue = this.eventWriteQueue.then(async () => {
			await mkdir(this.eventsDir, { recursive: true });
			await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
		});
		return this.eventWriteQueue;
	}

	async listEvents(runId: string): Promise<AgentEvent[]> {
		try {
			const raw = await readFile(
				join(this.eventsDir, `${safeId(runId)}.jsonl`),
				"utf8",
			);
			return raw
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line: string) => JSON.parse(line) as AgentEvent)
				.sort((a: AgentEvent, b: AgentEvent) => a.sequence - b.sequence);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	putApproval(approval: ApprovalRecord): Promise<void> {
		return atomicWrite(
			join(this.approvalsDir, `${safeId(approval.id)}.json`),
			approval,
		);
	}

	getApproval(id: string): Promise<ApprovalRecord | undefined> {
		return readJson(join(this.approvalsDir, `${safeId(id)}.json`));
	}

	async listApprovals(runId?: string): Promise<ApprovalRecord[]> {
		const approvals = await listJson<ApprovalRecord>(this.approvalsDir);
		return approvals
			.filter((approval) => !runId || approval.runId === runId)
			.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
	}

	putMemory(memory: MemoryRecord): Promise<void> {
		return atomicWrite(
			join(this.memoriesDir, `${safeId(memory.id)}.json`),
			memory,
		);
	}

	getMemory(id: string): Promise<MemoryRecord | undefined> {
		return readJson(join(this.memoriesDir, `${safeId(id)}.json`));
	}

	listMemories(): Promise<MemoryRecord[]> {
		return listJson(this.memoriesDir);
	}

	putSkill(skill: SkillDefinition): Promise<void> {
		return atomicWrite(join(this.skillsDir, `${safeId(skill.id)}.json`), skill);
	}

	listSkills(): Promise<SkillDefinition[]> {
		return listJson(this.skillsDir);
	}

	putTask(task: AgentTask): Promise<void> {
		return atomicWrite(join(this.tasksDir, `${safeId(task.id)}.json`), task);
	}

	getTask(id: string): Promise<AgentTask | undefined> {
		return readJson(join(this.tasksDir, `${safeId(id)}.json`));
	}

	async listTasks(graphId?: string): Promise<AgentTask[]> {
		const tasks = await listJson<AgentTask>(this.tasksDir);
		return tasks
			.filter((task) => !graphId || task.graphId === graphId)
			.sort(
				(a, b) =>
					b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
			);
	}
	putMessage(message: SessionMessage): Promise<void> {
		return atomicWrite(
			join(this.messagesDir, `${safeId(message.id)}.json`),
			message,
		);
	}

	getMessage(id: string): Promise<SessionMessage | undefined> {
		return readJson(join(this.messagesDir, `${safeId(id)}.json`));
	}

	async listMessages(sessionId?: string): Promise<SessionMessage[]> {
		const messages = await listJson<SessionMessage>(this.messagesDir);
		return messages
			.filter((message) => !sessionId || message.sessionId === sessionId)
			.sort(
				(a, b) =>
					b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
			);
	}

	putCheckpoint(checkpoint: CheckpointRecord): Promise<void> {
		return atomicWrite(
			join(this.checkpointsDir, `${safeId(checkpoint.id)}.json`),
			checkpoint,
		);
	}

	getCheckpoint(id: string): Promise<CheckpointRecord | undefined> {
		return readJson(join(this.checkpointsDir, `${safeId(id)}.json`));
	}

	async listCheckpoints(sessionId?: string): Promise<CheckpointRecord[]> {
		const checkpoints = await listJson<CheckpointRecord>(this.checkpointsDir);
		return checkpoints
			.filter((checkpoint) => !sessionId || checkpoint.sessionId === sessionId)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	putOrchestration(orchestration: ChristinaOrchestration): Promise<void> {
		return atomicWrite(
			join(this.orchestrationsDir, `${safeId(orchestration.id)}.json`),
			orchestration,
		);
	}

	getOrchestration(id: string): Promise<ChristinaOrchestration | undefined> {
		return readJson(join(this.orchestrationsDir, `${safeId(id)}.json`));
	}

	async listOrchestrations(): Promise<ChristinaOrchestration[]> {
		return (await listJson<ChristinaOrchestration>(this.orchestrationsDir)).sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt),
		);
	}


	putBookLibrary(library: BookLibraryRecord): Promise<void> {
		return atomicWrite(join(this.bookLibrariesDir, `${safeId(library.id)}.json`), library);
	}

	getBookLibrary(id: string): Promise<BookLibraryRecord | undefined> {
		return readJson(join(this.bookLibrariesDir, `${safeId(id)}.json`));
	}

	async listBookLibraries(): Promise<BookLibraryRecord[]> {
		return (await listJson<BookLibraryRecord>(this.bookLibrariesDir)).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}

	deleteBookLibrary(id: string): Promise<void> {
		return rm(join(this.bookLibrariesDir, `${safeId(id)}.json`), { force: true });
	}

	putBookDocument(document: BookDocumentRecord): Promise<void> {
		return atomicWrite(join(this.bookDocumentsDir, `${safeId(document.id)}.json`), document);
	}

	getBookDocument(id: string): Promise<BookDocumentRecord | undefined> {
		return readJson(join(this.bookDocumentsDir, `${safeId(id)}.json`));
	}

	async listBookDocuments(libraryId?: string): Promise<BookDocumentRecord[]> {
		const documents = await listJson<BookDocumentRecord>(this.bookDocumentsDir);
		return documents
			.filter((document) => !libraryId || document.libraryId === libraryId)
			.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}

	deleteBookDocument(id: string): Promise<void> {
		return rm(join(this.bookDocumentsDir, `${safeId(id)}.json`), { force: true });
	}

	putBookChunk(chunk: BookChunkRecord): Promise<void> {
		return atomicWrite(join(this.bookChunksDir, `${safeId(chunk.id)}.json`), chunk);
	}

	async listBookChunks(libraryId?: string, documentId?: string): Promise<BookChunkRecord[]> {
		const chunks = await listJson<BookChunkRecord>(this.bookChunksDir);
		return chunks
			.filter((chunk) => (!libraryId || chunk.libraryId === libraryId) && (!documentId || chunk.documentId === documentId))
			.sort((a, b) => a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal);
	}

	async deleteBookChunksForDocument(documentId: string): Promise<void> {
		const chunks = await this.listBookChunks(undefined, documentId);
		await Promise.all(chunks.map((chunk) => rm(join(this.bookChunksDir, `${safeId(chunk.id)}.json`), { force: true })));
	}

	putLibraryAssignment(assignment: LibraryAgentAssignment): Promise<void> {
		return atomicWrite(join(this.libraryAssignmentsDir, `${safeId(assignment.id)}.json`), assignment);
	}

	async listLibraryAssignments(agentId?: string, libraryId?: string): Promise<LibraryAgentAssignment[]> {
		const assignments = await listJson<LibraryAgentAssignment>(this.libraryAssignmentsDir);
		return assignments
			.filter((assignment) => (!agentId || assignment.agentId === agentId) && (!libraryId || assignment.libraryId === libraryId))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	deleteLibraryAssignment(id: string): Promise<void> {
		return rm(join(this.libraryAssignmentsDir, `${safeId(id)}.json`), { force: true });
	}

	putKnowledgeAgent(profile: KnowledgeAgentProfile): Promise<void> {
		return atomicWrite(join(this.knowledgeAgentsDir, `${safeId(profile.id)}.json`), profile);
	}

	getKnowledgeAgent(id: string): Promise<KnowledgeAgentProfile | undefined> {
		return readJson(join(this.knowledgeAgentsDir, `${safeId(id)}.json`));
	}

	async listKnowledgeAgents(): Promise<KnowledgeAgentProfile[]> {
		return (await listJson<KnowledgeAgentProfile>(this.knowledgeAgentsDir)).sort((a, b) => a.name.localeCompare(b.name));
	}

}
