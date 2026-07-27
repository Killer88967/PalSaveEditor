export interface HealthResponse {
  status: "ok";
  service: "palsave-api";
}

export interface SaveSession {
  id: string;
  fileName: string;
  originalSize: number;
  decompressedSize: number;
  dirty: boolean;
  revision: number;
}

export type SaveNodeKind = "object" | "array" | "scalar" | "raw";

export type SavePathSegment =
  | { type: "property"; name: string; index: number }
  | { type: "structField"; name: string; index: number }
  | { type: "arrayIndex"; index: number }
  | { type: "setIndex"; index: number }
  | { type: "mapEntry"; index: number }
  | { type: "mapKey"; index: number }
  | { type: "mapValue"; index: number };

export type ScalarPreview = boolean | number | string;
export type ScalarType =
  | "bool"
  | "int8"
  | "int16"
  | "int32"
  | "int64"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "float"
  | "double"
  | "string"
  | "name"
  | "enum";
export type EditableScalarValue =
  | { type: "bool"; value: boolean }
  | {
      type:
        | "int8"
        | "int16"
        | "int32"
        | "uint8"
        | "uint16"
        | "uint32"
        | "float"
        | "double";
      value: number;
    }
  | { type: "int64" | "uint64" | "string" | "name" | "enum"; value: string };

export interface SaveNodeSummary {
  path: SavePathSegment[];
  displayName: string;
  kind: SaveNodeKind;
  childCount?: number;
  preview?: ScalarPreview;
  byteLength?: number;
  editable: boolean;
  scalarType?: ScalarType;
  value?: EditableScalarValue;
}

export interface SaveNodeResponse {
  path: SavePathSegment[];
  kind: SaveNodeKind;
  displayName: string;
  childCount: number;
  children: SaveNodeSummary[];
  offset: number;
  limit: number;
  totalChildren: number;
  hasMore: boolean;
  preview?: ScalarPreview;
  byteLength?: number;
  editable: boolean;
  scalarType?: ScalarType;
  value?: EditableScalarValue;
}

export interface InspectSaveNodeRequest {
  path: SavePathSegment[];
  offset?: number;
  limit?: number;
}

export interface UpdateSaveScalarRequest {
  path: SavePathSegment[];
  expectedRevision: number;
  value: EditableScalarValue;
}

export interface UpdateSaveScalarResponse {
  path: SavePathSegment[];
  value: EditableScalarValue;
  dirty: boolean;
  revision: number;
}

interface DeleteSessionResponse {
  deleted: boolean;
}

interface ApiErrorResponse {
  error?: string;
  code?: string;
  currentRevision?: number;
}

export class PalSaveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "PalSaveApiError";
  }
}

async function apiError(response: Response): Promise<PalSaveApiError> {
  let body: ApiErrorResponse = {};
  try {
    body = (await response.json()) as ApiErrorResponse;
  } catch {
    // The response was not JSON.
  }
  const detail =
    body.error ?? `PalSave API request failed (${response.status})`;
  const message =
    response.status === 409 ? `Revision conflict (409): ${detail}` : detail;
  return new PalSaveApiError(message, response.status, body.currentRevision);
}

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/rust/health");

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<HealthResponse>;
}

export async function createSaveSession(
  file: File,
  signal?: AbortSignal,
): Promise<SaveSession> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/rust/sessions", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveSession>;
}

export async function getSaveSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SaveSession> {
  const response = await fetch(`/api/rust/sessions/${sessionId}`, { signal });

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveSession>;
}

export async function getSaveRoot(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SaveNodeResponse> {
  const response = await fetch(`/api/rust/sessions/${sessionId}/root`, {
    signal,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveNodeResponse>;
}

export async function inspectSaveNode(
  sessionId: string,
  request: InspectSaveNodeRequest,
  signal?: AbortSignal,
): Promise<SaveNodeResponse> {
  const response = await fetch(`/api/rust/sessions/${sessionId}/inspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveNodeResponse>;
}

export async function updateSaveScalar(
  sessionId: string,
  request: UpdateSaveScalarRequest,
  signal?: AbortSignal,
): Promise<UpdateSaveScalarResponse> {
  const response = await fetch(`/api/rust/sessions/${sessionId}/scalar`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  return response.json() as Promise<UpdateSaveScalarResponse>;
}

export async function exportSaveSession(
  sessionId: string,
  validate = true,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(
    `/api/rust/sessions/${sessionId}/export?validate=${validate}`,
    { signal },
  );

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.blob();
}

export async function deleteSaveSession(sessionId: string): Promise<boolean> {
  const response = await fetch(`/api/rust/sessions/${sessionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  const result = (await response.json()) as DeleteSessionResponse;

  return result.deleted;
}
