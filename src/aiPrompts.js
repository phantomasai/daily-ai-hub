/** Shared rule for all AI interpretation of user text/voice input. */
export const MIXED_LANGUAGE_AI_RULE = [
  'You may receive mixed Polish, English, and Spanish input.',
  'Interpret it semantically by meaning, not by surface language mixing.',
  'Do not reject or misunderstand phrases because languages are mixed.',
  'Preserve the user\'s intended meaning.',
  'Do not copy mixed-language instruction fragments into final outputs unless the user explicitly asks.',
].join(' ')
