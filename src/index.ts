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

// KQL query validation helper
function validateKQLQuery(query: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Valid field names based on DXR API (including those usable with _exists_)
  const validFields = [
    "id", "fileName", "filePath", "size", "createdAt", "updatedAt",
    "mimeType", "datasourceId", "classifications", "classifications.type", "classifications.name"
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

  // 4. Check for _exists_: patterns
  const existsMatches = query.matchAll(/_exists_:(\w+(?:\.\w+)?)/g);
  for (const match of existsMatches) {
    const fieldName = match[1];

    // Validate field name
    if (!validFields.includes(fieldName)) {
      errors.push(`Unknown field in _exists_: '${fieldName}'. Valid fields: ${validFields.join(", ")}`);
    }
  }

  // 5. Check for regular field names (extract field:value patterns)
  const fieldMatches = query.matchAll(/(\w+(?:\.\w+)?)\s*([:<>]=?)/g);
  for (const match of fieldMatches) {
    const fieldName = match[1];
    const operator = match[2];

    // Skip if this is NOT or AND or OR or _exists_
    if (["NOT", "AND", "OR", "_exists_"].includes(fieldName)) {
      continue;
    }

    // Validate field name
    if (!validFields.includes(fieldName)) {
      errors.push(`Unknown field: '${fieldName}'. Valid fields: ${validFields.join(", ")}`);
    }

    // Validate operator usage
    const numericFields = ["size"];
    const dateFields = ["createdAt", "updatedAt"];

    if (["<", ">", "<=", ">="].includes(operator)) {
      if (!numericFields.includes(fieldName) && !dateFields.includes(fieldName)) {
        errors.push(`Comparison operators (<, >, <=, >=) should only be used with numeric fields (size) or date fields (createdAt, updatedAt), not '${fieldName}'`);
      }
    }
  }

  // 6. Check for logical operators (case-insensitive)
  const hasInvalidLogical = query.match(/\b(and|or|not)\b/);
  if (hasInvalidLogical) {
    errors.push("Logical operators must be uppercase: AND, OR, NOT");
  }

  // 7. Warn if query is too broad
  const isTooBoard =
    query.trim() === "*" ||
    query.trim() === "_exists_:id" ||
    query.trim() === "_exists_:fileName" ||
    (query.length < 5 && !query.includes(":"));

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
    description: `Search and list files indexed in Data X-Ray. Use this tool when the user asks about files, documents, or wants to find specific content.

WHEN TO USE:
- User asks "what files do you have?" or "find documents about X"
- User wants to search for files by name, type, size, or date
- User asks about sensitive documents or classified files
- Starting point for any file-related workflow

TYPICAL WORKFLOW:
1. First call list_file_metadata to find files matching criteria
2. Then use get_file_content or get_file_redacted_text to view specific files

KQL QUERY SYNTAX:
- By name: fileName:"Invoice*" (wildcards supported)
- By type: mimeType:"application/pdf"
- By size: size > 1000000 (bytes)
- By date: createdAt >= "2024-01-01"
- Sensitive files: _exists_:classifications
- Combined: fileName:"*report*" AND mimeType:"application/pdf" AND _exists_:classifications

FIELDS: id, fileName, filePath, size, createdAt, updatedAt, mimeType, datasourceId, classifications.type, classifications.name

Returns: List of file metadata with IDs you can use with other tools.`,
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "KQL query to filter files. Examples: 'fileName:\"report*\"', 'mimeType:\"application/pdf\"', 'size > 1000000', '_exists_:classifications'",
        },
      },
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
        const query = queryParam ? `?q=${encodeURIComponent(queryParam as string)}` : "";
        const result = await makeApiRequest<FileMetadataListResponse>(
          `/api/v1/files${query}`
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
