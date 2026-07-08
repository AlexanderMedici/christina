# CHRISTINA 0.8 Validation

## Completed

### Syntax

TypeScript transpilation diagnostics passed for:

- `book-libraries.ts`
- `book-libraries.test.ts`
- `kernel.ts`
- `store.ts`
- `types.ts`
- Agent-kernel tRPC router
- Book CLI

### Live indexing test

A temporary local library containing two books was created and scanned.

Verified:

- Two documents indexed.
- Search chunks created.
- Relevant closure passage retrieved.
- Citation generated.
- Unauthorized agent denied.

### Kernel end-to-end test

A fake local runtime was placed behind the real AgentKernel.

Verified:

- Private library was assigned to one tutor profile.
- Relevant book context was added to the prepared run.
- The tutor completed its answer with a `[BOOK 1]` citation.
- An unassigned agent could not start a run with the library.
- The access failure occurred before model execution.

### External-drive behavior

Verified by test design and service execution:

- An existing index remains stored when the source path disappears.
- The library is marked unavailable.
- Reconnection can be followed by a normal rescan.

## Not completed in this environment

- Real PDF extraction through installed `pdf-parse` dependency.
- Real EPUB extraction through installed `epub` dependency.
- Real inference through a user's Ollama or LM Studio server.
- Full Electron renderer build.
- Windows external-drive test on an actual drive letter.
- macOS external-volume test on an actual `/Volumes/...` mount.

These require `bun install` and execution on the target Windows or macOS machine.

## Known limitations

- Retrieval is lexical rather than embedding-based.
- Image-only PDFs require a future OCR adapter.
- DRM-protected books may fail extraction.
- A graphical library-management screen is not included yet; the CLI and desktop API are complete.
