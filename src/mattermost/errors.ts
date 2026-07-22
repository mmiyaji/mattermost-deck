export type MattermostApiMethod = "GET" | "POST";

export class MattermostApiError extends Error {
  readonly method: MattermostApiMethod;
  readonly pathname: string;
  readonly status: number;

  constructor(method: MattermostApiMethod, pathname: string, status: number) {
    // Keep the message machine-oriented so presentation layers must localize it.
    // The numeric status remains present for compatibility with legacy /401/
    // checks while callers migrate to getMattermostApiErrorStatus().
    super(`mattermost_api_error:${status}:${method}:${pathname}`);
    this.name = "MattermostApiError";
    this.method = method;
    this.pathname = pathname;
    this.status = status;
  }
}

export function getMattermostApiErrorStatus(error: unknown): number | null {
  return error instanceof MattermostApiError ? error.status : null;
}

export function isMattermostApiError(error: unknown): error is MattermostApiError {
  return error instanceof MattermostApiError;
}
