export class ResponseSchemaError extends Error {
  constructor(cause: unknown) {
    super(
      "This app can't read the machine's latest data. Reload the app to pick up updates.",
      { cause },
    );
    this.name = "ResponseSchemaError";
  }
}

export function needsAppReload(error: unknown) {
  return error instanceof ResponseSchemaError;
}

export function parseApiResponse<T>(
  parse: (value: unknown) => T,
  value: unknown,
) {
  try {
    return parse(value);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError")
      throw new ResponseSchemaError(error);
    throw error;
  }
}
