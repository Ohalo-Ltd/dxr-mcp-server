#!/usr/bin/env node

/**
 * Data X-Ray MCP Server
 *
 * This MCP server provides tools to interact with the Data X-Ray API,
 * enabling Claude to search, retrieve, and analyze indexed files with
 * sensitivity classifications and redaction capabilities.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  FileMetadataListResponse,
  FileContentResponse,
  RedactionResponse,
  ClassificationCatalog,
  RedactorCatalog,
  FileMetadataSummaryResponse,
  FileSummary,
  FileListStats,
  FullFileMetadata,
  FullFileMetadataResponse,
} from "./types.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);
const VERSION = packageJson.version;

// Configuration from environment variables
const DXR_API_URL = process.env.DXR_API_URL;
const DXR_API_TOKEN = process.env.DXR_API_TOKEN;

if (!DXR_API_URL || !DXR_API_TOKEN) {
  console.error("Error: DXR_API_URL and DXR_API_TOKEN environment variables are required");
  process.exit(1);
}

// Security constants
const REQUEST_TIMEOUT_MS = 30_000; // 30 second timeout
const MAX_RESPONSE_SIZE_BYTES = 50_000_000; // 50MB max response size
const MAX_ERROR_LENGTH = 500; // Truncate error messages to prevent info leakage

// Pagination constants
const DEFAULT_LIMIT = 50; // Default number of files to return
const MAX_LIMIT = 500; // Maximum files per request
const DEFAULT_OFFSET = 0; // Default starting position

// Parse and validate the configured API URL at startup
const ALLOWED_API_HOST = new URL(DXR_API_URL).host;

// Response type enum for better type safety
enum ResponseType {
  JSONL = "JSONL",
  BINARY = "BINARY",
  JSON = "JSON",
}

// Determine response type based on endpoint
function getResponseType(endpoint: string): ResponseType {
  if (endpoint.match(/^\/api\/v1\/files\/[^/]+\/content$/)) {
    return ResponseType.BINARY;
  }
  if (endpoint.match(/^\/api\/v1\/files(\?.*)?$/)) {
    return ResponseType.JSONL;
  }
  return ResponseType.JSON;
}

// Helper function to make authenticated API requests with proper typing
async function makeApiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DXR_API_URL}${endpoint}`;

  // SSRF prevention: validate the constructed URL points to the allowed host
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== ALLOWED_API_HOST) {
    throw new Error("Invalid API endpoint: request blocked for security");
  }

  // Set up request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${DXR_API_TOKEN}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Sanitize error response to prevent leaking sensitive info
      const sanitizedError = errorText.substring(0, MAX_ERROR_LENGTH);
      // Log full error to stderr for debugging (not returned to client)
      console.error(`API error [${response.status}]:`, errorText.substring(0, 1000));
      throw new Error(`API request failed: ${response.status} ${response.statusText}: ${sanitizedError}`);
    }

    // Check Content-Length header if available for early rejection
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE_BYTES) {
      throw new Error("Response too large: exceeds maximum allowed size");
    }

    const responseType = getResponseType(endpoint);

    switch (responseType) {
      case ResponseType.JSONL: {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        const lines = text.trim().split("\n").filter(line => line.trim());
        const data = lines.map(line => JSON.parse(line));
        return { status: "ok", data } as T;
      }

      case ResponseType.BINARY: {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        const contentType = response.headers.get("Content-Type") || "application/octet-stream";
        const contentDisposition = response.headers.get("Content-Disposition") || "";
        return {
          content: Buffer.from(buffer).toString("base64"),
          contentType,
          contentDisposition,
        } as T;
      }

      case ResponseType.JSON:
      default: {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE_BYTES) {
          throw new Error("Response too large: exceeds maximum allowed size");
        }
        return JSON.parse(text) as T;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// Validation helpers
function validateString(value: unknown, paramName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${paramName}: must be a non-empty string`);
  }
  return value;
}

function validateNumber(value: unknown, paramName: string): number {
  if (typeof value !== "number" || isNaN(value)) {
    throw new Error(`Invalid ${paramName}: must be a valid number`);
  }
  return value;
}

// Helper to convert full file metadata to lightweight summary
function convertToFileSummary(file: FullFileMetadata): FileSummary {
  const hasSensitiveData = (file.annotators?.length ?? 0) > 0;
  const sensitiveDataCount = file.annotators?.length ?? 0;
  const hasLabels = (file.labels?.length ?? 0) > 0 || (file.dlpLabels?.length ?? 0) > 0;

  return {
    fileId: file.fileId,
    fileName: file.fileName,
    path: file.path,
    size: file.size,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
    lastModifiedAt: file.lastModifiedAt,
    hasSensitiveData,
    sensitiveDataCount,
    hasLabels,
    datasourceName: file.datasource?.name,
  };
}

// Helper to generate aggregate stats from file list
function generateFileListStats(files: FullFileMetadata[]): FileListStats {
  const mimeTypes: Record<string, number> = {};
  let filesWithSensitiveData = 0;
  let filesWithLabels = 0;
  let totalSize = 0;
  let earliest: string | undefined;
  let latest: string | undefined;

  for (const file of files) {
    // Count mime types
    if (file.mimeType) {
      mimeTypes[file.mimeType] = (mimeTypes[file.mimeType] || 0) + 1;
    }

    // Count sensitive files
    if ((file.annotators?.length ?? 0) > 0) {
      filesWithSensitiveData++;
    }

    // Count labeled files
    if ((file.labels?.length ?? 0) > 0 || (file.dlpLabels?.length ?? 0) > 0) {
      filesWithLabels++;
    }

    // Sum total size
    totalSize += file.size;

    // Track date range
    if (!earliest || file.createdAt < earliest) {
      earliest = file.createdAt;
    }
    if (!latest || file.createdAt > latest) {
      latest = file.createdAt;
    }
  }

  return {
    totalFiles: files.length,
    totalSize,
    filesWithSensitiveData,
    filesWithLabels,
    mimeTypes,
    dateRange: earliest && latest ? { earliest, latest } : undefined,
  };
}

// Helper to create paginated summary response
function createSummaryResponse(
  allFiles: FullFileMetadata[],
  offset: number,
  limit: number
): FileMetadataSummaryResponse {
  // Generate stats from ALL files (not just the page)
  const stats = generateFileListStats(allFiles);

  // Apply pagination
  const paginatedFiles = allFiles.slice(offset, offset + limit);
  const files = paginatedFiles.map(convertToFileSummary);

  return {
    status: "ok",
    stats: {
      ...stats,
      totalFiles: allFiles.length, // Total count across all pages
    },
    files,
    pagination: {
      offset,
      limit,
      returnedCount: files.length,
      hasMore: offset + limit < allFiles.length,
    },
  };
}

// KQL query validation helper
function validateKQLQuery(query: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Valid field names based on DXR API (including nested fields)
  const validFields = [
    // Core file fields
    "id", "fileId", "fileName", "path", "filePath", "size", "mimeType",
    "createdAt", "lastModifiedAt", "updatedAt", "contentSha256", "scanDepth",
    // Datasource fields
    "datasourceId", "datasourceName", "datasource.id", "datasource.name",
    // Labels and classifications
    "labels", "labels.id", "labels.name",
    "dlpLabels", "dlpLabels.id", "dlpLabels.name", "dlpLabels.dlpSystem",
    // Annotators (sensitive data detections)
    "annotators", "annotators.id", "annotators.name", "annotators.domain.id", "annotators.domain.name",
    // Entitlements
    "entitlements", "entitlements.whoCanAccess", "entitlements.whoCanAccess.accountType",
    "entitlements.whoCanAccess.name", "entitlements.whoCanAccess.email",
    // Ownership
    "owner", "owner.name", "owner.email",
    "createdBy", "createdBy.name", "createdBy.email",
    "modifiedBy", "modifiedBy.name", "modifiedBy.email",
    // Extracted metadata
    "extractedMetadata", "extractedMetadata.name", "extractedMetadata.value",
    // Classifications (legacy support)
    "classifications", "classifications.type", "classifications.name"
  ];

  // Check for common syntax issues

  // 1. Unmatched quotes
  const quoteCount = (query.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    errors.push("Unmatched quotes in query");
  }

  // 2. Unmatched parentheses
  const openParens = (query.match(/\(/g) || []).length;
  const closeParens = (query.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push("Unmatched parentheses in query");
  }

  // 3. Invalid operators (common mistakes)
  if (query.match(/[^><=!]\s*={1}\s*[^=]/)) {
    errors.push("Use ':' for field matching or '>=' for comparisons, not '='");
  }

  // 4. Check for _exists_: patterns - only validate commonly used fields
  // Note: We don't block unknown fields since the API may support fields we don't know about
  const existsMatches = query.matchAll(/_exists_:(\w+(?:\.\w+)?)/g);
  for (const match of existsMatches) {
    const fieldName = match[1];
    // Just log a warning to stderr, don't error out - the API will give a proper error if invalid
    if (!validFields.includes(fieldName)) {
      console.error(`Note: Using field '${fieldName}' in _exists_: - not in known field list`);
    }
  }

  // 5. Check for comparison operators on appropriate fields
  const comparisonMatches = query.matchAll(/(\w+(?:\.\w+)?)\s*([<>]=?)/g);
  for (const match of comparisonMatches) {
    const fieldName = match[1];
    const operator = match[2];

    // Skip logical operators
    if (["NOT", "AND", "OR", "_exists_"].includes(fieldName)) {
      continue;
    }

    // Validate operator usage - comparison operators should only be used with numeric/date fields
    const numericFields = ["size"];
    const dateFields = ["createdAt", "lastModifiedAt", "updatedAt"];

    if (!numericFields.includes(fieldName) && !dateFields.includes(fieldName)) {
      errors.push(`Comparison operators (${operator}) should only be used with numeric fields (size) or date fields (createdAt, lastModifiedAt), not '${fieldName}'`);
    }
  }

  // 6. Check for logical operators (case-insensitive)
  const hasInvalidLogical = query.match(/\b(and|or|not)\b/);
  if (hasInvalidLogical) {
    errors.push("Logical operators must be uppercase: AND, OR, NOT");
  }

  // 7. Check for unquoted string values with wildcards (common mistake)
  // Pattern: fieldName:*something or fieldName:something* without quotes
  const unquotedWildcardPattern = /(\w+):(\*[^"\s]+|\w+\*)/g;
  const unquotedMatches = query.match(unquotedWildcardPattern);
  if (unquotedMatches) {
    for (const match of unquotedMatches) {
      // Skip if it's _exists_: pattern
      if (!match.startsWith("_exists_:")) {
        const [field, value] = match.split(":");
        errors.push(
          `Unquoted string value detected: '${match}'. ` +
          `String values must be quoted. Use ${field}:"${value}" instead.`
        );
      }
    }
  }

  // 8. Check for unquoted string values without wildcards (another common mistake)
  // Pattern: fieldName:someValue where someValue is not a number, boolean, or date
  const fieldValuePattern = /(\w+(?:\.\w+)?):([^"\s*?]+)(?:\s|$)/g;
  let fieldMatch;
  while ((fieldMatch = fieldValuePattern.exec(query)) !== null) {
    const fieldName = fieldMatch[1];
    const value = fieldMatch[2];

    // Skip special patterns
    if (fieldName === "_exists_") continue;
    if (["AND", "OR", "NOT"].includes(fieldName)) continue;

    // Check if value looks like it should be quoted
    const isNumeric = /^-?\d+(\.\d+)?$/.test(value);
    const isBoolean = /^(true|false)$/i.test(value);
    const isDate = /^\d{4}-\d{2}-\d{2}/.test(value);
    const isRelativeDate = /^now([+-]\d+[smhdwMy])?$/.test(value);

    if (!isNumeric && !isBoolean && !isDate && !isRelativeDate) {
      // This looks like a string value that should be quoted
      const stringFields = ["fileName", "path", "filePath", "mimeType", "datasourceName",
        "labels.name", "annotators.name", "owner.name", "owner.email"];
      if (stringFields.some(f => fieldName.includes(f) || f.includes(fieldName))) {
        errors.push(
          `String value '${value}' for field '${fieldName}' must be quoted. ` +
          `Use ${fieldName}:"${value}" instead of ${fieldName}:${value}`
        );
      }
    }
  }

  // 9. Check for free-text queries without field:value format
  // KQL doesn't support free-text search - all queries must be field:value
  const trimmedQuery = query.trim();
  const hasFieldValuePattern = /\w+\s*[:<>=]/.test(trimmedQuery) || trimmedQuery.includes("_exists_:");
  if (!hasFieldValuePattern && trimmedQuery.length > 0) {
    errors.push(
      `Free-text search is not supported. KQL requires field:value format. ` +
      `To search for "${trimmedQuery}", try: fileName:"*${trimmedQuery.split(/\s+/)[0]}*" or path:"*${trimmedQuery.split(/\s+/)[0]}*"`
    );
  }

  // 10. Warn if query is too broad
  const isTooBoard =
    trimmedQuery === "*" ||
    trimmedQuery === "_exists_:id" ||
    trimmedQuery === "_exists_:fileName" ||
    (trimmedQuery.length < 5 && !trimmedQuery.includes(":"));

  if (isTooBoard) {
    errors.push("Query is too broad and may return millions of files. Add specific filters.");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Define MCP tools with improved descriptions for better discovery and usage
const tools: Tool[] = [
  {
    name: "list_file_metadata",
    description: `Search and list files indexed in Data X-Ray with lightweight summaries to minimize context usage.

WHEN TO USE:
- User asks "what files do you have?" or "find documents about X"
- User wants to search for files by name, type, size, or date
- User asks about sensitive documents or classified files
- Starting point for any file-related workflow

WHAT IT RETURNS:
- Aggregate statistics (total count, size, file types, sensitive data counts)
- Lightweight file summaries with essential fields only (fileId, fileName, path, size, mimeType, dates, sensitivity flags)
- Pagination info to retrieve more results

PAGINATION:
- Default: Returns first 50 files
- Use 'limit' to control page size (max 500)
- Use 'offset' to skip to a specific position
- Check 'pagination.hasMore' to see if more results exist

NEXT STEPS:
- To get full details for specific files, use get_file_metadata_details with fileId
- To view file content, use get_file_content or get_file_redacted_text with fileId

KQL QUERY SYNTAX (CRITICAL - follow exactly):
All string values MUST be enclosed in double quotes. Wildcards go INSIDE the quotes.

CORRECT examples:
  fileName:"*.pdf"                          - Files ending in .pdf
  fileName:"*report*"                       - Files containing "report"
  fileName:"*CV*" OR fileName:"*resume*"    - Files with CV or resume
  mimeType:"application/pdf"                - PDF files only
  path:"*Documents/HR/*"                    - Files in HR folder
  datasourceName:"SharePoint*"              - Files from SharePoint sources
  labels.name:"Confidential"                - Files with specific label

WRONG (will cause parse errors):
  fileName:*.pdf                            - WRONG: missing quotes
  fileName:report                           - WRONG: missing quotes
  fileName:*CV*                             - WRONG: missing quotes

NOT SUPPORTED (KQL does not have free-text search):
  "John Smith"                              - WRONG: no field specified
  CV resume                                 - WRONG: free text without field
  Mariana Greenway                          - WRONG: to search for a name, use fileName:"*Mariana*"

NUMERIC/DATE fields (no quotes needed):
  size > 1000000                            - Files over 1MB
  size >= 500000 AND size <= 2000000        - Files between 500KB and 2MB
  createdAt >= 2024-01-01                   - Files created since Jan 2024
  createdAt > now-7d                        - Files created in last 7 days
  lastModifiedAt < now-30d                  - Files not modified in 30 days

LOGICAL operators (must be UPPERCASE):
  fileName:"*.pdf" AND size > 100000
  fileName:"*report*" OR fileName:"*summary*"
  NOT path:"*temp*"
  (fileName:"*.doc" OR fileName:"*.docx") AND datasourceName:"HR*"

SENSITIVE DATA queries:
  _exists_:annotators                       - Files with any sensitive data detected
  annotators.name:"Credit card"             - Files with credit card numbers
  annotators.domain.name:"PII"              - Files with PII detected

FIELDS: fileName, path, size, mimeType, createdAt, lastModifiedAt, datasourceName, labels.id, labels.name, annotators.name, annotators.domain.name

Returns: Summary response with stats, lightweight file list, and pagination info.`,
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "KQL query to filter files. IMPORTANT: String values MUST be quoted. Examples: 'fileName:\"*report*\"' (correct), 'fileName:*report*' (WRONG - missing quotes)",
        },
        limit: {
          type: "number",
          description: `Number of files to return (default: ${DEFAULT_LIMIT}, max: ${MAX_LIMIT})`,
        },
        offset: {
          type: "number",
          description: `Number of files to skip for pagination (default: ${DEFAULT_OFFSET})`,
        },
      },
    },
  },
  {
    name: "get_file_metadata_details",
    description: `Get complete metadata for a specific file by ID. Returns ALL available metadata including datasource info, entitlements, classifications, annotators with locations, DLP labels, ownership, and more.

WHEN TO USE:
- After calling list_file_metadata to get a summary, use this to fetch full details for specific files
- User asks for detailed information about a file (owner, permissions, exact sensitive data locations, etc.)
- User wants to know who can access a file or who created/modified it
- User needs to see all classification labels and extracted metadata

PREREQUISITE: You need a fileId from list_file_metadata results.

WHAT IT RETURNS:
- Complete file metadata (datasource, path, size, hashes, scan depth)
- All labels and DLP labels
- Full entitlements (who can access with account details)
- Annotators with sensitive data locations and phrases
- Owner, creator, and modifier information
- Extracted metadata fields
- Geolocation data if available

WARNING: This returns extensive data (2-3KB per file). Only fetch details for files you need to inspect closely.

Returns: Full file metadata object with all available fields.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID (fileId field from list_file_metadata results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_file_content",
    description: `Retrieve the original content of a specific file by ID. Use this when the user wants to see, read, or analyze a file's actual content.

WHEN TO USE:
- User says "show me that file" or "what's in this document?"
- User wants to read or analyze file contents
- After finding files with list_file_metadata

PREREQUISITE: You need a file ID from list_file_metadata first.

Returns: Base64-encoded file content with MIME type. For text files, decode to read. For PDFs/images, describe the content type.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID from list_file_metadata results",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_file_redacted_text",
    description: `Get a privacy-safe version of a file with sensitive information replaced by [REDACTED]. Use this when handling documents that may contain PII, PHI, SSNs, credit cards, or other sensitive data.

WHEN TO USE:
- User wants to see a document but it might contain sensitive info
- User asks about a file that has classifications (sensitive data detected)
- User explicitly asks for a redacted or sanitized version
- When you need to share file content but protect privacy

PREREQUISITE:
1. Get file ID from list_file_metadata
2. Get redactor_id from get_redactors (call it first if you don't have one)

Returns: Text content with sensitive data replaced by [REDACTED] markers.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "File ID from list_file_metadata",
        },
        redactor_id: {
          type: "number",
          description: "Redactor ID from get_redactors (typically 1 for default redactor)",
        },
      },
      required: ["id", "redactor_id"],
    },
  },
  {
    name: "get_classifications",
    description: `List all sensitivity classifications that Data X-Ray can detect. Use this to understand what types of sensitive data the system identifies.

WHEN TO USE:
- User asks "what sensitive data can you detect?"
- User wants to know what classifications/labels are available
- User asks about PII, PHI, or data privacy detection capabilities
- When explaining what makes a file "sensitive"

Returns: List of annotators (SSN, credit card, email, etc.), labels, and extractors with descriptions.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_redactors",
    description: `List available redaction profiles. Redactors define which sensitive data types to mask when viewing files safely.

WHEN TO USE:
- Before calling get_file_redacted_text (to get a redactor_id)
- User asks "how can you redact files?" or about redaction options
- User wants to know what privacy protection is available

Returns: List of redactors with IDs and names. Use the ID with get_file_redacted_text.`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Create the MCP server
const server = new Server(
  {
    name: "dxr-mcp-server",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_file_metadata": {
        // Validate query parameter if provided
        const queryParam = args?.q;
        if (queryParam !== undefined) {
          validateString(queryParam, "q");

          // Validate KQL syntax
          const kqlValidation = validateKQLQuery(queryParam as string);
          if (!kqlValidation.valid) {
            throw new Error(
              `Invalid KQL query:\n${kqlValidation.errors.map(e => `  - ${e}`).join("\n")}\n\n` +
              `Please refer to the tool description for KQL syntax examples.`
            );
          }
        } else {
          // Warn if no query provided (could return millions of files)
          console.error("WARNING: list_file_metadata called without a KQL query. This may return a large number of files in enterprise deployments.");
        }

        // Parse and validate pagination parameters
        const limit = args?.limit !== undefined ? validateNumber(args.limit, "limit") : DEFAULT_LIMIT;
        const offset = args?.offset !== undefined ? validateNumber(args.offset, "offset") : DEFAULT_OFFSET;

        if (limit < 1 || limit > MAX_LIMIT) {
          throw new Error(`Invalid limit: must be between 1 and ${MAX_LIMIT}`);
        }
        if (offset < 0) {
          throw new Error("Invalid offset: must be non-negative");
        }

        // Fetch JSONL data from API
        const query = queryParam ? `?q=${encodeURIComponent(queryParam as string)}` : "";
        const result = await makeApiRequest<FileMetadataListResponse>(
          `/api/v1/files${query}`
        );

        // Convert to summary response with pagination
        const summaryResponse = createSummaryResponse(
          result.data as unknown as FullFileMetadata[],
          offset,
          limit
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(summaryResponse, null, 2),
            },
          ],
        };
      }

      case "get_file_metadata_details": {
        if (!args?.id) {
          throw new Error("Missing required parameter: id");
        }
        const fileId = validateString(args.id, "id");

        // Fetch full metadata from API - use the files endpoint with specific ID query
        const result = await makeApiRequest<FileMetadataListResponse>(
          `/api/v1/files?q=fileId:"${encodeURIComponent(fileId)}"`
        );

        if (!result.data || result.data.length === 0) {
          throw new Error(`File not found with ID: ${fileId}`);
        }

        // Return the first (and should be only) result
        const fileMetadata = result.data[0] as unknown as FullFileMetadata;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ok",
                data: fileMetadata,
              } as FullFileMetadataResponse, null, 2),
            },
          ],
        };
      }

      case "get_file_content": {
        if (!args?.id) {
          throw new Error("Missing required parameter: id");
        }
        const fileId = validateString(args.id, "id");
        const result = await makeApiRequest<FileContentResponse>(
          `/api/v1/files/${encodeURIComponent(fileId)}/content`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "File content retrieved successfully",
                contentType: result.contentType,
                contentDisposition: result.contentDisposition,
                contentBase64: result.content,
              }, null, 2),
            },
          ],
        };
      }

      case "get_file_redacted_text": {
        if (!args?.id || args?.redactor_id === undefined) {
          throw new Error("Missing required parameters: id and redactor_id");
        }
        const fileId = validateString(args.id, "id");
        const redactorId = validateNumber(args.redactor_id, "redactor_id");
        const result = await makeApiRequest<RedactionResponse>(
          `/api/v1/files/${encodeURIComponent(fileId)}/redacted-text?redactor_id=${redactorId}`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_classifications": {
        const result = await makeApiRequest<ClassificationCatalog>(
          "/api/v1/classifications"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_redactors": {
        const result = await makeApiRequest<RedactorCatalog>(
          "/api/v1/redactors"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: errorMessage,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP communication
  console.error(`Data X-Ray MCP Server v${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
