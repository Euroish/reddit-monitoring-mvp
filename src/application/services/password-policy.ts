export const NEW_PASSWORD_POLICY_MESSAGE = "Password must be 12–128 characters";

/** Applies to newly created credentials only; existing passwords remain valid for login. */
export function isValidNewPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
