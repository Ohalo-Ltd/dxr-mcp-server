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

## MCP Tools

| Tool | Purpose |
|------|---------|
| `list_file_metadata` | Search files with KQL queries |
| `get_file_content` | Retrieve original file content |
| `get_file_redacted_text` | Get redacted version of file |
| `get_classifications` | List available classifications |
| `get_redactors` | List available redactors |

## KQL Query Validation

The server includes KQL query validation to help users write correct queries. Valid fields:
- `id`, `fileName`, `filePath`, `size`, `createdAt`, `updatedAt`
- `mimeType`, `datasourceId`, `classifications.type`, `classifications.name`
