export type EditConfirmationPayload = {
  confirmationLines: string[];
  infoLines: string[];
};

const CONFIRM_EDIT_EFFECTS_MARKER = "CONFIRM_EDIT_EFFECTS::";

function readJsonObject(source: string) {
  const start = source.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function parseEditConfirmationFromErrorMessage(
  message: string,
): EditConfirmationPayload | null {
  const markerIndex = message.indexOf(CONFIRM_EDIT_EFFECTS_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const jsonObject = readJsonObject(
    message.slice(markerIndex + CONFIRM_EDIT_EFFECTS_MARKER.length),
  );
  if (!jsonObject) {
    return null;
  }

  try {
    const payload = JSON.parse(jsonObject) as Record<string, unknown>;
    return {
      confirmationLines: toStringArray(payload.confirmationLines),
      infoLines: toStringArray(payload.infoLines),
    };
  } catch {
    return null;
  }
}
