# Claude Code Guidelines for dxr-mcp-server

This file provides context and guidelines for Claude Code when working on this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for the Data X-Ray API. It enables AI models to search, retrieve, and analyze indexed files with sensitivity classifications and redaction capabilities.

## Architecture

- **Entry point**: `src/index.ts` - MCP server implementation with tool handlers
- **Types**: `src/types.ts` - TypeScript interfaces for DXR API responses
- **Tests**: `src/index.test.ts` - Vitest unit tests
- **Config**: `vitest.config.ts`, `tsconfig.json`

## Code Standards

### TypeScript
- Use strict mode (enabled in tsconfig.json)
- Avoid `any` types - use proper typing from `types.ts`
- Use `encodeURIComponent()` for all user-provided URL parameters

### Security Requirements
- All API requests must use the security helpers in `makeApiRequest()`:
  - Request timeout (30s via AbortController)
  - Response size limits (50MB max)
  - SSRF prevention (host validation)
  - Error sanitization (truncate to 500 chars)
- Never log or expose `DXR_API_TOKEN`
- Validate all user inputs with `validateString()` / `validateNumber()`

### Testing
- Run `npm test` before committing
- Maintain test coverage for all tool handlers
- Mock fetch calls - don't make real API requests in tests

## Scratch Files

Place temporary files, notes, and helper scripts in the `.claude/` directory. This folder is gitignored and will not be committed.

Use `.claude/` for:
- Code review notes
- Troubleshooting documentation
- Test scripts and experiments
- Investigation notes

## Commands

```bash
npm run build          # Compile TypeScript
npm test               # Run tests
npm run test:coverage  # Run tests with coverage
npm run dev            # Build and run server
```

## Environment Variables

Required:
- `DXR_API_URL` - Data X-Ray API base URL
- `DXR_API_TOKEN` - Authentication token

## Environment Variables

Required:
- `DXR_API_URL` - Data X-Ray API base URL
- `DXR_API_TOKEN` - Authentication token

Optional:
- `DXR_SKIP_SSL_VERIFY` - Set to `true` to skip SSL certificate verification (dev only, for self-signed certs)

## MCP Tools

| Tool | Purpose |
|------|---------|
| `list_file_metadata` | Search files with KQL queries; returns summaries + aggregate stats |
| `get_file_metadata_details` | Full metadata for a specific file by ID |
| `get_file_content` | Retrieve original file (text decoded, images viewable, PDFs text-extracted) |
| `get_file_text` | DXR's pre-extracted plain text for a file (beta, simpler than get_file_content) |
| `get_file_redacted_text` | Redacted plain text with `[REDACTED]` markers |
| `get_classifications` | Catalog of annotators, labels, and extractors |
| `get_redactors` | List redaction profiles (needed for get_file_redacted_text) |
| `render_pdf_pages` | Render PDF pages as images (requires @napi-rs/canvas) |

## KQL Query Validation

The server validates KQL queries before sending to the API. Valid queryable fields:

**Core:** `id`, `fileId`, `fileName`, `path`, `filePath`, `size`, `mimeType`, `contentSha256`, `scanDepth`, `createdAt`, `lastModifiedAt`, `updatedAt`

**Datasource:** `datasource.id`, `datasource.name`, `datasource.connector.type`, `datasourceId`, `datasourceName`

**Labels/DLP:** `labels.id`, `labels.name`, `dlpLabels.id`, `dlpLabels.name`, `dlpLabels.dlpSystem`, `dlpLabels.type`

**Annotators:** `annotators.id`, `annotators.name`, `annotators.domain.id`, `annotators.domain.name`, `annotators.uniquePhrases`, `annotators.annotations.phrase`

**Entitlements:** `entitlements.whoCanAccess`, `entitlements.whoCanAccess.accountType`, `entitlements.whoCanAccess.name`, `entitlements.whoCanAccess.email`

**Ownership:** `owner.name`, `owner.email`, `owner.accountType`, `createdBy.name`, `createdBy.email`, `modifiedBy.name`, `modifiedBy.email`

**Extracted metadata:** `extractedMetadata.id`, `extractedMetadata.name`, `extractedMetadata.value`, `extractedMetadata.type`, `metadataExtractionStatus`

**Coordinates:** `coordinates.lat`, `coordinates.lon`, `coordinates.alt`

**Deprecated:** `category` (Document Categorizer, removed in 8.4)
