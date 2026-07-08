# CHRISTINA 0.8 — Private Book Libraries

## Purpose

CHRISTINA can now index books from a local file, local folder, external drive, mounted network path, or macOS volume and assign that library to one specific local-model agent.

The assigned agent can answer questions, teach, create quizzes, and build study guides from the indexed material. Other agents receive no book passages unless the user explicitly grants them access.

This is retrieval-augmented generation (RAG), not model fine-tuning. The model weights are not changed. CHRISTINA extracts text, breaks it into passages, retrieves the passages relevant to a question, and gives only those passages to the authorized agent.

## Privacy model

Access is enforced by the host kernel.

```text
Book path
   ↓
Private extracted-text index
   ↓
Library access-control list
   ↓
Authorized agent retrieval
   ↓
Selected local model
```

Each library assignment contains:

- Library ID
- Agent ID
- Access level: `read` or `teach`
- Creator
- Creation time
- Optional note

Before a passage is returned, `BookLibraryService` verifies the calling agent's assignment. Merely knowing a library ID is not sufficient.

Knowledge-agent profiles default to `localOnly: true`. CHRISTINA refuses to create or run a local-only book tutor through Claude, OpenAI, or another cloud runtime. The runtime must be a registered local provider such as Ollama or LM Studio.

The local desktop user remains the administrator and can grant, revoke, or delete access.

## Supported paths

Examples:

```text
Windows internal drive:
C:\Users\Hello\Documents\Books

Windows external drive:
E:\Books\MERN

macOS home folder:
/Users/name/Books

macOS external volume:
/Volumes/BookDrive/MERN

Mounted network share:
Z:\Company Library
/Volumes/Shared/Company Library
```

Paths containing spaces and Unicode characters are supported. Always quote paths in a terminal.

When an external drive is disconnected, the source is marked `unavailable`. CHRISTINA preserves the most recent private index instead of deleting it. Reconnect the drive and run `books:scan` to refresh.

## Supported formats

- PDF
- EPUB
- TXT
- Markdown
- HTML
- JSON
- CSV

PDF extraction uses `pdf-parse`. EPUB extraction uses `epub`. Plain-text formats use the Node filesystem APIs.

### Current extraction limitations

- Image-only scanned PDFs require OCR, which is not included in 0.8.
- DRM-protected or encrypted books may not be readable.
- EPUB extraction currently expects UTF-8 text.
- Charts, images, and complex page layout are not yet converted into visual knowledge.
- MOBI and AZW are not included.

## Storage

Original book files remain at their source path. CHRISTINA stores its private index under:

```text
<CHRISTINA_HOME>/agent-kernel/book-libraries/
├── libraries
├── documents
├── chunks
├── assignments
└── agents
```

The index contains extracted text passages and therefore should be protected like the books themselves. Deleting a library through CHRISTINA deletes the extracted index and assignments but never deletes the original books.

## Indexing behavior

A scan:

1. Resolves the configured source path.
2. Enumerates allowed files.
3. Rejects unsupported and oversized files.
4. Calculates a SHA-256 checksum.
5. Skips unchanged documents.
6. Extracts readable text.
7. Creates overlapping paragraph-aware chunks.
8. Stores searchable terms and citations.
9. Removes index records for files removed from the source.
10. Preserves the index if the entire external source is unavailable.

Default maximum file size: 100 MB. It can be changed per library.

## Retrieval

Version 0.8 uses local lexical ranking with:

- Normalized search terms
- Basic plural normalization
- Term frequency
- Inverse document frequency
- Exact-phrase boosting
- Title boosting
- Token and result limits

Retrieved passages are labelled:

```text
[BOOK 1] Author, Title [Library; chunk 4]
```

The tutor is instructed to cite book-specific claims with these markers and to say when the selected passages are insufficient.

Semantic embedding search is a planned extension, not part of this release.

## Command-line usage

Install dependencies first:

```bash
bun install
```

### 1. Add and scan a library

Windows PowerShell:

```powershell
bun run books:add -- --name "MERN Books" --path "E:\Books\MERN"
```

A path previously used with Hermes also works when quoted:

```powershell
bun run books:add -- --name "Master Books" --path "C:\Users\Hello\Desktop\⠀\MASTER BOOKS"
```

macOS:

```bash
bun run books:add -- --name "MERN Books" --path "/Volumes/Books/MERN"
```

The result includes the `library.id` needed in later commands.

### 2. View libraries

```bash
bun run books:list
```

### 3. Refresh a library

```bash
bun run books:scan -- --library LIBRARY_ID
```

### 4. Create a private local tutor

With Ollama:

```bash
bun run books:agent -- \
  --name "MERN Tutor" \
  --library LIBRARY_ID \
  --provider ollama \
  --model qwen2.5:7b
```

With LM Studio:

```bash
bun run books:agent -- \
  --name "MERN Tutor" \
  --library LIBRARY_ID \
  --provider lmstudio \
  --model YOUR_LOADED_MODEL_ID
```

When provider and model are omitted, CHRISTINA selects a suitable available local model.

The result includes the knowledge-agent profile ID.

### 5. Ask questions

```bash
bun run books:ask -- \
  --agent PROFILE_ID \
  --question "According to these books, what is a JavaScript closure?"
```

### 6. Teaching modes

```bash
bun run books:ask -- --agent PROFILE_ID --mode teach --question "Teach me closures"
bun run books:ask -- --agent PROFILE_ID --mode quiz --question "Quiz me on arrays and hash maps"
bun run books:ask -- --agent PROFILE_ID --mode study-guide --question "Build a study guide for Node.js interviews"
```

Available modes:

- `answer`
- `teach`
- `quiz`
- `study-guide`

Available teaching styles when creating an agent:

- `socratic`
- `direct`
- `step-by-step`
- `exam-prep`

### 7. Grant an existing agent access

```bash
bun run scripts/christina-books.ts assign \
  --library LIBRARY_ID \
  --agent RESEARCHER \
  --access read
```

No other specialist receives access automatically.

### 8. Revoke access

```bash
bun run scripts/christina-books.ts revoke \
  --library LIBRARY_ID \
  --agent RESEARCHER
```

### 9. Delete the private index

```bash
bun run books:remove -- --library LIBRARY_ID
```

This deletes the extracted index, assignments, and references from tutor profiles. It does not modify the original files.

## Desktop API

The agent-kernel tRPC router now exposes:

```text
bookLibraries
createBookLibrary
deleteBookLibrary
scanBookLibrary
bookDocuments
bookAssignments
assignBookLibrary
revokeBookLibrary
searchPrivateBooks
knowledgeAgents
createKnowledgeAgent
askKnowledgeAgent
```

A normal kernel run can also receive:

```typescript
{
  bookLibraryIds: ["..."],
  bookQuery: "...",
  bookMaxChunks: 10,
  bookMaxContextTokens: 10000
}
```

The run fails before model execution when the agent does not have access.

## Recommended workflow

For your MERN study system:

1. Create one `MERN Books` library.
2. Point it to your existing `MASTER BOOKS` path or a dedicated MERN subfolder.
3. Create a local `MERN Tutor` using Ollama or LM Studio.
4. Assign only that tutor to the library.
5. Use `teach` mode for concepts.
6. Use `quiz` mode for recall.
7. Use `study-guide` mode for weekly reviews.
8. Rescan whenever books are added or changed.

## Security notes

- Keep `trustedLocalhostOnly` enabled for local-model endpoints.
- Do not expose Ollama or LM Studio publicly without authentication and transport security.
- Treat the extracted index as copyrighted/private content.
- Do not commit the `agent-kernel/book-libraries` directory to Git.
- Use operating-system disk encryption for sensitive libraries.
- Revoke an assignment when an agent no longer needs access.
