export class RendererError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly category: string,
    public readonly details: string[] = [],
  ) {
    super(details.length ? `${message}: ${details.join("; ")}` : message);
    this.name = "RendererError";
  }
}

export const invalid = (message: string, details: string[] = []) =>
  new RendererError(message, 2, "invalid_input", details);
export const unsupported = (message: string, details: string[] = []) =>
  new RendererError(message, 3, "unsupported", details);
export const policy = (message: string, details: string[] = []) =>
  new RendererError(message, 4, "policy_or_validation_failure", details);
export const migrationRequired = (message: string, details: string[] = []) =>
  new RendererError(message, 3, "migration_required", details);
