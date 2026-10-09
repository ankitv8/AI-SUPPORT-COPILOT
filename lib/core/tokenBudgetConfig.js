export const DEFAULT_USER_TOKEN_BUDGET = 100_000

function readTokenBudget(name, defaultValue) {
  const configuredValue = process.env[name]
  if (configuredValue === undefined || configuredValue.trim() === '') return defaultValue

  const budget = Number(configuredValue)
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new Error(`${name} must be a positive whole number.`)
  }
  return budget
}

export function getUserTokenBudget() {
  return readTokenBudget('USER_TOKEN_BUDGET', DEFAULT_USER_TOKEN_BUDGET)
}
