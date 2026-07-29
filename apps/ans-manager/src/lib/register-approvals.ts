import type { SubmitProgress } from "./ans";

export type RegistrationApprovalCopy = {
  heading: string;
  detail: string;
};

export function registrationApprovalCopy(
  progress: SubmitProgress | null,
  name: string | null,
): RegistrationApprovalCopy {
  const registration = name ? `register ${name}` : "register your .arch name";

  if (progress?.attempt && progress.attempt > 1) {
    return {
      heading: "One more approval — Arch Wallet used a different active account",
      detail:
        "ANS rebuilt the registration for the account that actually signed. " +
        "Your first signature was discarded here and nothing was submitted with it.",
    };
  }

  if (progress?.approvalTotal === 2) {
    if (progress.phase === "account-setup") {
      return {
        heading: "Approval 1 of 2 — create your Arch account",
        detail: `This one-time setup comes first. Next, approve once more to ${registration}.`,
      };
    }
    return {
      heading: `Approval 2 of 2 — ${registration}`,
      detail: "Your Arch account is ready. This approval registers the name.",
    };
  }

  if (progress?.approvalTotal === 1) {
    return {
      heading: `1 approval — ${registration}`,
      detail: "Approve the registration in Arch Wallet.",
    };
  }

  return {
    heading: "Usually 1 approval",
    detail:
      "If this is your account's first on-chain action, you’ll approve one-time " +
      "Arch account setup first, then approve the name registration.",
  };
}
