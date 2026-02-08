/**
 * Precision/Recall Calculator
 *
 * Calculates information retrieval metrics for benchmark evaluation.
 */

import type { ExpectedFile } from '../types.js';

export interface PrecisionRecallResult {
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
}

/**
 * Calculate precision, recall, and F1 score
 *
 * @param foundFiles - File IDs returned by the agent
 * @param expectedFiles - Ground truth expected files with relevance scores
 * @param relevanceThreshold - Minimum relevance score to count as "expected" (default: 0.5)
 */
export function calculatePrecisionRecall(
  foundFiles: string[],
  expectedFiles: ExpectedFile[],
  relevanceThreshold = 0.5
): PrecisionRecallResult {
  // Get set of expected file IDs (filtered by relevance threshold)
  const expectedSet = new Set(
    expectedFiles
      .filter((f) => f.relevance >= relevanceThreshold)
      .map((f) => f.id)
  );

  const foundSet = new Set(foundFiles);

  // Calculate true positives (found AND expected)
  const truePositives = foundFiles.filter((f) => expectedSet.has(f));

  // Calculate false positives (found but NOT expected)
  const falsePositives = foundFiles.filter((f) => !expectedSet.has(f));

  // Calculate false negatives (expected but NOT found)
  const falseNegatives = Array.from(expectedSet).filter(
    (f) => !foundSet.has(f)
  );

  // Calculate metrics
  const tp = truePositives.length;
  const fp = falsePositives.length;
  const fn = falseNegatives.length;

  // Precision = TP / (TP + FP)
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;

  // Recall = TP / (TP + FN)
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

  // F1 = 2 * (P * R) / (P + R)
  const f1Score =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  return {
    precision,
    recall,
    f1Score,
    truePositives,
    falsePositives,
    falseNegatives,
  };
}

/**
 * Calculate weighted precision using relevance scores
 *
 * @param foundFiles - File IDs returned by the agent
 * @param expectedFiles - Ground truth expected files with relevance scores
 */
export function calculateWeightedPrecision(
  foundFiles: string[],
  expectedFiles: ExpectedFile[]
): number {
  if (foundFiles.length === 0) return 0;

  const expectedMap = new Map(expectedFiles.map((f) => [f.id, f.relevance]));

  let weightedSum = 0;
  for (const fileId of foundFiles) {
    // If found file is expected, add its relevance; otherwise add 0
    weightedSum += expectedMap.get(fileId) || 0;
  }

  // Maximum possible score would be if all found files had relevance 1.0
  return weightedSum / foundFiles.length;
}

/**
 * Calculate weighted recall using relevance scores
 *
 * @param foundFiles - File IDs returned by the agent
 * @param expectedFiles - Ground truth expected files with relevance scores
 */
export function calculateWeightedRecall(
  foundFiles: string[],
  expectedFiles: ExpectedFile[]
): number {
  if (expectedFiles.length === 0) return 1; // Nothing to find = perfect recall

  const foundSet = new Set(foundFiles);
  const totalRelevance = expectedFiles.reduce((sum, f) => sum + f.relevance, 0);

  if (totalRelevance === 0) return 1;

  let foundRelevance = 0;
  for (const expected of expectedFiles) {
    if (foundSet.has(expected.id)) {
      foundRelevance += expected.relevance;
    }
  }

  return foundRelevance / totalRelevance;
}

/**
 * Determine if a task meets minimum precision/recall thresholds
 */
export function meetsThresholds(
  result: PrecisionRecallResult,
  minPrecision: number,
  minRecall: number
): {
  meetsPrecision: boolean;
  meetsRecall: boolean;
  meetsAll: boolean;
} {
  return {
    meetsPrecision: result.precision >= minPrecision,
    meetsRecall: result.recall >= minRecall,
    meetsAll:
      result.precision >= minPrecision && result.recall >= minRecall,
  };
}

/**
 * Generate human-readable summary of precision/recall results
 */
export function generateSummary(result: PrecisionRecallResult): string {
  const lines = [
    `Precision: ${(result.precision * 100).toFixed(1)}%`,
    `Recall: ${(result.recall * 100).toFixed(1)}%`,
    `F1 Score: ${(result.f1Score * 100).toFixed(1)}%`,
    '',
    `True Positives (${result.truePositives.length}): ${result.truePositives.join(', ') || 'none'}`,
    `False Positives (${result.falsePositives.length}): ${result.falsePositives.join(', ') || 'none'}`,
    `False Negatives (${result.falseNegatives.length}): ${result.falseNegatives.join(', ') || 'none'}`,
  ];

  return lines.join('\n');
}
