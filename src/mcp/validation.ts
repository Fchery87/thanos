const MAX_TOOLS_PER_SERVER = 200;
const MAX_TOOLS_PER_SESSION = 500;
const MAX_TOOL_NAME_LENGTH = 200;
const MAX_TOOL_DESCRIPTION_LENGTH = 4000;
const MAX_RESULT_SIZE = 256 * 1024; // 256 KB
const MAX_FRAME_SIZE = 4 * 1024 * 1024; // 4 MB
const MAX_TOOL_RESULT_SIZE = 128 * 1024; // 128 KB

export interface ValidationError {
  field: string;
  message: string;
}

export function validateToolName(name: string): ValidationError | undefined {
  if (typeof name !== "string" || name.length === 0) {
    return { field: "name", message: "tool name must be a non-empty string" };
  }
  if (name.length > MAX_TOOL_NAME_LENGTH) {
    return { field: "name", message: `tool name exceeds ${MAX_TOOL_NAME_LENGTH} chars` };
  }
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
    return { field: "name", message: "tool name must be alphanumeric with hyphens/underscores" };
  }
  return undefined;
}

export function validateToolCount(serverCount: number, sessionCount: number): ValidationError | undefined {
  if (serverCount > MAX_TOOLS_PER_SERVER) {
    return { field: "tools", message: `server has ${serverCount} tools, max is ${MAX_TOOLS_PER_SERVER}` };
  }
  if (sessionCount > MAX_TOOLS_PER_SESSION) {
    return { field: "tools", message: `session has ${sessionCount} tools, max is ${MAX_TOOLS_PER_SESSION}` };
  }
  return undefined;
}

export function validateToolDescription(desc: string): ValidationError | undefined {
  if (desc.length > MAX_TOOL_DESCRIPTION_LENGTH) {
    return { field: "description", message: `description exceeds ${MAX_TOOL_DESCRIPTION_LENGTH} chars` };
  }
  return undefined;
}

export function validateResultSize(size: number): ValidationError | undefined {
  if (size > MAX_RESULT_SIZE) {
    return { field: "result", message: `result size ${size} exceeds max ${MAX_RESULT_SIZE}` };
  }
  return undefined;
}

export function validateFrameSize(size: number): ValidationError | undefined {
  if (size > MAX_FRAME_SIZE) {
    return { field: "frame", message: `frame size ${size} exceeds max ${MAX_FRAME_SIZE}` };
  }
  return undefined;
}

export function validateToolResultSize(size: number): ValidationError | undefined {
  if (size > MAX_TOOL_RESULT_SIZE) {
    return { field: "tool_result", message: `tool result size ${size} exceeds max ${MAX_TOOL_RESULT_SIZE}` };
  }
  return undefined;
}
