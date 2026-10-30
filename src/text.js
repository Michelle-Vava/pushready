// Wording helpers shared by more than one module. Deliberately tiny: anything
// that lays text out for a person belongs in the CLI. This is only for words
// that end up inside a finding's message, where every module has to agree.
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
