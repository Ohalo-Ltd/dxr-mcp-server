/**
 * TypeScript types for Data X-Ray API
 * Based on OpenAPI specifications in dxr/api-specs/v1
 */

// ============================================
// File Metadata Types
// ============================================

export interface FileMetadataListResponse {
  status: "ok";
  data: FileMetadata[];
}

export interface FileMetadata {
  id: string;
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  mimeType?: string;
  datasourceId?: string;
  classifications?: Classification[];
  // Additional DXR metadata fields - keeping minimal index signature
  // for extensibility while maintaining type safety on known fields
}

export interface FileContentResponse {
  content: string; // base64-encoded
  contentType: string;
  contentDisposition: string;
}

// ============================================
// Redaction Types
// ============================================

export interface RedactionResponse {
  status: "ok";
  data: {
    redactedText: string;
  };
}

export interface Redactor {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedactorCatalog {
  status: "ok";
  data: Redactor[];
}

// ============================================
// Classification Types
// ============================================

export type ClassificationType = "ANNOTATOR" | "ANNOTATOR_DOMAIN" | "LABEL" | "EXTRACTOR";
export type ClassificationSubtype = "REGEX" | "DICTIONARY" | "NAMED_ENTITY" | "STANDARD" | "SMART" | "NONE";

export interface Classification {
  id: string;
  name: string;
  type: ClassificationType;
  subtype?: ClassificationSubtype;
  description: string;
  createdAt: string;
  updatedAt: string;
  link: string;
  searchLink?: string;
}

export interface ClassificationCatalog {
  status: "ok";
  data: Classification[];
}
