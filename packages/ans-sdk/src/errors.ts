export type AnsErrorCode =
  | "InvalidSuffix"
  | "InvalidLabelLength"
  | "InvalidLabelCharacter"
  | "InvalidHyphenPlacement"
  | "InvalidDiscriminator"
  | "UnsupportedAccountVersion"
  | "InvalidAccountDerivation"
  | "NameMismatch"
  | "InactiveName"
  | "StaleRecord"
  | "RecordTypeMismatch"
  | "OwnerRecordMismatch"
  | "InvalidTaprootAddress"
  | "InvalidTokenAta"
  | "RecordValueTooLarge"
  | "InvalidReverseBinding"
  | "CodecError"
  | "AccountNotFound"
  | "IncorrectProgramId"
  | "ManifestMismatch";

export class AnsError extends Error {
  readonly code: AnsErrorCode;

  constructor(code: AnsErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AnsError";
    this.code = code;
  }
}
