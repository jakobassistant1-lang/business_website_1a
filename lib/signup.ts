// Invite-only signup gate. Public signup is OPEN only when SIGNUP_INVITE_CODE
// is set; new accounts must then present the matching code. With no code
// configured, signup is fully closed and accounts are admin-created (see
// scripts/create-user.mjs). Either way satisfies "locked signup".
export function signupInviteCode(): string {
  return (process.env.SIGNUP_INVITE_CODE ?? "").trim();
}

export function isSignupOpen(): boolean {
  return signupInviteCode().length > 0;
}
