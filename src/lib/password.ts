import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';

let optionsSet = false;

function ensureOptions() {
  if (optionsSet) return;
  zxcvbnOptions.setOptions({
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: { ...zxcvbnCommonPackage.dictionary },
  });
  optionsSet = true;
}

export async function checkPasswordStrength(password: string, userInputs: string[] = []) {
  ensureOptions();
  const result = await zxcvbnAsync(password, userInputs);
  return {
    score: result.score as 0 | 1 | 2 | 3 | 4,
    feedback: result.feedback,
    isStrong: result.score >= 3,
  };
}
