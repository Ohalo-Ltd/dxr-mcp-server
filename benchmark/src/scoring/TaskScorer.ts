/**
 * Task Scorer
 *
 * Combines precision/recall metrics with compliance checking
 * to produce a comprehensive task result score.
 */

import type {
  Task,
  TaskResult,
  AgentType,
  ToolCall,
  ComplianceViolation,
} from '../types.js';
import {
  calculatePrecisionRecall,
  type PrecisionRecallResult,
} from './PrecisionRecall.js';
import { checkCompliance, isCompliant } from './ComplianceChecker.js';

export interface ScoringInput {
  task: Task;
  agentType: AgentType;
  filesFound: string[];
  toolCalls: ToolCall[];
  agentResponse: string;
  timeToAnswerMs: number;
  modelVersion: string;
  error?: string;
}

/**
 * Score a task execution and produce a TaskResult
 */
export function scoreTask(input: ScoringInput): TaskResult {
  const {
    task,
    agentType,
    filesFound,
    toolCalls,
    agentResponse,
    timeToAnswerMs,
    modelVersion,
    error,
  } = input;

  // Calculate precision/recall
  const prResult = calculatePrecisionRecall(
    filesFound,
    task.groundTruth.expectedFiles
  );

  // Check compliance
  const partialResult: TaskResult = {
    taskId: task.id,
    agentType,
    taskCompleted: !error && filesFound.length > 0,
    precision: prResult.precision,
    recall: prResult.recall,
    f1Score: prResult.f1Score,
    timeToAnswerMs,
    complianceViolations: [],
    compliancePassed: true,
    filesFound,
    filesExpected: task.groundTruth.expectedFiles.map((f) => f.id),
    toolCalls,
    agentResponse,
    timestamp: new Date().toISOString(),
    modelVersion,
    error,
  };

  const violations = checkCompliance(partialResult, task);
  const compliant = isCompliant(violations);

  return {
    ...partialResult,
    complianceViolations: violations,
    compliancePassed: compliant,
    // Task is only complete if it meets thresholds AND is compliant
    taskCompleted:
      partialResult.taskCompleted &&
      compliant &&
      prResult.precision >= task.groundTruth.minimumPrecision &&
      prResult.recall >= task.groundTruth.minimumRecall,
  };
}

/**
 * Compare two task results and determine a winner
 * Simple F1-based comparison - higher F1 wins, tie if within 5%
 */
export function compareResults(
  dxrResult: TaskResult,
  baselineResult: TaskResult
): {
  winner: 'dxr' | 'baseline' | 'tie';
  reason: string;
  f1Delta: number;
  precisionDelta: number;
  recallDelta: number;
  timeDeltaMs: number;
} {
  // Calculate deltas (positive = DXR better)
  const f1Delta = dxrResult.f1Score - baselineResult.f1Score;
  const precisionDelta = dxrResult.precision - baselineResult.precision;
  const recallDelta = dxrResult.recall - baselineResult.recall;
  const timeDeltaMs = baselineResult.timeToAnswerMs - dxrResult.timeToAnswerMs;

  // Simple winner determination: higher F1 wins
  // Tie if within 5% of each other
  let winner: 'dxr' | 'baseline' | 'tie';
  let reason: string;

  if (f1Delta > 0.05) {
    winner = 'dxr';
    reason = `DXR achieved ${(f1Delta * 100).toFixed(1)}% higher F1 score`;
  } else if (f1Delta < -0.05) {
    winner = 'baseline';
    reason = `Baseline achieved ${(-f1Delta * 100).toFixed(1)}% higher F1 score`;
  } else {
    winner = 'tie';
    reason = `F1 scores within 5% (DXR: ${(dxrResult.f1Score * 100).toFixed(1)}%, Baseline: ${(baselineResult.f1Score * 100).toFixed(1)}%)`;
  }

  return {
    winner,
    reason,
    f1Delta,
    precisionDelta,
    recallDelta,
    timeDeltaMs,
  };
}

/**
 * Generate human-readable explanation for why an agent won
 */
function generateWinReason(
  winnerName: string,
  winner: TaskResult,
  loser: TaskResult,
  deltas: {
    f1Delta: number;
    precisionDelta: number;
    recallDelta: number;
    timeDeltaMs: number;
  }
): string {
  const reasons: string[] = [];

  if (winner.taskCompleted && !loser.taskCompleted) {
    reasons.push(`${winnerName} completed the task while the other did not`);
  }

  if (Math.abs(deltas.f1Delta) > 0.05) {
    reasons.push(
      `${winnerName} achieved ${(deltas.f1Delta * 100).toFixed(1)}% better F1 score`
    );
  }

  if (winner.compliancePassed && !loser.compliancePassed) {
    reasons.push(`${winnerName} passed compliance checks while the other failed`);
  }

  if (deltas.timeDeltaMs > 1000) {
    reasons.push(
      `${winnerName} was ${(deltas.timeDeltaMs / 1000).toFixed(1)}s faster`
    );
  }

  if (reasons.length === 0) {
    reasons.push(`${winnerName} had marginally better overall performance`);
  }

  return reasons.join('; ');
}

/**
 * Generate a summary of task scoring
 */
export function generateTaskSummary(result: TaskResult, task: Task): string {
  const lines = [
    `Task: ${task.name} (${task.id})`,
    `Agent: ${result.agentType.toUpperCase()}`,
    `Status: ${result.taskCompleted ? '✅ Completed' : '❌ Failed'}`,
    '',
    'Metrics:',
    `  Precision: ${(result.precision * 100).toFixed(1)}% (min: ${(task.groundTruth.minimumPrecision * 100).toFixed(0)}%)`,
    `  Recall: ${(result.recall * 100).toFixed(1)}% (min: ${(task.groundTruth.minimumRecall * 100).toFixed(0)}%)`,
    `  F1 Score: ${(result.f1Score * 100).toFixed(1)}%`,
    `  Time: ${(result.timeToAnswerMs / 1000).toFixed(2)}s`,
    '',
    'Files:',
    `  Expected: ${result.filesExpected.length}`,
    `  Found: ${result.filesFound.length}`,
    '',
    `Compliance: ${result.compliancePassed ? '✅ Passed' : `❌ ${result.complianceViolations.length} violation(s)`}`,
  ];

  if (result.error) {
    lines.push('', `Error: ${result.error}`);
  }

  return lines.join('\n');
}
