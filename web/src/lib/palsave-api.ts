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

export type PalParseStatus = "complete" | "partial" | "unsupported";

export interface PalSummary {
  id: string;
  mapIndex: number;
  instanceId?: string;
  characterId?: string;
  nickname?: string;
  level?: number;
  rank?: number;
  gender?: string;
  ownerPlayerUid?: string;
  isPlayer: boolean;
  parseStatus: PalParseStatus;
  rawPath: SavePathSegment[];
}

export interface PalListResponse {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: PalSummary[];
}

export interface PalEditCapabilities {
  nickname: boolean;
  level: boolean;
  rank: boolean;
  gender: boolean;
  rankHp: boolean;
  rankAttack: boolean;
  rankDefence: boolean;
  rankCraftSpeed: boolean;
  talentHp: boolean;
  talentMelee: boolean;
  talentShot: boolean;
  talentDefense: boolean;
  passiveSkills: boolean;
  activeSkills: boolean;
}
export type FieldUpdate<T> = { value: T };
export interface UpdatePalRequest {
  expectedRevision: number;
  nickname?: FieldUpdate<string>;
  level?: FieldUpdate<number>;
  rank?: FieldUpdate<number>;
  gender?: FieldUpdate<string>;
  rankHp?: FieldUpdate<number>;
  rankAttack?: FieldUpdate<number>;
  rankDefence?: FieldUpdate<number>;
  rankCraftSpeed?: FieldUpdate<number>;
  talentHp?: FieldUpdate<number>;
  talentMelee?: FieldUpdate<number>;
  talentShot?: FieldUpdate<number>;
  talentDefense?: FieldUpdate<number>;
  passiveSkills?: FieldUpdate<string[]>;
  activeSkills?: FieldUpdate<string[]>;
}
export interface UpdatePalResponse {
  pal: PalDetail;
  dirty: boolean;
  revision: number;
}

export interface PalDetail extends PalSummary {
  rankHp?: number;
  rankAttack?: number;
  rankDefence?: number;
  rankCraftSpeed?: number;
  talentHp?: number;
  talentMelee?: number;
  talentShot?: number;
  talentDefense?: number;
  passiveSkills: string[];
  activeSkills: string[];
  missingFields: string[];
  editCapabilities: PalEditCapabilities;
}

export interface GetPalsQuery {
  offset?: number;
  limit?: number;
  search?: string;
  characterId?: string;
  ownerPlayerUid?: string;
  gender?: string;
  minLevel?: number;
  maxLevel?: number;
  includePlayers?: boolean;
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
  fields?: Record<string, string>;
  error?: string;
  code?: string;
  currentRevision?: number;
}

export class PalSaveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly currentRevision?: number,
    public readonly fields?: Record<string, string>,
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
  return new PalSaveApiError(
    message,
    response.status,
    body.currentRevision,
    body.fields,
  );
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

export async function getPals(
  sessionId: string,
  query: GetPalsQuery = {},
  signal?: AbortSignal,
): Promise<PalListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/pals${suffix}`,
    { signal },
  );
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<PalListResponse>;
}

export async function getPal(
  sessionId: string,
  palId: string,
  signal?: AbortSignal,
): Promise<PalDetail> {
  const response = await fetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/pals/${encodeURIComponent(palId)}`,
    { signal },
  );
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<PalDetail>;
}

export async function updatePal(
  sessionId: string,
  palId: string,
  request: UpdatePalRequest,
  signal?: AbortSignal,
): Promise<UpdatePalResponse> {
  const response = await fetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/pals/${encodeURIComponent(palId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<UpdatePalResponse>;
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
