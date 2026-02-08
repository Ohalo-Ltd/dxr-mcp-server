/**
 * Task Loader
 *
 * Loads and validates task definitions from YAML files.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import type { Task, TaskCategory } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface RawTask {
  id: string;
  name: string;
  description: string;
  category: string;
  domain: string;
  difficulty: string;
  prompt: string;
  ground_truth: {
    expected_files: Array<{
      id: string;
      relevance: number;
      reason: string;
    }>;
    forbidden_files?: Array<{
      id: string;
      reason: string;
    }>;
    minimum_precision: number;
    minimum_recall: number;
  };
  execution: {
    timeout_seconds: number;
    max_tool_calls: number;
    dxr_hints?: {
      expected_tools?: string[];
      expected_queries?: string[];
    };
  };
  compliance: {
    must_respect_access_controls: boolean;
    must_not_expose_raw_pii: boolean;
    sensitive_data_domains?: string[];
  };
  tags: string[];
}

/**
 * Validates that a category string is a valid TaskCategory
 */
function isValidCategory(category: string): category is TaskCategory {
  return ['compliance', 'search', 'governance'].includes(category);
}

/**
 * Validates task difficulty
 */
function isValidDifficulty(
  difficulty: string
): difficulty is 'easy' | 'medium' | 'hard' {
  return ['easy', 'medium', 'hard'].includes(difficulty);
}

/**
 * Convert raw YAML task to typed Task
 */
function convertRawTask(raw: RawTask): Task {
  if (!isValidCategory(raw.category)) {
    throw new Error(
      `Invalid category "${raw.category}" in task ${raw.id}. Must be: compliance, search, or governance`
    );
  }

  if (!isValidDifficulty(raw.difficulty)) {
    throw new Error(
      `Invalid difficulty "${raw.difficulty}" in task ${raw.id}. Must be: easy, medium, or hard`
    );
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    domain: raw.domain,
    difficulty: raw.difficulty,
    prompt: raw.prompt,
    groundTruth: {
      expectedFiles: raw.ground_truth.expected_files.map((f) => ({
        id: f.id,
        relevance: f.relevance,
        reason: f.reason,
      })),
      forbiddenFiles: (raw.ground_truth.forbidden_files || []).map((f) => ({
        id: f.id,
        reason: f.reason,
      })),
      minimumPrecision: raw.ground_truth.minimum_precision,
      minimumRecall: raw.ground_truth.minimum_recall,
    },
    execution: {
      timeoutSeconds: raw.execution.timeout_seconds,
      maxToolCalls: raw.execution.max_tool_calls,
      dxrHints: raw.execution.dxr_hints
        ? {
            expectedTools: raw.execution.dxr_hints.expected_tools,
            expectedQueries: raw.execution.dxr_hints.expected_queries,
          }
        : undefined,
    },
    compliance: {
      mustRespectAccessControls: raw.compliance.must_respect_access_controls,
      mustNotExposeRawPii: raw.compliance.must_not_expose_raw_pii,
      sensitiveDataDomains: raw.compliance.sensitive_data_domains,
    },
    tags: raw.tags,
  };
}

/**
 * Task Loader class
 */
export class TaskLoader {
  private tasksPath: string;
  private tasks: Map<string, Task> = new Map();

  constructor(tasksPath?: string) {
    this.tasksPath = tasksPath || join(__dirname, '../../tasks');
  }

  /**
   * Load all tasks from the tasks directory
   */
  loadAll(): Task[] {
    this.tasks.clear();

    const categories = ['compliance', 'search', 'governance'];

    for (const category of categories) {
      const categoryPath = join(this.tasksPath, category);

      try {
        const files = readdirSync(categoryPath);

        for (const file of files) {
          if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const filePath = join(categoryPath, file);
            const task = this.loadTaskFile(filePath);
            this.tasks.set(task.id, task);
          }
        }
      } catch (error) {
        // Category directory might not exist yet
        console.warn(`Warning: Could not read category directory: ${categoryPath}`);
      }
    }

    return Array.from(this.tasks.values());
  }

  /**
   * Load a single task file
   */
  loadTaskFile(filePath: string): Task {
    const content = readFileSync(filePath, 'utf-8');
    const raw = parseYaml(content) as RawTask;

    // Validate required fields
    this.validateRawTask(raw, filePath);

    return convertRawTask(raw);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    if (this.tasks.size === 0) {
      this.loadAll();
    }
    return this.tasks.get(taskId);
  }

  /**
   * Get tasks by category
   */
  getTasksByCategory(category: TaskCategory): Task[] {
    if (this.tasks.size === 0) {
      this.loadAll();
    }
    return Array.from(this.tasks.values()).filter(
      (t) => t.category === category
    );
  }

  /**
   * Get tasks by tag
   */
  getTasksByTag(tag: string): Task[] {
    if (this.tasks.size === 0) {
      this.loadAll();
    }
    return Array.from(this.tasks.values()).filter((t) =>
      t.tags.includes(tag)
    );
  }

  /**
   * Validate raw task structure
   */
  private validateRawTask(raw: RawTask, filePath: string): void {
    const errors: string[] = [];

    if (!raw.id) errors.push('Missing required field: id');
    if (!raw.name) errors.push('Missing required field: name');
    if (!raw.description) errors.push('Missing required field: description');
    if (!raw.category) errors.push('Missing required field: category');
    if (!raw.domain) errors.push('Missing required field: domain');
    if (!raw.difficulty) errors.push('Missing required field: difficulty');
    if (!raw.prompt) errors.push('Missing required field: prompt');

    if (!raw.ground_truth) {
      errors.push('Missing required field: ground_truth');
    } else {
      if (!raw.ground_truth.expected_files) {
        errors.push('Missing required field: ground_truth.expected_files');
      }
      if (raw.ground_truth.minimum_precision === undefined) {
        errors.push('Missing required field: ground_truth.minimum_precision');
      }
      if (raw.ground_truth.minimum_recall === undefined) {
        errors.push('Missing required field: ground_truth.minimum_recall');
      }
    }

    if (!raw.execution) {
      errors.push('Missing required field: execution');
    } else {
      if (!raw.execution.timeout_seconds) {
        errors.push('Missing required field: execution.timeout_seconds');
      }
      if (!raw.execution.max_tool_calls) {
        errors.push('Missing required field: execution.max_tool_calls');
      }
    }

    if (!raw.compliance) {
      errors.push('Missing required field: compliance');
    }

    if (!raw.tags) {
      errors.push('Missing required field: tags');
    }

    if (errors.length > 0) {
      throw new Error(
        `Invalid task file ${filePath}:\n${errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }
  }

  /**
   * Validate all tasks and return validation results
   */
  validateAll(): {
    valid: boolean;
    errors: Array<{ taskId: string; errors: string[] }>;
  } {
    const tasks = this.loadAll();
    const allErrors: Array<{ taskId: string; errors: string[] }> = [];

    for (const task of tasks) {
      const taskErrors: string[] = [];

      // Check for duplicate IDs
      const duplicates = tasks.filter((t) => t.id === task.id);
      if (duplicates.length > 1) {
        taskErrors.push(`Duplicate task ID: ${task.id}`);
      }

      // Validate ground truth file IDs exist in mock data
      // (This would require loading mock data, skipped for now)

      // Validate precision/recall thresholds are reasonable
      if (
        task.groundTruth.minimumPrecision < 0 ||
        task.groundTruth.minimumPrecision > 1
      ) {
        taskErrors.push(
          'minimum_precision must be between 0 and 1'
        );
      }
      if (
        task.groundTruth.minimumRecall < 0 ||
        task.groundTruth.minimumRecall > 1
      ) {
        taskErrors.push('minimum_recall must be between 0 and 1');
      }

      if (taskErrors.length > 0) {
        allErrors.push({ taskId: task.id, errors: taskErrors });
      }
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * List all available task IDs
   */
  listTaskIds(): string[] {
    if (this.tasks.size === 0) {
      this.loadAll();
    }
    return Array.from(this.tasks.keys());
  }

  /**
   * Get summary of loaded tasks
   */
  getSummary(): {
    total: number;
    byCategory: Record<TaskCategory, number>;
    byDifficulty: Record<string, number>;
  } {
    const tasks = this.loadAll();

    const byCategory: Record<TaskCategory, number> = {
      compliance: 0,
      search: 0,
      governance: 0,
    };

    const byDifficulty: Record<string, number> = {
      easy: 0,
      medium: 0,
      hard: 0,
    };

    for (const task of tasks) {
      byCategory[task.category]++;
      byDifficulty[task.difficulty]++;
    }

    return {
      total: tasks.length,
      byCategory,
      byDifficulty,
    };
  }
}
