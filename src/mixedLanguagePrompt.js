import { extractTodoTask } from './todoTaskExtract.js'

export { MIXED_LANGUAGE_AI_RULE } from './aiPrompts.js'

/**
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function normalizeTodoTaskTitle(input) {
  const { title } = await extractTodoTask(input)
  const trimmed = input.trim()
  return title || trimmed
}
