/**
 * Claude Agent
 *
 * Wrapper around the Anthropic SDK for running benchmark tasks with Claude.
 * Supports configurable tool sets to compare DXR vs baseline capabilities.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface AgentResult {
  response: string;
  filesFound: string[];
  toolCalls: AgentToolCall[];
  totalTimeMs: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface AgentConfig {
  tools: Anthropic.Tool[];
  toolHandlers: Record<string, ToolHandler>;
  systemPrompt?: string;
  maxTurns?: number;
  verbose?: boolean;
}

/**
 * Claude Agent for benchmark tasks
 */
export class ClaudeAgent {
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = model;
  }

  /**
   * Run a task with the given tools and return results
   */
  async runTask(
    taskPrompt: string,
    config: AgentConfig
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const toolCalls: AgentToolCall[] = [];
    const filesFound: string[] = [];
    const maxTurns = config.maxTurns || 10;
    const verbose = config.verbose || false;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: taskPrompt },
    ];

    if (verbose) {
      console.log('\n' + '='.repeat(80));
      console.log('CLAUDE AGENT TRANSCRIPT');
      console.log('='.repeat(80));
      console.log('\n📝 USER PROMPT:');
      console.log(taskPrompt);
      console.log('\n📋 SYSTEM PROMPT:');
      console.log(config.systemPrompt || '(default)');
    }

    let turnCount = 0;
    let finalResponse = '';

    while (turnCount < maxTurns) {
      turnCount++;

      if (verbose) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🔄 TURN ${turnCount}`);
        console.log('─'.repeat(60));
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: config.systemPrompt || 'You are a helpful assistant that finds files based on user requests. When you find relevant files, list their names clearly.',
        tools: config.tools,
        messages,
      });

      if (verbose) {
        console.log(`\n🤖 CLAUDE RESPONSE (stop_reason: ${response.stop_reason}):`);
      }

      // Check if we're done (no more tool use)
      if (response.stop_reason === 'end_turn') {
        // Extract final text response
        for (const block of response.content) {
          if (block.type === 'text') {
            finalResponse = block.text;
            if (verbose) {
              console.log('\n📄 FINAL TEXT:');
              console.log(block.text);
            }
          }
        }
        break;
      }

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        // First log any text blocks
        for (const block of response.content) {
          if (block.type === 'text' && verbose) {
            console.log('\n💭 CLAUDE THINKING:');
            console.log(block.text);
          }
        }

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const toolArgs = block.input as Record<string, unknown>;
            const handler = config.toolHandlers[toolName];

            if (verbose) {
              console.log(`\n🔧 TOOL CALL: ${toolName}`);
              console.log('   Args:', JSON.stringify(toolArgs, null, 2));
            }

            const toolStart = Date.now();
            let result: string;

            if (handler) {
              try {
                result = await handler(toolArgs);
              } catch (error) {
                result = `Error: ${error}`;
              }
            } else {
              result = `Error: Unknown tool ${toolName}`;
            }

            if (verbose) {
              console.log('\n📥 TOOL RESULT:');
              console.log(result);
            }

            toolCalls.push({
              name: toolName,
              args: toolArgs,
              result,
              durationMs: Date.now() - toolStart,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });

            // Extract file names from search results (both GDrive and DXR tools)
            if (toolName === 'gdrive_search' || toolName === 'gdrive_list_files' || toolName === 'list_file_metadata') {
              // Match "- filename.ext (type, size)" and extract just the filename
              // Use non-greedy match up to common file extensions, then stop at " ("
              const fileRegex = /- ([^\n]+?\.(?:txt|pdf|docx?|xlsx?|csv|json|xml))\s*\(/gi;
              let match;
              while ((match = fileRegex.exec(result)) !== null) {
                const fileName = match[1].trim();
                if (fileName && !filesFound.includes(fileName)) {
                  filesFound.push(fileName);
                }
              }
            }
          }
        }

        // Add assistant message with tool use
        messages.push({
          role: 'assistant',
          content: response.content,
        });

        // Add tool results
        messages.push({
          role: 'user',
          content: toolResults,
        });
      }
    }

    // Try to extract file names from the final response if we didn't get them from tools
    if (filesFound.length === 0 && finalResponse) {
      // Look for file names in the response (common patterns)
      const patterns = [
        /`([^`]+\.(txt|pdf|docx?|xlsx?|csv))`/gi,
        /["']([^"']+\.(txt|pdf|docx?|xlsx?|csv))["']/gi,
        /- ([^\n]+\.(txt|pdf|docx?|xlsx?|csv))/gi,
      ];

      for (const pattern of patterns) {
        const matches = finalResponse.matchAll(pattern);
        for (const match of matches) {
          const fileName = match[1].trim();
          if (fileName && !filesFound.includes(fileName)) {
            filesFound.push(fileName);
          }
        }
      }
    }

    if (verbose) {
      console.log('\n' + '='.repeat(80));
      console.log('END OF TRANSCRIPT');
      console.log('='.repeat(80));
      console.log(`\n📊 SUMMARY:`);
      console.log(`   Total turns: ${turnCount}`);
      console.log(`   Tool calls: ${toolCalls.length}`);
      console.log(`   Files found: ${filesFound.length}`);
      if (filesFound.length > 0) {
        console.log(`   Files: ${filesFound.join(', ')}`);
      }
      console.log(`   Total time: ${Date.now() - startTime}ms`);
      console.log('');
    }

    return {
      response: finalResponse,
      filesFound,
      toolCalls,
      totalTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Create Google Drive-like tools for baseline agent
 * These simulate what Claude Desktop has with the Google Drive MCP
 */
export function createGDriveTools(gdriveServer: {
  searchByName: (query: string) => Array<{ id: string; name: string; mimeType: string; size: number }>;
  listFilesInFolder: (folderId: string) => Array<{ id: string; name: string; mimeType: string; size: number }>;
  getFile: (fileId: string) => { id: string; name: string; mimeType: string; size: number; modifiedTime: string } | null;
  getFileContent: (fileId: string) => { content: string; mimeType: string } | null;
}): { tools: Anthropic.Tool[]; handlers: Record<string, ToolHandler> } {
  const tools: Anthropic.Tool[] = [
    {
      name: 'gdrive_search',
      description: 'Search for files in Google Drive by name or content keywords. Returns a list of matching files.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query - can include file names, keywords, or partial matches',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'gdrive_list_files',
      description: 'List files in a specific folder in Google Drive.',
      input_schema: {
        type: 'object' as const,
        properties: {
          folder_id: {
            type: 'string',
            description: 'The folder ID to list files from. Use "root" for the root folder.',
          },
        },
        required: ['folder_id'],
      },
    },
    {
      name: 'gdrive_get_file_info',
      description: 'Get detailed information about a specific file.',
      input_schema: {
        type: 'object' as const,
        properties: {
          file_id: {
            type: 'string',
            description: 'The file ID to get information for',
          },
        },
        required: ['file_id'],
      },
    },
    {
      name: 'gdrive_read_file',
      description: 'Read the content of a text file. Only works for text-based files.',
      input_schema: {
        type: 'object' as const,
        properties: {
          file_id: {
            type: 'string',
            description: 'The file ID to read',
          },
        },
        required: ['file_id'],
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    gdrive_search: async (args) => {
      const query = args.query as string;
      const results = gdriveServer.searchByName(query);

      if (results.length === 0) {
        return `No files found matching "${query}"`;
      }

      const lines = [`Found ${results.length} file(s) matching "${query}":`];
      for (const file of results.slice(0, 20)) {
        lines.push(`- ${file.name} (${file.mimeType}, ${formatSize(file.size)})`);
      }
      if (results.length > 20) {
        lines.push(`... and ${results.length - 20} more files`);
      }

      return lines.join('\n');
    },

    gdrive_list_files: async (args) => {
      const folderId = args.folder_id as string;
      const results = gdriveServer.listFilesInFolder(folderId);

      if (results.length === 0) {
        return `No files found in folder "${folderId}"`;
      }

      const lines = [`Files in folder "${folderId}":`];
      for (const file of results.slice(0, 20)) {
        lines.push(`- ${file.name} (${file.mimeType})`);
      }
      if (results.length > 20) {
        lines.push(`... and ${results.length - 20} more files`);
      }

      return lines.join('\n');
    },

    gdrive_get_file_info: async (args) => {
      const fileId = args.file_id as string;
      const file = gdriveServer.getFile(fileId);

      if (!file) {
        return `File not found: ${fileId}`;
      }

      return [
        `File: ${file.name}`,
        `ID: ${file.id}`,
        `Type: ${file.mimeType}`,
        `Size: ${formatSize(file.size)}`,
        `Modified: ${file.modifiedTime}`,
      ].join('\n');
    },

    gdrive_read_file: async (args) => {
      const fileId = args.file_id as string;
      const content = gdriveServer.getFileContent(fileId);

      if (!content) {
        return `Unable to read file: ${fileId}`;
      }

      // Decode base64 content
      const text = Buffer.from(content.content, 'base64').toString('utf-8');
      return text.slice(0, 2000) + (text.length > 2000 ? '\n... (truncated)' : '');
    },
  };

  return { tools, handlers };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Create DXR MCP-like tools for the DXR agent
 * These mirror the actual DXR MCP server tools
 */
export function createDXRTools(dxrServer: {
  getClassifications: () => Promise<Array<{ id: number; name: string; type: string; description?: string }>>;
  listFileMetadata: (query?: string, limit?: number, offset?: number) => Promise<{
    files: Array<{
      fileId: string;
      fileName: string;
      mimeType: string;
      size: number;
      annotators?: Array<{ name: string; domain: { name: string } }>;
      labels?: Array<{ name: string }>;
    }>;
    total: number;
    hasMore: boolean;
  }>;
}): { tools: Anthropic.Tool[]; handlers: Record<string, ToolHandler> } {
  const tools: Anthropic.Tool[] = [
    {
      name: 'get_classifications',
      description: `List all sensitivity classifications that Data X-Ray can detect.

CRITICAL: You MUST call this tool FIRST before searching for files with sensitive data.
This provides the catalog of available annotators, labels, and extractors.

Without calling this first, you cannot:
- Know what annotators exist (Credit Card, SSN, Email, etc.)
- Know exact annotator names to use in queries
- Understand what domains are available (PII, Financially Sensitive, etc.)

Returns: Complete catalog of all classification items with names, types, and descriptions.`,
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'list_file_metadata',
      description: `Search and list files indexed in Data X-Ray using KQL queries.

PREREQUISITE: Call get_classifications FIRST to understand what annotators exist.

KQL QUERY SYNTAX (CRITICAL - follow exactly):
All string values MUST be enclosed in double quotes. Wildcards go INSIDE the quotes.

CORRECT examples:
  fileName:"*.pdf"                          - Files ending in .pdf
  fileName:"*report*"                       - Files containing "report"
  annotators.name:"Credit card"             - Files with credit card numbers
  annotators.domain.name:"PII"              - Files with PII detected
  labels.name:"Confidential"                - Files with specific label

WRONG (will cause parse errors):
  fileName:*.pdf                            - WRONG: missing quotes
  annotators.name:Credit card               - WRONG: missing quotes

LOGICAL operators (must be UPPERCASE):
  fileName:"*.pdf" AND size > 100000
  annotators.name:"SSN" OR annotators.name:"Credit card"

FIELDS: fileName, path, size, mimeType, createdAt, lastModifiedAt, datasourceName,
        labels.name, annotators.name, annotators.domain.name

Returns: List of files with metadata including detected sensitive data.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          q: {
            type: 'string',
            description: 'KQL query to filter files. String values MUST be quoted.',
          },
          limit: {
            type: 'number',
            description: 'Number of files to return (default: 50, max: 500)',
          },
        },
      },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    get_classifications: async () => {
      const classifications = await dxrServer.getClassifications();

      if (classifications.length === 0) {
        return 'No classifications found in the system.';
      }

      // Group by type for better readability
      const byType: Record<string, typeof classifications> = {};
      for (const c of classifications) {
        const type = c.type || 'other';
        if (!byType[type]) byType[type] = [];
        byType[type].push(c);
      }

      const lines = ['Available classifications in Data X-Ray:'];
      for (const [type, items] of Object.entries(byType)) {
        lines.push(`\n## ${type.toUpperCase()} (${items.length}):`);
        for (const item of items.slice(0, 30)) {
          lines.push(`- ${item.name}${item.description ? `: ${item.description}` : ''}`);
        }
        if (items.length > 30) {
          lines.push(`  ... and ${items.length - 30} more`);
        }
      }

      lines.push('\nUse these exact names in queries like: annotators.name:"Credit card"');

      return lines.join('\n');
    },

    list_file_metadata: async (args) => {
      const query = args.q as string | undefined;
      const limit = (args.limit as number) || 50;

      const result = await dxrServer.listFileMetadata(query, limit);

      if (result.files.length === 0) {
        return `No files found${query ? ` matching query: ${query}` : ''}`;
      }

      const lines = [`Found ${result.total} file(s)${query ? ` matching "${query}"` : ''}:`];

      for (const file of result.files.slice(0, 30)) {
        const sensitiveInfo = file.annotators?.length
          ? ` [SENSITIVE: ${file.annotators.map((a) => a.name).join(', ')}]`
          : '';
        const labels = file.labels?.length ? ` [Labels: ${file.labels.map((l) => l.name).join(', ')}]` : '';
        lines.push(`- ${file.fileName} (${file.mimeType}, ${formatSize(file.size)})${sensitiveInfo}${labels}`);
      }

      if (result.files.length > 30) {
        lines.push(`... and ${result.files.length - 30} more files`);
      }

      if (result.hasMore) {
        lines.push(`\nNote: More results available. Use limit/offset for pagination.`);
      }

      return lines.join('\n');
    },
  };

  return { tools, handlers };
}
