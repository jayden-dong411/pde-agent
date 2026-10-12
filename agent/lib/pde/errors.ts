export class PdeError extends Error {
  override readonly name = "PdeError";

  constructor(message: string) {
    super(message);
  }
}
