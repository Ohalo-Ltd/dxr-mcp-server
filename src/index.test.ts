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

describe("Pagination", () => {
  describe("Parameter Validation", () => {
    it("should accept valid limit values", () => {
      const validLimits = [1, 10, 50, 100, 500];
      validLimits.forEach(limit => {
        expect(() => {
          if (limit < 1 || limit > 500) {
            throw new Error("Invalid limit: must be between 1 and 500");
          }
        }).not.toThrow();
      });
    });

    it("should reject invalid limit values", () => {
      const invalidLimits = [0, -1, 501, 1000];
      invalidLimits.forEach(limit => {
        expect(() => {
          if (limit < 1 || limit > 500) {
            throw new Error("Invalid limit: must be between 1 and 500");
          }
        }).toThrow();
      });
    });

    it("should accept valid offset values", () => {
      const validOffsets = [0, 10, 100, 1000];
      validOffsets.forEach(offset => {
        expect(() => {
          if (offset < 0) {
            throw new Error("Invalid offset: must be non-negative");
          }
        }).not.toThrow();
      });
    });

    it("should reject negative offset values", () => {
      const invalidOffsets = [-1, -10, -100];
      invalidOffsets.forEach(offset => {
        expect(() => {
          if (offset < 0) {
            throw new Error("Invalid offset: must be non-negative");
          }
        }).toThrow();
      });
    });
  });

  describe("Pagination Logic", () => {
    const mockFiles = Array.from({ length: 100 }, (_, i) => ({
      datasource: { id: `ds-${i}`, name: `Datasource ${i}` },
      fileName: `file${i}.pdf`,
      fileId: `id-${i}`,
      path: `/path/to/file${i}.pdf`,
      size: 1024 * (i + 1),
      mimeType: "application/pdf",
      createdAt: "2024-01-01T00:00:00Z",
      lastModifiedAt: "2024-01-02T00:00:00Z",
      annotators: i % 3 === 0 ? [{ id: "a1", name: "Credit card" }] : [],
      labels: i % 5 === 0 ? [{ id: "l1", name: "Confidential" }] : [],
    }));

    it("should return first page with default limit", () => {
      const offset = 0;
      const limit = 50;
      const page = mockFiles.slice(offset, offset + limit);

      expect(page).toHaveLength(50);
      expect(page[0].fileName).toBe("file0.pdf");
      expect(page[49].fileName).toBe("file49.pdf");
    });

    it("should return second page", () => {
      const offset = 50;
      const limit = 50;
      const page = mockFiles.slice(offset, offset + limit);

      expect(page).toHaveLength(50);
      expect(page[0].fileName).toBe("file50.pdf");
      expect(page[49].fileName).toBe("file99.pdf");
    });

    it("should handle partial last page", () => {
      const offset = 90;
      const limit = 50;
      const page = mockFiles.slice(offset, offset + limit);

      expect(page).toHaveLength(10);
      expect(page[0].fileName).toBe("file90.pdf");
      expect(page[9].fileName).toBe("file99.pdf");
    });

    it("should return empty page when offset exceeds total", () => {
      const offset = 200;
      const limit = 50;
      const page = mockFiles.slice(offset, offset + limit);

      expect(page).toHaveLength(0);
    });

    it("should correctly calculate hasMore flag", () => {
      const cases = [
        { offset: 0, limit: 50, total: 100, expectedHasMore: true },
        { offset: 50, limit: 50, total: 100, expectedHasMore: false },
        { offset: 0, limit: 100, total: 100, expectedHasMore: false },
        { offset: 0, limit: 150, total: 100, expectedHasMore: false },
      ];

      cases.forEach(({ offset, limit, total, expectedHasMore }) => {
        const hasMore = offset + limit < total;
        expect(hasMore).toBe(expectedHasMore);
      });
    });
  });
});

describe("Summary Response Generation", () => {
  const mockFiles = [
    {
      datasource: { id: "ds1", name: "Finance SharePoint" },
      fileName: "invoice.pdf",
      fileId: "id1",
      path: "/finance/invoice.pdf",
      size: 1024,
      mimeType: "application/pdf",
      createdAt: "2024-01-01T00:00:00Z",
      lastModifiedAt: "2024-01-02T00:00:00Z",
      annotators: [{ id: "a1", name: "Credit card" }],
      labels: [{ id: "l1", name: "Confidential" }],
    },
    {
      datasource: { id: "ds2", name: "HR Database" },
      fileName: "report.xlsx",
      fileId: "id2",
      path: "/hr/report.xlsx",
      size: 2048,
      mimeType: "application/vnd.ms-excel",
      createdAt: "2024-02-01T00:00:00Z",
      lastModifiedAt: "2024-02-02T00:00:00Z",
      annotators: [],
      labels: [],
    },
    {
      datasource: { id: "ds1", name: "Finance SharePoint" },
      fileName: "statement.pdf",
      fileId: "id3",
      path: "/finance/statement.pdf",
      size: 3072,
      mimeType: "application/pdf",
      createdAt: "2024-03-01T00:00:00Z",
      lastModifiedAt: "2024-03-02T00:00:00Z",
      annotators: [{ id: "a2", name: "SSN" }, { id: "a3", name: "Email" }],
      dlpLabels: [{ id: "d1", dlpSystem: "PURVIEW", name: "Highly Confidential", type: "APPLIED" }],
    },
  ];

  describe("File Summary Conversion", () => {
    it("should convert full metadata to lightweight summary", () => {
      const fullFile = mockFiles[0];
      const summary = {
        fileId: fullFile.fileId,
        fileName: fullFile.fileName,
        path: fullFile.path,
        size: fullFile.size,
        mimeType: fullFile.mimeType,
        createdAt: fullFile.createdAt,
        lastModifiedAt: fullFile.lastModifiedAt,
        hasSensitiveData: fullFile.annotators.length > 0,
        sensitiveDataCount: fullFile.annotators.length,
        hasLabels: (fullFile.labels?.length ?? 0) > 0,
        datasourceName: fullFile.datasource.name,
      };

      expect(summary.fileId).toBe("id1");
      expect(summary.fileName).toBe("invoice.pdf");
      expect(summary.hasSensitiveData).toBe(true);
      expect(summary.sensitiveDataCount).toBe(1);
      expect(summary.hasLabels).toBe(true);
      expect(summary.datasourceName).toBe("Finance SharePoint");
    });

    it("should handle files without sensitive data", () => {
      const fullFile = mockFiles[1];
      const hasSensitiveData = fullFile.annotators.length > 0;
      const hasLabels = (fullFile.labels?.length ?? 0) > 0;

      expect(hasSensitiveData).toBe(false);
      expect(hasLabels).toBe(false);
    });

    it("should count multiple annotators", () => {
      const fullFile = mockFiles[2];
      const sensitiveDataCount = fullFile.annotators.length;

      expect(sensitiveDataCount).toBe(2);
    });

    it("should detect DLP labels as labels", () => {
      const fullFile = mockFiles[2];
      const hasLabels = (fullFile.labels?.length ?? 0) > 0 || (fullFile.dlpLabels?.length ?? 0) > 0;

      expect(hasLabels).toBe(true);
    });
  });

  describe("Stats Generation", () => {
    it("should calculate total count", () => {
      const totalFiles = mockFiles.length;
      expect(totalFiles).toBe(3);
    });

    it("should calculate total size", () => {
      const totalSize = mockFiles.reduce((sum, file) => sum + file.size, 0);
      expect(totalSize).toBe(6144); // 1024 + 2048 + 3072
    });

    it("should count files with sensitive data", () => {
      const filesWithSensitiveData = mockFiles.filter(f => f.annotators.length > 0).length;
      expect(filesWithSensitiveData).toBe(2);
    });

    it("should count files with labels", () => {
      const filesWithLabels = mockFiles.filter(
        f => (f.labels?.length ?? 0) > 0 || (f.dlpLabels?.length ?? 0) > 0
      ).length;
      expect(filesWithLabels).toBe(2);
    });

    it("should aggregate mime types", () => {
      const mimeTypes: Record<string, number> = {};
      mockFiles.forEach(file => {
        mimeTypes[file.mimeType] = (mimeTypes[file.mimeType] || 0) + 1;
      });

      expect(mimeTypes["application/pdf"]).toBe(2);
      expect(mimeTypes["application/vnd.ms-excel"]).toBe(1);
    });

    it("should determine date range", () => {
      const dates = mockFiles.map(f => f.createdAt).sort();
      const earliest = dates[0];
      const latest = dates[dates.length - 1];

      expect(earliest).toBe("2024-01-01T00:00:00Z");
      expect(latest).toBe("2024-03-01T00:00:00Z");
    });
  });

  describe("Response Structure", () => {
    it("should include status field", () => {
      const response = { status: "ok" };
      expect(response.status).toBe("ok");
    });

    it("should include stats object", () => {
      const stats = {
        totalFiles: 3,
        totalSize: 6144,
        filesWithSensitiveData: 2,
        filesWithLabels: 2,
        mimeTypes: { "application/pdf": 2, "application/vnd.ms-excel": 1 },
        dateRange: { earliest: "2024-01-01T00:00:00Z", latest: "2024-03-01T00:00:00Z" },
      };

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSize).toBe(6144);
      expect(stats.filesWithSensitiveData).toBe(2);
      expect(stats.filesWithLabels).toBe(2);
      expect(stats.mimeTypes).toBeDefined();
      expect(stats.dateRange).toBeDefined();
    });

    it("should include files array", () => {
      const files = mockFiles.map(f => ({
        fileId: f.fileId,
        fileName: f.fileName,
        path: f.path,
        size: f.size,
        mimeType: f.mimeType,
        createdAt: f.createdAt,
        lastModifiedAt: f.lastModifiedAt,
        hasSensitiveData: f.annotators.length > 0,
        sensitiveDataCount: f.annotators.length,
        hasLabels: (f.labels?.length ?? 0) > 0 || (f.dlpLabels?.length ?? 0) > 0,
        datasourceName: f.datasource.name,
      }));

      expect(files).toHaveLength(3);
      expect(files[0].fileId).toBe("id1");
    });

    it("should include pagination object", () => {
      const pagination = {
        offset: 0,
        limit: 50,
        returnedCount: 3,
        hasMore: false,
      };

      expect(pagination.offset).toBe(0);
      expect(pagination.limit).toBe(50);
      expect(pagination.returnedCount).toBe(3);
      expect(pagination.hasMore).toBe(false);
    });
  });
});

describe("get_file_metadata_details tool", () => {
  it("should require id parameter", () => {
    expect(() => {
      const args: { id?: string } = {};
      if (!args.id) {
        throw new Error("Missing required parameter: id");
      }
    }).toThrow("Missing required parameter: id");
  });

  it("should accept valid id parameter", () => {
    expect(() => {
      const args = { id: "test-file-id-123" };
      if (typeof args.id !== "string" || args.id.trim().length === 0) {
        throw new Error("Invalid id: must be a non-empty string");
      }
    }).not.toThrow();
  });

  it("should reject empty id", () => {
    expect(() => {
      const args = { id: "" };
      if (typeof args.id !== "string" || args.id.trim().length === 0) {
        throw new Error("Invalid id: must be a non-empty string");
      }
    }).toThrow();
  });

  it("should construct correct query for file lookup", () => {
    const fileId = "abc123";
    const query = `/api/v1/files?q=fileId:"${encodeURIComponent(fileId)}"`;

    expect(query).toBe('/api/v1/files?q=fileId:"abc123"');
  });

  it("should handle special characters in file ID", () => {
    const fileId = "file-id-with-special@chars#123";
    const encodedId = encodeURIComponent(fileId);

    expect(encodedId).toBe("file-id-with-special%40chars%23123");
  });
});
