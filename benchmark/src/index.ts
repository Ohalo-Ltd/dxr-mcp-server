#!/usr/bin/env node
/**
 * DXR Benchmark CLI
 *
 * Command-line interface for running DXR MCP server benchmarks.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { TaskLoader } from './harness/TaskLoader.js';
import { MockDXRServer } from './mocks/MockDXRServer.js';
import { MockGDriveServer } from './mocks/MockGDriveServer.js';
import { LiveDXRServer } from './live/LiveDXRServer.js';
import { ClaudeAgent, createGDriveTools, createDXRTools } from './live/ClaudeAgent.js';
import { generateMarkdownReport } from './reporting/MarkdownReporter.js';
import { saveReportToJson } from './reporting/JSONReporter.js';
import type {
  Task,
  TaskCategory,
  TaskResult,
  TaskComparison,
  ComparisonReport,
  CategorySummary,
  ToolCall,
} from './types.js';
import { scoreTask, compareResults } from './scoring/TaskScorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('dxr-benchmark')
  .description('Benchmark framework for DXR MCP Server')
  .version('1.0.0');

// Run command
program
  .command('run')
  .description('Run benchmark suite')
  .option('-c, --category <category>', 'Run only tasks in category (compliance, search, governance)')
  .option('-t, --task <taskId>', 'Run single task by ID')
  .option('-m, --mock', 'Use mock servers (default)', true)
  .option('-l, --live', 'Use live servers (requires credentials)')
  .option('-o, --output <path>', 'Output directory', './results')
  .option('--dry-run', 'List tasks without running')
  .option('-v, --verbose', 'Show detailed agent transcripts')
  .action(async (options) => {
    await runBenchmark(options);
  });

// Validate command
program
  .command('validate')
  .description('Validate task definitions')
  .action(async () => {
    await validateTasks();
  });

// List command
program
  .command('list')
  .description('List available tasks')
  .option('-c, --category <category>', 'Filter by category')
  .action(async (options) => {
    await listTasks(options);
  });

// Report command
program
  .command('report')
  .description('Generate report from existing results')
  .requiredOption('-i, --input <file>', 'Input JSON results file')
  .option('-f, --format <format>', 'Output format (json, markdown, all)', 'all')
  .action(async (options) => {
    await generateReport(options);
  });

program.parse();

// ============================================================================
// Command Implementations
// ============================================================================

interface RunOptions {
  category?: string;
  task?: string;
  mock?: boolean;
  live?: boolean;
  output: string;
  dryRun?: boolean;
  verbose?: boolean;
}

async function runBenchmark(options: RunOptions): Promise<void> {
  const spinner = ora('Initializing benchmark...').start();

  try {
    // Load tasks
    const loader = new TaskLoader();
    let tasks = loader.loadAll();

    // Filter by category if specified
    if (options.category) {
      const category = options.category as TaskCategory;
      tasks = tasks.filter((t) => t.category === category);
    }

    // Filter by task ID if specified
    if (options.task) {
      tasks = tasks.filter((t) => t.id === options.task);
    }

    if (tasks.length === 0) {
      spinner.fail('No tasks found matching criteria');
      return;
    }

    spinner.succeed(`Found ${tasks.length} task(s) to run`);

    // Dry run - just list tasks
    if (options.dryRun) {
      console.log('\nTasks to run:');
      for (const task of tasks) {
        console.log(`  - ${task.id}: ${task.name} (${task.category})`);
      }
      return;
    }

    const isLiveMode = options.live === true;
    let dxrServer: MockDXRServer | LiveDXRServer;
    let gdriveServer: MockGDriveServer;

    if (isLiveMode) {
      // Initialize live servers
      console.log(chalk.blue('\nInitializing LIVE mode...'));

      try {
        const liveDxr = new LiveDXRServer();
        const connected = await liveDxr.testConnection();

        if (!connected) {
          spinner.fail('Failed to connect to DXR API');
          process.exit(1);
        }

        dxrServer = liveDxr;
        console.log(chalk.green('✓ Connected to DXR API'));
      } catch (error) {
        spinner.fail(`Failed to initialize live DXR server: ${error}`);
        process.exit(1);
      }

      // For baseline, still use mock GDrive (or implement live GDrive client)
      gdriveServer = new MockGDriveServer();

      console.log(chalk.blue('\nRunning benchmarks in LIVE mode'));
      console.log(chalk.gray('(DXR uses real API, baseline uses Claude API with GDrive tools)\n'));
    } else {
      // Initialize mock servers
      dxrServer = new MockDXRServer();
      gdriveServer = new MockGDriveServer();

      console.log(chalk.blue('\nRunning benchmarks in MOCK mode'));
      console.log(chalk.gray('(Both DXR and baseline use curated mock data)\n'));
    }

    const taskResults: TaskComparison[] = [];

    // Run each task
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const taskSpinner = ora(
        `[${i + 1}/${tasks.length}] Running: ${task.name}`
      ).start();

      try {
        // Run with DXR agent
        const dxrResult = isLiveMode
          ? await runLiveDXRAgent(task, dxrServer as LiveDXRServer, options.verbose)
          : await runMockDXRAgent(task, dxrServer as MockDXRServer);

        // Run with baseline agent
        const baselineResult = isLiveMode
          ? await runLiveBaselineAgent(task, gdriveServer, options.verbose)
          : await runMockBaselineAgent(task, gdriveServer);

        // Compare results
        const comparison = compareResults(dxrResult, baselineResult);

        taskResults.push({
          taskId: task.id,
          taskName: task.name,
          category: task.category,
          dxrResult,
          baselineResult,
          precisionDelta: comparison.precisionDelta,
          recallDelta: comparison.recallDelta,
          f1Delta: comparison.f1Delta,
          timeDeltaMs: comparison.timeDeltaMs,
          winner: comparison.winner,
        });

        const winnerEmoji =
          comparison.winner === 'dxr'
            ? '🏆 DXR'
            : comparison.winner === 'baseline'
              ? '📁 Baseline'
              : '🤝 Tie';

        taskSpinner.succeed(
          `${task.name} - ${winnerEmoji} (F1: ${(dxrResult.f1Score * 100).toFixed(0)}% vs ${(baselineResult.f1Score * 100).toFixed(0)}%)`
        );
      } catch (error) {
        taskSpinner.fail(`${task.name} - Error: ${error}`);
      }
    }

    // Generate report
    const report = generateComparisonReport(taskResults, isLiveMode ? 'live' : 'mock');

    // Save results
    const outputDir = options.output;
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(outputDir, `benchmark-${timestamp}.json`);
    const mdPath = join(outputDir, `benchmark-${timestamp}.md`);

    saveReportToJson(report, jsonPath);
    writeFileSync(mdPath, generateMarkdownReport(report), 'utf-8');

    console.log(chalk.green('\n✅ Benchmark complete!'));
    console.log(`   Results: ${jsonPath}`);
    console.log(`   Report:  ${mdPath}`);

    // Print summary
    console.log(chalk.blue('\n📊 Summary:'));
    console.log(`   DXR Wins:      ${report.summary.dxrWins}`);
    console.log(`   Baseline Wins: ${report.summary.baselineWins}`);
    console.log(`   Ties:          ${report.summary.ties}`);
    console.log(
      `   Avg F1 Delta:  ${(report.metrics.avgF1Delta * 100).toFixed(1)}%`
    );
  } catch (error) {
    spinner.fail(`Benchmark failed: ${error}`);
    process.exit(1);
  }
}

/**
 * Run mock DXR agent - simulates what a Claude agent with DXR MCP would do
 */
async function runMockDXRAgent(
  task: Task,
  server: MockDXRServer
): Promise<TaskResult> {
  const startTime = Date.now();
  const toolCalls: ToolCall[] = [];
  let filesFound: string[] = [];

  // Simulate agent behavior based on task type
  // In real implementation, this would call Claude API with DXR tools

  // Step 1: Get classifications (common first step)
  const classifyStart = Date.now();
  const classifications = server.getClassifications();
  toolCalls.push({
    name: 'get_classifications',
    args: {},
    result: `Found ${classifications.length} classifications`,
    durationMs: Date.now() - classifyStart,
  });

  // Step 2: Search for files based on task domain
  const searchStart = Date.now();
  let query = '';

  // Build query based on task hints or domain
  if (task.execution.dxrHints?.expectedQueries?.[0]) {
    query = task.execution.dxrHints.expectedQueries[0];
  } else {
    // Default queries based on category
    switch (task.category) {
      case 'compliance':
        if (task.domain.includes('HIPAA') || task.domain.includes('PHI')) {
          query = 'annotators.domain.name:"PHI"';
        } else if (task.domain.includes('GDPR') || task.domain.includes('PII')) {
          query = 'annotators.domain.name:"PII" AND labels.name:"EU Data"';
        } else if (task.domain.includes('ITAR')) {
          query = 'labels.name:"ITAR Controlled"';
        } else if (task.domain.includes('PCI')) {
          query = 'annotators.domain.name:"Financially Sensitive"';
        } else if (task.domain.includes('CCPA')) {
          query = 'labels.name:"CCPA Scope"';
        }
        break;
      case 'search':
        if (task.domain.includes('Contract')) {
          query = 'labels.name:"Contract"';
        } else if (task.domain.includes('Invoice')) {
          query = 'labels.name:"Invoice"';
        }
        break;
      case 'governance':
        query = '_exists_:dlpLabels';
        break;
    }
  }

  const searchResult = server.listFileMetadata(query);
  filesFound = searchResult.files.map((f) => f.fileId);

  toolCalls.push({
    name: 'list_file_metadata',
    args: { q: query },
    result: `Found ${searchResult.files.length} files`,
    durationMs: Date.now() - searchStart,
  });

  const timeToAnswerMs = Date.now() - startTime;

  // Generate mock agent response
  const agentResponse = `Based on my search using DXR metadata, I found ${filesFound.length} files matching the criteria "${query}".`;

  return scoreTask({
    task,
    agentType: 'dxr',
    filesFound,
    toolCalls,
    agentResponse,
    timeToAnswerMs,
    modelVersion: 'mock-dxr-agent',
  });
}

/**
 * Run live DXR agent - uses Claude API with DXR MCP tools
 * This simulates what Claude Desktop can do with the DXR MCP server
 */
async function runLiveDXRAgent(
  task: Task,
  server: LiveDXRServer,
  verbose = false
): Promise<TaskResult> {
  const startTime = Date.now();

  // Create Claude agent with Anthropic API
  const agent = new ClaudeAgent();

  // Create DXR tools that work with the live server
  const { tools, handlers } = createDXRTools({
    getClassifications: () => server.getClassifications(),
    listFileMetadata: (query, limit, offset) => server.listFileMetadata(query, limit, offset),
  });

  // Build task prompt for the DXR agent
  const taskPrompt = buildDXRPrompt(task);

  // Run the agent with DXR tools
  const result = await agent.runTask(taskPrompt, {
    tools,
    toolHandlers: handlers,
    systemPrompt: `You are a data governance assistant using the Data X-Ray (DXR) system to find files based on content classification.

CRITICAL WORKFLOW:
1. FIRST: Call get_classifications to understand what annotators and labels exist
2. THEN: Use list_file_metadata with proper KQL queries based on what you learned

Available tools:
- get_classifications: Get the catalog of all annotators, labels, and extractors (CALL THIS FIRST!)
- list_file_metadata: Search for files using KQL queries

KQL QUERY SYNTAX (CRITICAL):
- String values MUST be in double quotes: annotators.name:"Credit card"
- Use annotators.name for sensitive data types: annotators.name:"SSN"
- Use annotators.domain.name for domains: annotators.domain.name:"PII"
- Use labels.name for labels: labels.name:"Confidential"
- Logical operators are UPPERCASE: AND, OR, NOT

When you find relevant files, list their names clearly in your final response.`,
    maxTurns: 10,
    verbose,
  });

  const timeToAnswerMs = Date.now() - startTime;

  // Convert agent tool calls to our format
  const toolCalls: ToolCall[] = result.toolCalls.map((tc) => ({
    name: tc.name,
    args: tc.args,
    result: tc.result.slice(0, 200), // Truncate for readability
    durationMs: tc.durationMs,
  }));

  return scoreTask({
    task,
    agentType: 'dxr',
    filesFound: result.filesFound,
    toolCalls,
    agentResponse: result.response,
    timeToAnswerMs,
    modelVersion: 'claude-sonnet-4-20250514',
  });
}

/**
 * Build a task prompt for the DXR agent
 */
function buildDXRPrompt(task: Task): string {
  return `Task: ${task.name}

Description: ${task.description}

User Request: ${task.prompt}

IMPORTANT: You have access to the Data X-Ray (DXR) system which has indexed files with content classification.
1. FIRST call get_classifications to see what annotators and labels are available
2. THEN use list_file_metadata with KQL queries to find files

Please search for and identify all files that match this request. List the file names you find.`;
}

/**
 * Run mock baseline agent - simulates Claude with only GDrive MCP
 */
async function runMockBaselineAgent(
  task: Task,
  server: MockGDriveServer
): Promise<TaskResult> {
  const startTime = Date.now();
  const toolCalls: ToolCall[] = [];
  let filesFound: string[] = [];

  // Baseline agent can only search by name/type - no sensitivity metadata
  const searchStart = Date.now();

  // Try to guess file names based on task
  let searchQuery = '';
  if (task.domain.includes('HIPAA') || task.domain.includes('PHI')) {
    searchQuery = "name contains 'patient' or name contains 'medical'";
  } else if (task.domain.includes('Contract')) {
    searchQuery = "name contains 'contract' or name contains 'agreement'";
  } else if (task.domain.includes('Invoice')) {
    searchQuery = "name contains 'invoice'";
  } else if (task.domain.includes('ITAR')) {
    searchQuery = "name contains 'aerospace' or name contains 'defense'";
  } else {
    searchQuery = `name contains '${task.domain.toLowerCase()}'`;
  }

  // Search by name (limited capability)
  const files = server.listFiles({ query: searchQuery });
  filesFound = files.files.map((f) => f.id);

  toolCalls.push({
    name: 'gdrive_search',
    args: { query: searchQuery },
    result: `Found ${files.files.length} files`,
    durationMs: Date.now() - searchStart,
  });

  // Baseline often needs to read files to understand content (slower)
  // Simulate additional time for content analysis
  await new Promise((resolve) => setTimeout(resolve, 100));

  const timeToAnswerMs = Date.now() - startTime;

  const agentResponse = `Based on file name search for "${searchQuery}", I found ${filesFound.length} potentially relevant files. Note: Without content classification, I cannot confirm if these files actually contain the requested sensitive data.`;

  return scoreTask({
    task,
    agentType: 'baseline',
    filesFound,
    toolCalls,
    agentResponse,
    timeToAnswerMs,
    modelVersion: 'mock-baseline-agent',
  });
}

/**
 * Run live baseline agent - uses Claude API with GDrive-like tools
 * This simulates what Claude Desktop can do with the Google Drive MCP
 */
async function runLiveBaselineAgent(
  task: Task,
  server: MockGDriveServer,
  verbose = false
): Promise<TaskResult> {
  const startTime = Date.now();

  // Create Claude agent with Anthropic API
  const agent = new ClaudeAgent();

  // Create GDrive tools that work with the mock server
  const { tools, handlers } = createGDriveTools({
    searchByName: (query: string) => server.searchByName(query),
    listFilesInFolder: (folderId: string) => server.listFilesInFolder(folderId),
    getFile: (fileId: string) => server.getFile(fileId),
    getFileContent: (fileId: string) => server.getFileContent(fileId),
  });

  // Build task prompt for the baseline agent
  const taskPrompt = buildBaselinePrompt(task);

  // Run the agent with GDrive tools
  const result = await agent.runTask(taskPrompt, {
    tools,
    toolHandlers: handlers,
    systemPrompt: `You are a helpful assistant that finds files based on user requests using Google Drive search capabilities.

Available tools:
- gdrive_search: Search for files by name or keywords
- gdrive_list_files: List files in a folder
- gdrive_get_file_info: Get detailed file information
- gdrive_read_file: Read text file content

Important: You do NOT have access to content classification, sensitivity labels, or compliance metadata. You can only search by file names, types, and basic metadata.

When you find relevant files, list their names clearly in your final response.`,
    maxTurns: 10,
    verbose,
  });

  const timeToAnswerMs = Date.now() - startTime;

  // Convert agent tool calls to our format
  const toolCalls: ToolCall[] = result.toolCalls.map((tc) => ({
    name: tc.name,
    args: tc.args,
    result: tc.result.slice(0, 200), // Truncate for readability
    durationMs: tc.durationMs,
  }));

  return scoreTask({
    task,
    agentType: 'baseline',
    filesFound: result.filesFound,
    toolCalls,
    agentResponse: result.response,
    timeToAnswerMs,
    modelVersion: 'claude-sonnet-4-20250514',
  });
}

/**
 * Build a task prompt for the baseline agent (no DXR hints)
 */
function buildBaselinePrompt(task: Task): string {
  return `Task: ${task.name}

Description: ${task.description}

User Request: ${task.prompt}

Please search for and identify all files that match this request. List the file names you find.

Note: You only have access to Google Drive search by name and file metadata. You cannot see content classifications or sensitivity labels.`;
}

/**
 * Generate comparison report from task results
 */
function generateComparisonReport(
  taskResults: TaskComparison[],
  mode: 'mock' | 'live' = 'mock'
): ComparisonReport {
  // Calculate summary
  const dxrWins = taskResults.filter((t) => t.winner === 'dxr').length;
  const baselineWins = taskResults.filter((t) => t.winner === 'baseline').length;
  const ties = taskResults.filter((t) => t.winner === 'tie').length;

  // Calculate by category
  const byCategory: Record<TaskCategory, CategorySummary> = {
    compliance: calculateCategorySummary(
      taskResults.filter((t) => t.category === 'compliance'),
      'compliance'
    ),
    search: calculateCategorySummary(
      taskResults.filter((t) => t.category === 'search'),
      'search'
    ),
    governance: calculateCategorySummary(
      taskResults.filter((t) => t.category === 'governance'),
      'governance'
    ),
  };

  // Calculate aggregate metrics
  const avgPrecisionDelta = average(taskResults.map((t) => t.precisionDelta));
  const avgRecallDelta = average(taskResults.map((t) => t.recallDelta));
  const avgF1Delta = average(taskResults.map((t) => t.f1Delta));
  const avgTimeDeltaMs = average(taskResults.map((t) => t.timeDeltaMs));

  const dxrComplianceRate =
    taskResults.filter((t) => t.dxrResult.compliancePassed).length /
    taskResults.length;
  const baselineComplianceRate =
    taskResults.filter((t) => t.baselineResult.compliancePassed).length /
    taskResults.length;
  const complianceImprovementRate = dxrComplianceRate - baselineComplianceRate;

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      modelVersion: mode === 'live' ? 'live-agents' : 'mock-agents',
      benchmarkVersion: '1.0.0',
      mode,
    },
    summary: {
      totalTasks: taskResults.length,
      dxrWins,
      baselineWins,
      ties,
    },
    byCategory,
    metrics: {
      avgPrecisionDelta,
      avgRecallDelta,
      avgF1Delta,
      avgTimeDeltaMs,
      complianceImprovementRate,
    },
    taskResults,
  };
}

function calculateCategorySummary(
  results: TaskComparison[],
  category: TaskCategory
): CategorySummary {
  if (results.length === 0) {
    return {
      category,
      totalTasks: 0,
      dxr: {
        avgPrecision: 0,
        avgRecall: 0,
        avgF1: 0,
        avgTimeMs: 0,
        tasksCompleted: 0,
        complianceRate: 0,
      },
      baseline: {
        avgPrecision: 0,
        avgRecall: 0,
        avgF1: 0,
        avgTimeMs: 0,
        tasksCompleted: 0,
        complianceRate: 0,
      },
      dxrWins: 0,
      baselineWins: 0,
      ties: 0,
    };
  }

  return {
    category,
    totalTasks: results.length,
    dxr: {
      avgPrecision: average(results.map((r) => r.dxrResult.precision)),
      avgRecall: average(results.map((r) => r.dxrResult.recall)),
      avgF1: average(results.map((r) => r.dxrResult.f1Score)),
      avgTimeMs: average(results.map((r) => r.dxrResult.timeToAnswerMs)),
      tasksCompleted: results.filter((r) => r.dxrResult.taskCompleted).length,
      complianceRate:
        results.filter((r) => r.dxrResult.compliancePassed).length /
        results.length,
    },
    baseline: {
      avgPrecision: average(results.map((r) => r.baselineResult.precision)),
      avgRecall: average(results.map((r) => r.baselineResult.recall)),
      avgF1: average(results.map((r) => r.baselineResult.f1Score)),
      avgTimeMs: average(results.map((r) => r.baselineResult.timeToAnswerMs)),
      tasksCompleted: results.filter((r) => r.baselineResult.taskCompleted)
        .length,
      complianceRate:
        results.filter((r) => r.baselineResult.compliancePassed).length /
        results.length,
    },
    dxrWins: results.filter((r) => r.winner === 'dxr').length,
    baselineWins: results.filter((r) => r.winner === 'baseline').length,
    ties: results.filter((r) => r.winner === 'tie').length,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function validateTasks(): Promise<void> {
  const spinner = ora('Validating task definitions...').start();

  try {
    const loader = new TaskLoader();
    const result = loader.validateAll();

    if (result.valid) {
      spinner.succeed('All task definitions are valid');
      const summary = loader.getSummary();
      console.log(`\nLoaded ${summary.total} tasks:`);
      console.log(`  Compliance: ${summary.byCategory.compliance}`);
      console.log(`  Search: ${summary.byCategory.search}`);
      console.log(`  Governance: ${summary.byCategory.governance}`);
    } else {
      spinner.fail('Validation errors found:');
      for (const error of result.errors) {
        console.log(chalk.red(`\n  ${error.taskId}:`));
        for (const e of error.errors) {
          console.log(chalk.red(`    - ${e}`));
        }
      }
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(`Validation failed: ${error}`);
    process.exit(1);
  }
}

async function listTasks(options: { category?: string }): Promise<void> {
  const loader = new TaskLoader();
  let tasks = loader.loadAll();

  if (options.category) {
    tasks = tasks.filter((t) => t.category === options.category);
  }

  if (tasks.length === 0) {
    console.log('No tasks found');
    return;
  }

  console.log(`\nAvailable tasks (${tasks.length}):\n`);

  const categories = ['compliance', 'search', 'governance'];
  for (const category of categories) {
    const categoryTasks = tasks.filter((t) => t.category === category);
    if (categoryTasks.length > 0) {
      console.log(chalk.blue(`${category.toUpperCase()} (${categoryTasks.length}):`));
      for (const task of categoryTasks) {
        console.log(`  ${chalk.gray(task.id)} - ${task.name}`);
      }
      console.log('');
    }
  }
}

async function generateReport(options: {
  input: string;
  format: string;
}): Promise<void> {
  const spinner = ora('Generating report...').start();

  try {
    const { readFileSync } = await import('fs');
    const content = readFileSync(options.input, 'utf-8');
    const report = JSON.parse(content) as ComparisonReport;

    if (options.format === 'markdown' || options.format === 'all') {
      const md = generateMarkdownReport(report);
      const mdPath = options.input.replace('.json', '.md');
      writeFileSync(mdPath, md, 'utf-8');
      console.log(`Markdown report: ${mdPath}`);
    }

    spinner.succeed('Report generated');
  } catch (error) {
    spinner.fail(`Report generation failed: ${error}`);
    process.exit(1);
  }
}
