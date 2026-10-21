// Every tunable constant lives here, with where it comes from.

// Database client. Source: project rules, Stack section ("small max, 1 to 3", pooler in
// transaction mode so prepared statements are off).
export const DB = {
  poolMax: 3,
  // Not given by the rules; a short, plain limit so a dead database fails fast on serverless.
  connectTimeoutSeconds: 10,
};
