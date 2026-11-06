// The password rules, matching the API's passwordSchema (api/src/schemas/common.schema.ts), so a form can point out a
// weak password before sending it. The API checks again either way.
export const PASSWORD_HINT = "At least 10 characters, with a letter and a number.";

export function passwordProblem(password: string): string | null {
  if (password.length > 256) return "At most 256 characters.";
  return password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) ? PASSWORD_HINT : null;
}
