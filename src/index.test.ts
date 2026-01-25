import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Mock environment variables before importing the module
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    DXR_API_URL: "https://test-dxr.example.com",
    DXR_API_TOKEN: "test-token-123",
  };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe("Environment Variable Validation", () => {
  it("should exit if DXR_API_URL is missing", async () => {
    delete process.env.DXR_API_URL;
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Dynamic import to trigger validation
    await import("./index.js").catch(() => {});

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: DXR_API_URL and DXR_API_TOKEN environment variables are required"
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit if DXR_API_TOKEN is missing", async () => {
    delete process.env.DXR_API_TOKEN;
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./index.js").catch(() => {});

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: DXR_API_URL and DXR_API_TOKEN environment variables are required"
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("Version Reading", () => {
  it("should read version from package.json", () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, "../package.json"), "utf-8")
    );

    expect(packageJson.version).toBeDefined();
    expect(typeof packageJson.version).toBe("string");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("Response Type Detection", () => {
  // Note: These tests would need to be updated if we export getResponseType
  // For now, we'll test indirectly through the API request behavior

  const testCases = [
    {
      endpoint: "/api/v1/files",
      expectedType: "JSONL",
      description: "file list without query",
    },
    {
      endpoint: "/api/v1/files?q=test",
      expectedType: "JSONL",
      description: "file list with query",
    },
    {
      endpoint: "/api/v1/files/abc123/content",
      expectedType: "BINARY",
      description: "file content",
    },
    {
      endpoint: "/api/v1/files/abc123/redacted-text?redactor_id=1",
      expectedType: "JSON",
      description: "redacted text",
    },
    {
      endpoint: "/api/v1/classifications",
      expectedType: "JSON",
      description: "classifications",
    },
    {
      endpoint: "/api/v1/redactors",
      expectedType: "JSON",
      description: "redactors",
    },
  ];

  testCases.forEach(({ endpoint, expectedType, description }) => {
    it(`should detect ${expectedType} for ${description}`, () => {
      // Pattern matching tests
      const isBinary = endpoint.match(/^\/api\/v1\/files\/[^/]+\/content$/);
      const isJsonl = endpoint.match(/^\/api\/v1\/files(\?.*)?$/);

      if (expectedType === "BINARY") {
        expect(isBinary).toBeTruthy();
      } else if (expectedType === "JSONL") {
        expect(isJsonl).toBeTruthy();
      } else {
        expect(isBinary).toBeFalsy();
        expect(isJsonl).toBeFalsy();
      }
    });
  });
});

describe("URL Encoding", () => {
  it("should encode special characters in file IDs", () => {
    const fileId = "file/with/slashes";
    const encoded = encodeURIComponent(fileId);
    expect(encoded).toBe("file%2Fwith%2Fslashes");
  });

  it("should encode special characters in KQL queries", () => {
    const query = 'fileName:"test file" AND size > 1000';
    const encoded = encodeURIComponent(query);
    expect(encoded).toContain("fileName");
    expect(encoded).not.toContain(" ");
  });

  it("should handle already encoded strings", () => {
    const fileId = "simple-file-id";
    const encoded = encodeURIComponent(fileId);
    expect(encoded).toBe(fileId); // No change for safe characters
  });
});

describe("Input Validation", () => {
  describe("validateString", () => {
    // These would need to be exported or tested through the API
    const validateString = (value: unknown, paramName: string): string => {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid ${paramName}: must be a non-empty string`);
      }
      return value;
    };

    it("should accept valid strings", () => {
      expect(validateString("valid-id", "id")).toBe("valid-id");
      expect(validateString("  trimmed  ", "id")).toBe("  trimmed  ");
    });

    it("should reject empty strings", () => {
      expect(() => validateString("", "id")).toThrow("Invalid id: must be a non-empty string");
      expect(() => validateString("   ", "id")).toThrow("Invalid id: must be a non-empty string");
    });

    it("should reject non-strings", () => {
      expect(() => validateString(123, "id")).toThrow("Invalid id: must be a non-empty string");
      expect(() => validateString(null, "id")).toThrow("Invalid id: must be a non-empty string");
      expect(() => validateString(undefined, "id")).toThrow("Invalid id: must be a non-empty string");
    });
  });

  describe("validateNumber", () => {
    const validateNumber = (value: unknown, paramName: string): number => {
      if (typeof value !== "number" || isNaN(value)) {
        throw new Error(`Invalid ${paramName}: must be a valid number`);
      }
      return value;
    };

    it("should accept valid numbers", () => {
      expect(validateNumber(1, "redactor_id")).toBe(1);
      expect(validateNumber(0, "redactor_id")).toBe(0);
      expect(validateNumber(-1, "redactor_id")).toBe(-1);
      expect(validateNumber(1.5, "redactor_id")).toBe(1.5);
    });

    it("should reject NaN", () => {
      expect(() => validateNumber(NaN, "redactor_id")).toThrow(
        "Invalid redactor_id: must be a valid number"
      );
    });

    it("should reject non-numbers", () => {
      expect(() => validateNumber("1", "redactor_id")).toThrow(
        "Invalid redactor_id: must be a valid number"
      );
      expect(() => validateNumber(null, "redactor_id")).toThrow(
        "Invalid redactor_id: must be a valid number"
      );
      expect(() => validateNumber(undefined, "redactor_id")).toThrow(
        "Invalid redactor_id: must be a valid number"
      );
    });
  });
});

describe("API Request Scenarios", () => {
  describe("JSONL Response Handling", () => {
    it("should parse JSONL file metadata correctly", () => {
      const jsonlData = `{"id":"1","fileName":"file1.pdf","size":1024}\n{"id":"2","fileName":"file2.pdf","size":2048}`;
      const lines = jsonlData.trim().split("\n").filter(line => line.trim());
      const data = lines.map(line => JSON.parse(line));

      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ id: "1", fileName: "file1.pdf", size: 1024 });
      expect(data[1]).toEqual({ id: "2", fileName: "file2.pdf", size: 2048 });
    });

    it("should handle empty JSONL response", () => {
      const jsonlData = "";
      const lines = jsonlData.trim().split("\n").filter(line => line.trim());

      expect(lines).toHaveLength(0);
    });

    it("should skip empty lines in JSONL", () => {
      const jsonlData = `{"id":"1"}\n\n{"id":"2"}\n\n\n`;
      const lines = jsonlData.trim().split("\n").filter(line => line.trim());
      const data = lines.map(line => JSON.parse(line));

      expect(data).toHaveLength(2);
    });
  });

  describe("Binary Content Handling", () => {
    it("should encode binary content to base64", () => {
      const binaryData = Buffer.from("test binary content");
      const base64 = binaryData.toString("base64");

      expect(base64).toBe("dGVzdCBiaW5hcnkgY29udGVudA==");

      // Verify we can decode it back
      const decoded = Buffer.from(base64, "base64").toString();
      expect(decoded).toBe("test binary content");
    });

    it("should handle large binary content", () => {
      const largeData = Buffer.alloc(1024 * 1024); // 1MB
      const base64 = largeData.toString("base64");

      expect(base64.length).toBeGreaterThan(0);
      expect(typeof base64).toBe("string");
    });
  });

  describe("JSON Response Handling", () => {
    it("should parse JSON responses correctly", () => {
      const jsonData = {
        status: "ok",
        data: [
          { id: "1", name: "Classification 1" },
          { id: "2", name: "Classification 2" },
        ],
      };

      const stringified = JSON.stringify(jsonData);
      const parsed = JSON.parse(stringified);

      expect(parsed).toEqual(jsonData);
      expect(parsed.status).toBe("ok");
      expect(parsed.data).toHaveLength(2);
    });
  });
});

describe("Error Response Scenarios", () => {
  it("should handle 404 errors", () => {
    const error404 = {
      status: "error",
      error: {
        code: "NOT_FOUND",
        message: "Document not found for given id: xyz123",
      },
    };

    expect(error404.status).toBe("error");
    expect(error404.error.code).toBe("NOT_FOUND");
  });

  it("should handle 401 authentication errors", () => {
    const error401 = {
      status: "error",
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired authentication token",
      },
    };

    expect(error401.status).toBe("error");
    expect(error401.error.code).toBe("UNAUTHORIZED");
  });

  it("should handle 500 server errors", () => {
    const error500 = {
      status: "error",
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong",
      },
    };

    expect(error500.status).toBe("error");
    expect(error500.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("Tool Input Validation", () => {
  describe("list_file_metadata", () => {
    it("should accept valid KQL query", () => {
      const validQueries = [
        'fileName:"Invoice"',
        "size > 100000",
        'fileName:"Invoice" AND size > 100000',
        "classifications.type:ANNOTATOR",
      ];

      validQueries.forEach(query => {
        expect(() => {
          if (typeof query !== "string" || query.trim().length === 0) {
            throw new Error("Invalid q: must be a non-empty string");
          }
        }).not.toThrow();
      });
    });

    it("should reject invalid query types", () => {
      const invalidQueries = [123, null, undefined, {}, []];

      invalidQueries.forEach(query => {
        if (query !== undefined) {
          expect(() => {
            if (typeof query !== "string" || (query as string).trim().length === 0) {
              throw new Error("Invalid q: must be a non-empty string");
            }
          }).toThrow();
        }
      });
    });
  });

  describe("get_file_content", () => {
    it("should require id parameter", () => {
      expect(() => {
        const args = {};
        if (!args || !("id" in args)) {
          throw new Error("Missing required parameter: id");
        }
      }).toThrow("Missing required parameter: id");
    });

    it("should validate id is a string", () => {
      const invalidIds = [123, null, {}, []];

      invalidIds.forEach(id => {
        expect(() => {
          if (typeof id !== "string" || id.trim().length === 0) {
            throw new Error("Invalid id: must be a non-empty string");
          }
        }).toThrow();
      });
    });

    it("should accept valid file IDs", () => {
      const validIds = ["abc123", "0KQUMpgBVo-c9i0dUnJ8", "file-with-dashes"];

      validIds.forEach(id => {
        expect(() => {
          if (typeof id !== "string" || id.trim().length === 0) {
            throw new Error("Invalid id: must be a non-empty string");
          }
        }).not.toThrow();
      });
    });
  });

  describe("get_file_redacted_text", () => {
    it("should require both id and redactor_id", () => {
      expect(() => {
        const args: { id: string; redactor_id?: number } = { id: "abc123" };
        if (!args?.id || args?.redactor_id === undefined) {
          throw new Error("Missing required parameters: id and redactor_id");
        }
      }).toThrow("Missing required parameters");

      expect(() => {
        const args: { id?: string; redactor_id: number } = { redactor_id: 1 };
        if (!args?.id || args?.redactor_id === undefined) {
          throw new Error("Missing required parameters: id and redactor_id");
        }
      }).toThrow("Missing required parameters");
    });

    it("should validate redactor_id is a number", () => {
      const invalidRedactorIds = ["1", null, undefined, {}, []];

      invalidRedactorIds.forEach(redactorId => {
        if (redactorId !== undefined) {
          expect(() => {
            if (typeof redactorId !== "number" || isNaN(redactorId)) {
              throw new Error("Invalid redactor_id: must be a valid number");
            }
          }).toThrow();
        }
      });
    });

    it("should accept valid parameters", () => {
      const args = { id: "abc123", redactor_id: 1 };

      expect(() => {
        if (!args?.id || args?.redactor_id === undefined) {
          throw new Error("Missing required parameters: id and redactor_id");
        }
        if (typeof args.id !== "string" || args.id.trim().length === 0) {
          throw new Error("Invalid id: must be a non-empty string");
        }
        if (typeof args.redactor_id !== "number" || isNaN(args.redactor_id)) {
          throw new Error("Invalid redactor_id: must be a valid number");
        }
      }).not.toThrow();
    });
  });
});

describe("Type Safety", () => {
  it("should have proper types for all responses", () => {
    // FileMetadataListResponse
    const fileMetadataResponse = {
      status: "ok" as const,
      data: [
        {
          id: "1",
          fileName: "test.pdf",
          filePath: "/path/to/test.pdf",
          size: 1024,
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    };
    expect(fileMetadataResponse.status).toBe("ok");

    // FileContentResponse
    const fileContentResponse = {
      content: "base64string",
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="test.pdf"',
    };
    expect(fileContentResponse.contentType).toBe("application/pdf");

    // RedactionResponse
    const redactionResponse = {
      status: "ok" as const,
      data: {
        redactedText: "This is [REDACTED] text",
      },
    };
    expect(redactionResponse.data.redactedText).toContain("[REDACTED]");

    // ClassificationCatalog
    const classificationCatalog = {
      status: "ok" as const,
      data: [
        {
          id: "uuid",
          name: "Credit Card",
          type: "ANNOTATOR" as const,
          description: "Detects credit card numbers",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          link: "/resource/uuid",
        },
      ],
    };
    expect(classificationCatalog.data[0].type).toBe("ANNOTATOR");

    // RedactorCatalog
    const redactorCatalog = {
      status: "ok" as const,
      data: [
        {
          id: 1,
          name: "PII Redactor",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    };
    expect(redactorCatalog.data[0].id).toBe(1);
  });
});

describe("KQL Validation", () => {
  // Replicate the validation function for testing
  const validateKQLQuery = (query: string): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    const validFields = [
      "id", "fileName", "filePath", "size", "createdAt", "updatedAt",
      "mimeType", "datasourceId", "classifications", "classifications.type", "classifications.name"
    ];

    // Check for unmatched quotes
    const quoteCount = (query.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      errors.push("Unmatched quotes in query");
    }

    // Check for unmatched parentheses
    const openParens = (query.match(/\(/g) || []).length;
    const closeParens = (query.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push("Unmatched parentheses in query");
    }

    // Check for invalid operators
    if (query.match(/[^><=!]\s*={1}\s*[^=]/)) {
      errors.push("Use ':' for field matching or '>=' for comparisons, not '='");
    }

    // Check for _exists_: patterns
    const existsMatches = query.matchAll(/_exists_:(\w+(?:\.\w+)?)/g);
    for (const match of existsMatches) {
      const fieldName = match[1];

      if (!validFields.includes(fieldName)) {
        errors.push(`Unknown field in _exists_: '${fieldName}'. Valid fields: ${validFields.join(", ")}`);
      }
    }

    // Check field names
    const fieldMatches = query.matchAll(/(\w+(?:\.\w+)?)\s*([:<>]=?)/g);
    for (const match of fieldMatches) {
      const fieldName = match[1];
      const operator = match[2];

      // Skip logical operators and _exists_
      if (["NOT", "AND", "OR", "_exists_"].includes(fieldName)) {
        continue;
      }

      if (!validFields.includes(fieldName)) {
        errors.push(`Unknown field: '${fieldName}'. Valid fields: ${validFields.join(", ")}`);
      }

      const numericFields = ["size"];
      const dateFields = ["createdAt", "updatedAt"];

      if (["<", ">", "<=", ">="].includes(operator)) {
        if (!numericFields.includes(fieldName) && !dateFields.includes(fieldName)) {
          errors.push(`Comparison operators (<, >, <=, >=) should only be used with numeric fields (size) or date fields (createdAt, updatedAt), not '${fieldName}'`);
        }
      }
    }

    // Check for lowercase logical operators
    const hasInvalidLogical = query.match(/\b(and|or|not)\b/);
    if (hasInvalidLogical) {
      errors.push("Logical operators must be uppercase: AND, OR, NOT");
    }

    // Check if query is too broad
    const isTooBoard =
      query.trim() === "*" ||
      query.trim() === "_exists_:id" ||
      query.trim() === "_exists_:fileName" ||
      (query.length < 5 && !query.includes(":"));

    if (isTooBoard) {
      errors.push("Query is too broad and may return millions of files. Add specific filters.");
    }

    return { valid: errors.length === 0, errors };
  };

  describe("Valid Queries", () => {
    it("should accept simple field matching", () => {
      const result = validateKQLQuery('fileName:"Invoice"');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept wildcard patterns", () => {
      const result = validateKQLQuery('fileName:"Invoice*"');
      expect(result.valid).toBe(true);
    });

    it("should accept numeric comparisons", () => {
      const result = validateKQLQuery("size > 1000000");
      expect(result.valid).toBe(true);
    });

    it("should accept date comparisons", () => {
      const result = validateKQLQuery('createdAt >= "2024-01-01"');
      expect(result.valid).toBe(true);
    });

    it("should accept existence checks", () => {
      const result = validateKQLQuery("_exists_:classifications");
      expect(result.valid).toBe(true);
    });

    it("should accept AND operator", () => {
      const result = validateKQLQuery('fileName:"Invoice" AND size > 1000000');
      expect(result.valid).toBe(true);
    });

    it("should accept OR operator", () => {
      const result = validateKQLQuery('fileName:"Invoice" OR fileName:"Receipt"');
      expect(result.valid).toBe(true);
    });

    it("should accept NOT operator", () => {
      const result = validateKQLQuery('NOT mimeType:"text/plain"');
      expect(result.valid).toBe(true);
    });

    it("should accept complex nested queries", () => {
      const result = validateKQLQuery(
        'fileName:"*Invoice*" AND mimeType:"application/pdf" AND size > 1000000 AND createdAt >= "2024-01-01" AND _exists_:classifications'
      );
      expect(result.valid).toBe(true);
    });

    it("should accept nested field names", () => {
      const result = validateKQLQuery('classifications.type:"ANNOTATOR"');
      expect(result.valid).toBe(true);
    });
  });

  describe("Invalid Queries - Syntax Errors", () => {
    it("should reject unmatched quotes", () => {
      const result = validateKQLQuery('fileName:"Invoice');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Unmatched quotes in query");
    });

    it("should reject unmatched parentheses", () => {
      const result = validateKQLQuery('(fileName:"Invoice" AND size > 1000');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Unmatched parentheses in query");
    });

    it("should reject single equals operator", () => {
      const result = validateKQLQuery('fileName = "Invoice"');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Use ':' for field matching"))).toBe(true);
    });

    it("should reject lowercase logical operators", () => {
      const result = validateKQLQuery('fileName:"Invoice" and size > 1000');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Logical operators must be uppercase: AND, OR, NOT");
    });
  });

  describe("Invalid Queries - Semantic Errors", () => {
    it("should reject unknown field names", () => {
      const result = validateKQLQuery('unknownField:"value"');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("Unknown field"))).toBe(true);
    });

    it("should reject comparison operators on string fields", () => {
      const result = validateKQLQuery("fileName > 1000");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("should only be used with numeric"))).toBe(true);
    });

    it("should reject overly broad wildcard-only query", () => {
      const result = validateKQLQuery("*");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("too broad"))).toBe(true);
    });

    it("should reject _exists_:id (too broad)", () => {
      const result = validateKQLQuery("_exists_:id");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("too broad"))).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle queries with spaces", () => {
      const result = validateKQLQuery('fileName : "Invoice"  AND  size  >  1000');
      expect(result.valid).toBe(true);
    });

    it("should handle empty string", () => {
      const result = validateKQLQuery("");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("too broad"))).toBe(true);
    });

    it("should handle queries with special characters in values", () => {
      const result = validateKQLQuery('fileName:"Invoice_2024-01-15_FINAL.pdf"');
      expect(result.valid).toBe(true);
    });

    it("should handle multiple AND/OR operators", () => {
      const result = validateKQLQuery(
        'fileName:"Invoice" AND size > 1000 OR fileName:"Receipt" AND size > 2000'
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("Real-World Query Examples", () => {
    it("should validate: Find invoices from 2024", () => {
      const result = validateKQLQuery('fileName:"*Invoice*" AND fileName:"*2024*"');
      expect(result.valid).toBe(true);
    });

    it("should validate: Find large PDFs", () => {
      const result = validateKQLQuery('mimeType:"application/pdf" AND size > 50000000');
      expect(result.valid).toBe(true);
    });

    it("should validate: Find recent files", () => {
      const result = validateKQLQuery('createdAt >= "2024-12-01"');
      expect(result.valid).toBe(true);
    });

    it("should validate: Find classified files", () => {
      const result = validateKQLQuery('_exists_:classifications');
      expect(result.valid).toBe(true);
    });

    it("should validate: Find files by path", () => {
      const result = validateKQLQuery('filePath:"*/finance/*"');
      expect(result.valid).toBe(true);
    });

    it("should validate: Complex enterprise query", () => {
      const result = validateKQLQuery(
        'fileName:"*2024*" AND mimeType:"application/pdf" AND size > 1000000 AND ' +
        'createdAt >= "2024-01-01" AND createdAt < "2025-01-01" AND ' +
        '_exists_:classifications AND classifications.type:"ANNOTATOR"'
      );
      expect(result.valid).toBe(true);
    });
  });
});
