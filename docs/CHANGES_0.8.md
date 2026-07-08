# CHRISTINA 0.8 Changes

## Private libraries

- Added file- and directory-backed book libraries.
- Added support for internal drives, external drives, mounted volumes, and network paths.
- Added PDF, EPUB, text, Markdown, HTML, JSON, and CSV extraction.
- Added incremental checksum-based indexing.
- Added paragraph-aware overlapping chunks.
- Added local lexical retrieval and book citations.
- Added unavailable-drive preservation behavior.
- Added deletion of extracted indexes without touching original books.

## Isolation

- Added per-agent library access-control assignments.
- Added `read` and `teach` access levels.
- Added host-side authorization before retrieval.
- Added direct-run private library fields.
- Added local-only knowledge-agent profiles.
- Added protection against accidental cloud runtime use for private tutors.
- Added explicit grant and revoke operations.

## Learning agents

- Added durable knowledge-agent profiles.
- Added answer, teach, quiz, and study-guide modes.
- Added direct, Socratic, step-by-step, and exam-prep teaching styles.
- Added citation requirements and insufficient-context disclosure.

## API and CLI

- Added book-library and knowledge-agent tRPC procedures.
- Added `books:add`, `books:list`, `books:scan`, `books:remove`, `books:agent`, and `books:ask` scripts.
- Added lower-level assign, revoke, and search CLI commands.

## Dependencies

- Added `pdf-parse` 2.4.5.
- Added `epub` 2.1.1.
