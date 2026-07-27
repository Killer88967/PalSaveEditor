export interface HealthResponse {
  status: "ok";
  service: "palsave-api";
}

export interface SaveSession {
  id: string;
  fileName: string;
  originalSize: number;
  decompressedSize: number;
}

export type SaveNodeKind = "object" | "array" | "scalar" | "raw";

export interface SaveNodeSummary {
  key: string;
  kind: SaveNodeKind;
  childCount?: number;
}

export interface SaveRootNode {
  path: string[];
  kind: SaveNodeKind;
  childCount: number;
  children: SaveNodeSummary[];
}

interface DeleteSessionResponse {
  deleted: boolean;
}

interface ApiErrorResponse {
  error?: string;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorResponse;

    if (body.error) {
      return body.error;
    }
  } catch {
    // The response was not JSON.
  }

  return `PalSave API request failed (${response.status})`;
}

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/rust/health");

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<HealthResponse>;
}

export async function createSaveSession(file: File): Promise<SaveSession> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/rust/sessions", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<SaveSession>;
}

export async function getSaveSession(sessionId: string): Promise<SaveSession> {
  const response = await fetch(`/api/rust/sessions/${sessionId}`);

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<SaveSession>;
}

export async function getSaveRoot(sessionId: string): Promise<SaveRootNode> {
  const response = await fetch(`/api/rust/sessions/${sessionId}/root`);

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.json() as Promise<SaveRootNode>;
}

export async function exportSaveSession(sessionId: string): Promise<Blob> {
  const response = await fetch(`/api/rust/sessions/${sessionId}/export`);

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return response.blob();
}

export async function deleteSaveSession(sessionId: string): Promise<boolean> {
  const response = await fetch(`/api/rust/sessions/${sessionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  const result = (await response.json()) as DeleteSessionResponse;

  return result.deleted;
}