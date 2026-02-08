/**
 * Mock DXR Server
 *
 * Simulates the Data X-Ray API for benchmark testing.
 * Provides rich metadata including classifications, annotators, and sensitivity data.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  MockDXRFile,
  MockClassification,
  MockRedactor,
} from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FilesData {
  files: MockDXRFile[];
}

interface ClassificationsData {
  classifications: MockClassification[];
}

interface RedactorsData {
  redactors: MockRedactor[];
}

/**
 * Mock implementation of the DXR API
 */
export class MockDXRServer {
  private files: MockDXRFile[] = [];
  private classifications: MockClassification[] = [];
  private redactors: MockRedactor[] = [];

  constructor(fixturesPath?: string) {
    const basePath = fixturesPath || join(__dirname, '../../fixtures/mock-data');

    // Load mock data
    const filesData = JSON.parse(
      readFileSync(join(basePath, 'files.json'), 'utf-8')
    ) as FilesData;
    this.files = filesData.files;

    const classificationsData = JSON.parse(
      readFileSync(join(basePath, 'classifications.json'), 'utf-8')
    ) as ClassificationsData;
    this.classifications = classificationsData.classifications;

    const redactorsData = JSON.parse(
      readFileSync(join(basePath, 'redactors.json'), 'utf-8')
    ) as RedactorsData;
    this.redactors = redactorsData.redactors;
  }

  /**
   * List file metadata with optional KQL query filtering
   */
  listFileMetadata(query?: string, limit = 50, offset = 0): {
    files: MockDXRFile[];
    total: number;
    hasMore: boolean;
  } {
    let filtered = this.files;

    if (query) {
      filtered = this.applyKqlFilter(query);
    }

    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      files: paginated,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Get file metadata by ID
   */
  getFileMetadata(fileId: string): MockDXRFile | null {
    return this.files.find((f) => f.fileId === fileId) || null;
  }

  /**
   * Get file content (mock - returns placeholder)
   */
  getFileContent(fileId: string): {
    content: string;
    mimeType: string;
    fileName: string;
  } | null {
    const file = this.getFileMetadata(fileId);
    if (!file) return null;

    // Return mock base64 content
    const mockContent = Buffer.from(
      `[Mock content for ${file.fileName}]`
    ).toString('base64');

    return {
      content: mockContent,
      mimeType: file.mimeType,
      fileName: file.fileName,
    };
  }

  /**
   * Get redacted text for a file
   */
  getFileRedactedText(fileId: string, redactorId: number): string | null {
    const file = this.getFileMetadata(fileId);
    if (!file) return null;

    const redactor = this.redactors.find((r) => r.id === redactorId);
    if (!redactor) return null;

    // Generate mock redacted content based on annotators
    let content = `Content of ${file.fileName}:\n\n`;

    if (file.annotators.length > 0) {
      content += 'This document contains the following redacted information:\n';
      for (const ann of file.annotators) {
        content += `- ${ann.occurrences} instances of ${ann.name} [REDACTED]\n`;
      }
    } else {
      content += 'No sensitive data detected in this document.\n';
    }

    return content;
  }

  /**
   * Get all classifications
   */
  getClassifications(): MockClassification[] {
    return this.classifications;
  }

  /**
   * Get all redactors
   */
  getRedactors(): MockRedactor[] {
    return this.redactors;
  }

  /**
   * Apply simplified KQL filter to files
   */
  private applyKqlFilter(query: string): MockDXRFile[] {
    const lowerQuery = query.toLowerCase();

    return this.files.filter((file) => {
      // Handle common KQL patterns

      // fileName:"value"
      const fileNameMatch = query.match(/fileName:"([^"]+)"/i);
      if (fileNameMatch) {
        if (!file.fileName.toLowerCase().includes(fileNameMatch[1].toLowerCase())) {
          return false;
        }
      }

      // mimeType:"value"
      const mimeTypeMatch = query.match(/mimeType:"([^"]+)"/i);
      if (mimeTypeMatch) {
        if (file.mimeType !== mimeTypeMatch[1]) {
          return false;
        }
      }

      // size > value
      const sizeGtMatch = query.match(/size\s*>\s*(\d+)/i);
      if (sizeGtMatch) {
        if (file.size <= parseInt(sizeGtMatch[1], 10)) {
          return false;
        }
      }

      // size < value
      const sizeLtMatch = query.match(/size\s*<\s*(\d+)/i);
      if (sizeLtMatch) {
        if (file.size >= parseInt(sizeLtMatch[1], 10)) {
          return false;
        }
      }

      // annotators.domain.name:"value" (e.g., "PHI", "PII", "Financially Sensitive")
      const domainMatch = query.match(/annotators\.domain\.name:"([^"]+)"/i);
      if (domainMatch) {
        const hasDomain = file.annotators.some(
          (a) => a.domain.name.toLowerCase() === domainMatch[1].toLowerCase()
        );
        if (!hasDomain) {
          return false;
        }
      }

      // labels.name:"value"
      const labelMatch = query.match(/labels\.name:"([^"]+)"/i);
      if (labelMatch) {
        const hasLabel = file.labels.some(
          (l) => l.name.toLowerCase() === labelMatch[1].toLowerCase()
        );
        if (!hasLabel) {
          return false;
        }
      }

      // dlpLabels.name:"value"
      const dlpMatch = query.match(/dlpLabels\.name:"([^"]+)"/i);
      if (dlpMatch) {
        const hasDlp = file.dlpLabels.some(
          (d) => d.name.toLowerCase().includes(dlpMatch[1].toLowerCase())
        );
        if (!hasDlp) {
          return false;
        }
      }

      // _exists_:annotators (files with any annotators)
      if (lowerQuery.includes('_exists_:annotators')) {
        if (file.annotators.length === 0) {
          return false;
        }
      }

      // _exists_:dlpLabels
      if (lowerQuery.includes('_exists_:dlplabels')) {
        if (file.dlpLabels.length === 0) {
          return false;
        }
      }

      // extractedMetadata.contractType:"value"
      const contractTypeMatch = query.match(/extractedMetadata\.contractType:"([^"]+)"/i);
      if (contractTypeMatch) {
        if (
          !file.extractedMetadata?.contractType ||
          !file.extractedMetadata.contractType
            .toLowerCase()
            .includes(contractTypeMatch[1].toLowerCase())
        ) {
          return false;
        }
      }

      // extractedMetadata.expirationDate < "value" (for expiring contracts)
      const expirationMatch = query.match(
        /extractedMetadata\.expirationDate\s*<\s*"([^"]+)"/i
      );
      if (expirationMatch) {
        if (
          !file.extractedMetadata?.expirationDate ||
          file.extractedMetadata.expirationDate >= expirationMatch[1]
        ) {
          return false;
        }
      }

      // owner:"value"
      const ownerMatch = query.match(/owner:"([^"]+)"/i);
      if (ownerMatch) {
        if (
          !file.owner ||
          !file.owner.toLowerCase().includes(ownerMatch[1].toLowerCase())
        ) {
          return false;
        }
      }

      // Check for entitlements with external users
      if (lowerQuery.includes('external') || lowerQuery.includes('shared')) {
        const hasExternal = file.entitlements.whoCanAccess.some(
          (e) =>
            e.email &&
            !e.email.endsWith('@example.com') &&
            e.accountType === 'USER'
        );
        if (!hasExternal) {
          return false;
        }
      }

      // Check for files without owner (orphaned)
      if (lowerQuery.includes('not _exists_:owner') || lowerQuery.includes('-owner:*')) {
        if (file.owner) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get files by domain (PHI, PII, PCI, etc.)
   */
  getFilesByDomain(domain: string): MockDXRFile[] {
    return this.files.filter((file) =>
      file.annotators.some(
        (a) => a.domain.name.toLowerCase() === domain.toLowerCase()
      )
    );
  }

  /**
   * Get files with specific label
   */
  getFilesByLabel(labelName: string): MockDXRFile[] {
    return this.files.filter((file) =>
      file.labels.some(
        (l) => l.name.toLowerCase() === labelName.toLowerCase()
      )
    );
  }

  /**
   * Get files with specific DLP label
   */
  getFilesByDlpLabel(dlpLabelName: string): MockDXRFile[] {
    return this.files.filter((file) =>
      file.dlpLabels.some(
        (d) => d.name.toLowerCase().includes(dlpLabelName.toLowerCase())
      )
    );
  }
}
