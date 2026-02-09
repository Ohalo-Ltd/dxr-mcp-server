/**
 * Mock Google Drive Server
 *
 * Simulates the Google Drive API for baseline agent testing.
 * Provides basic file metadata WITHOUT sensitivity classifications.
 * This represents what an agent can see with only native file system access.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MockDXRFile, MockGDriveFile } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FilesData {
  files: MockDXRFile[];
}

/**
 * Mock implementation of Google Drive API
 * Only exposes basic file metadata - no sensitivity information
 */
export class MockGDriveServer {
  private files: MockGDriveFile[] = [];

  constructor(fixturesPath?: string) {
    const basePath = fixturesPath || join(__dirname, '../../fixtures/mock-data');

    // Load DXR files and convert to simplified GDrive format
    const filesData = JSON.parse(
      readFileSync(join(basePath, 'files.json'), 'utf-8')
    ) as FilesData;

    this.files = filesData.files.map((dxrFile) =>
      this.convertToGDriveFormat(dxrFile)
    );
  }

  /**
   * Convert DXR file format to simplified GDrive format
   * This strips out all sensitivity metadata
   */
  private convertToGDriveFormat(dxrFile: MockDXRFile): MockGDriveFile {
    return {
      id: dxrFile.fileId,
      name: dxrFile.fileName,
      mimeType: dxrFile.mimeType,
      size: dxrFile.size,
      createdTime: dxrFile.createdAt,
      modifiedTime: dxrFile.lastModifiedAt,
      parents: [this.extractParentFolder(dxrFile.path)],
      webViewLink: `https://drive.google.com/file/d/${dxrFile.fileId}/view`,
      owners: dxrFile.owner
        ? [
            {
              displayName: dxrFile.owner,
              emailAddress: `${dxrFile.owner.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            },
          ]
        : undefined,
    };
  }

  /**
   * Extract parent folder ID from path
   */
  private extractParentFolder(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 1) {
      // Return the immediate parent folder as a mock ID
      return `folder-${parts[parts.length - 2].toLowerCase().replace(/\s+/g, '-')}`;
    }
    return 'root';
  }

  /**
   * List files with basic filtering
   * Note: No sensitivity-based filtering available
   */
  listFiles(options?: {
    query?: string;
    pageSize?: number;
    pageToken?: string;
  }): {
    files: MockGDriveFile[];
    nextPageToken?: string;
  } {
    let filtered = this.files;
    const pageSize = options?.pageSize || 100;
    const startIndex = options?.pageToken ? parseInt(options.pageToken, 10) : 0;

    // Apply basic query filtering (Google Drive query syntax)
    if (options?.query) {
      filtered = this.applyQuery(options.query);
    }

    const paginated = filtered.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < filtered.length;

    return {
      files: paginated,
      nextPageToken: hasMore ? String(startIndex + pageSize) : undefined,
    };
  }

  /**
   * Get file by ID
   */
  getFile(fileId: string): MockGDriveFile | null {
    return this.files.find((f) => f.id === fileId) || null;
  }

  /**
   * Get file content (mock)
   */
  getFileContent(fileId: string): {
    content: string;
    mimeType: string;
  } | null {
    const file = this.getFile(fileId);
    if (!file) return null;

    // Return mock content
    const mockContent = Buffer.from(
      `[Mock content for ${file.name}]`
    ).toString('base64');

    return {
      content: mockContent,
      mimeType: file.mimeType,
    };
  }

  /**
   * Search files by name
   * Supports multi-word queries - matches if ANY word is found in the filename
   */
  searchByName(nameQuery: string): MockGDriveFile[] {
    const lowerQuery = nameQuery.toLowerCase();
    // Split query into individual words and filter out short/common words
    const searchTerms = lowerQuery
      .split(/\s+/)
      .filter((term) => term.length >= 3); // Ignore very short terms

    if (searchTerms.length === 0) {
      return [];
    }

    return this.files.filter((f) => {
      const lowerName = f.name.toLowerCase();
      // Match if ANY search term is found in the filename
      return searchTerms.some((term) => lowerName.includes(term));
    });
  }

  /**
   * List files in a folder
   */
  listFilesInFolder(folderId: string): MockGDriveFile[] {
    return this.files.filter((f) => f.parents?.includes(folderId));
  }

  /**
   * Get files by MIME type
   */
  getFilesByMimeType(mimeType: string): MockGDriveFile[] {
    return this.files.filter((f) => f.mimeType === mimeType);
  }

  /**
   * Apply Google Drive query syntax
   * Supports: name contains, mimeType =, modifiedTime >, etc.
   */
  private applyQuery(query: string): MockGDriveFile[] {
    return this.files.filter((file) => {
      // name contains 'value'
      const nameContainsMatch = query.match(/name\s+contains\s+'([^']+)'/i);
      if (nameContainsMatch) {
        if (!file.name.toLowerCase().includes(nameContainsMatch[1].toLowerCase())) {
          return false;
        }
      }

      // name = 'value'
      const nameEqualsMatch = query.match(/name\s*=\s*'([^']+)'/i);
      if (nameEqualsMatch) {
        if (file.name !== nameEqualsMatch[1]) {
          return false;
        }
      }

      // mimeType = 'value'
      const mimeTypeMatch = query.match(/mimeType\s*=\s*'([^']+)'/i);
      if (mimeTypeMatch) {
        if (file.mimeType !== mimeTypeMatch[1]) {
          return false;
        }
      }

      // 'folderId' in parents
      const parentMatch = query.match(/'([^']+)'\s+in\s+parents/i);
      if (parentMatch) {
        if (!file.parents?.includes(parentMatch[1])) {
          return false;
        }
      }

      // modifiedTime > 'date'
      const modifiedAfterMatch = query.match(/modifiedTime\s*>\s*'([^']+)'/i);
      if (modifiedAfterMatch) {
        if (file.modifiedTime <= modifiedAfterMatch[1]) {
          return false;
        }
      }

      // modifiedTime < 'date'
      const modifiedBeforeMatch = query.match(/modifiedTime\s*<\s*'([^']+)'/i);
      if (modifiedBeforeMatch) {
        if (file.modifiedTime >= modifiedBeforeMatch[1]) {
          return false;
        }
      }

      // fullText contains 'value' - mock implementation (search by name)
      const fullTextMatch = query.match(/fullText\s+contains\s+'([^']+)'/i);
      if (fullTextMatch) {
        // In real GDrive, this searches content. We simulate with name search.
        if (!file.name.toLowerCase().includes(fullTextMatch[1].toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get folder structure (for context/navigation)
   */
  getFolderStructure(): Record<string, string[]> {
    const structure: Record<string, string[]> = {};

    for (const file of this.files) {
      for (const parent of file.parents || []) {
        if (!structure[parent]) {
          structure[parent] = [];
        }
        structure[parent].push(file.id);
      }
    }

    return structure;
  }

  /**
   * Generate a description of the file system for system prompts
   * This is what the baseline agent would have access to
   */
  generateFileSystemDescription(): string {
    const structure = this.getFolderStructure();
    const folders = Object.keys(structure);

    let description = 'Available file system structure:\n\n';

    for (const folder of folders) {
      const files = structure[folder];
      const folderFiles = files
        .map((id) => this.getFile(id))
        .filter((f): f is MockGDriveFile => f !== null);

      description += `📁 ${folder}/\n`;
      for (const file of folderFiles.slice(0, 5)) {
        description += `   📄 ${file.name} (${this.formatSize(file.size)})\n`;
      }
      if (folderFiles.length > 5) {
        description += `   ... and ${folderFiles.length - 5} more files\n`;
      }
      description += '\n';
    }

    description += `\nTotal: ${this.files.length} files across ${folders.length} folders.\n`;
    description += '\nNote: File metadata available: name, size, type, created/modified dates, owner.\n';
    description += 'Sensitivity classifications and content analysis NOT available.\n';

    return description;
  }

  /**
   * Format file size for display
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}
