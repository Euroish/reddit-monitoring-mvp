export class AppError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export function fail(statusCode: number, message: string): never {
  throw new AppError(statusCode, message);
}
