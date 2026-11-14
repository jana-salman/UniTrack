export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}
