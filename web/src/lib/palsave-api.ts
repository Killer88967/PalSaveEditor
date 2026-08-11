export interface HealthResponse {
  status: "ok";
  service: "palsave-api";
}

/** The 12-byte Palworld container header, decoded. */
export interface SavContainer {
  /** `PlZ` for zlib saves, `PlM` for Oodle Kraken saves. */
  magic: string;
  /** Codec selector byte following the magic. */
  saveType: number;
  compression: string;
  decompressedSize: number;
  compressedSize: number;
}

export interface SaveSession {
  id: string;
  fileName: string;
  originalSize: number;
  decompressedSize: number;
  dirty: boolean;
  revision: number;
  playerFileCount: number;
  container: SavContainer;
}

export interface CollectionSummary {
  name: string;
  kind: "map" | "array" | "struct" | "raw" | "scalar";
  entryCount?: number;
  byteLength?: number;
}

export interface CharacterStats {
  total: number;
  pals: number;
  players: number;
  nicknamed: number;
  complete: number;
  partial: number;
  unsupported: number;
  averagePalLevel?: number;
  maxPalLevel?: number;
  distinctSpecies: number;
}

export interface SpeciesCount {
  characterId: string;
  count: number;
}

export interface LevelBucket {
  label: string;
  count: number;
}

export interface PalHighlight {
  id: string;
  nickname?: string;
  characterId?: string;
  level?: number;
  rank?: number;
}

export interface PlayerOverview {
  playerUid: string;
  nickname?: string;
  level?: number;
  palCount: number;
  hasSaveFile: boolean;
}

export interface SaveOverview {
  saveGameType: string;
  engineVersion: string;
  saveGameVersion: number;
  rootPropertyCount: number;
  worldCollections: CollectionSummary[];
  characters: CharacterStats;
  topSpecies: SpeciesCount[];
  levelHistogram: LevelBucket[];
  strongest: PalHighlight[];
  players: PlayerOverview[];
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
  /** `PlayerUId` from the map key: set on players and player-owned Pals. */
  playerUid?: string;
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
  characterId: boolean;
  nickname: boolean;
  level: boolean;
  rank: boolean;
  isRare: boolean;
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
  characterId?: FieldUpdate<string>;
  nickname?: FieldUpdate<string>;
  level?: FieldUpdate<number>;
  rank?: FieldUpdate<number>;
  isRare?: FieldUpdate<boolean>;
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
  /** Absent on Pals that have never carried the `IsRarePal` property. */
  isRare?: boolean;
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

export interface BulkPalResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface BulkUpdatePalResponse {
  results: BulkPalResult[];
  succeeded: number;
  failed: number;
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

// --- transparent session recovery -------------------------------------------
// A Render restart drops in-memory sessions ("session not found"). Keep the
// uploaded file, silently rebuild the session, then retry the same request.
const rawFetch = globalThis.fetch.bind(globalThis);
const SESSION_URL = /\/api\/rust\/sessions\/([0-9a-fA-F-]{36})(?:\/|$)/;

let recoveryFiles: File[] = [];
let onRecovered: ((session: SaveSession) => void) | null = null;
let recoveryInFlight: Promise<SaveSession> | null = null;

/** Call after opening a save so an expired session can be rebuilt from the upload. */
export function registerSessionRecovery(
  files: File[],
  onSession: (session: SaveSession) => void,
) {
  recoveryFiles = files;
  onRecovered = onSession;
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await rawFetch(input, init);
  const match = input.match(SESSION_URL);
  if (
    response.ok ||
    !match ||
    recoveryFiles.length === 0 ||
    init?.body instanceof FormData
  ) {
    return response;
  }
  const text = await response.clone().text();
  if (
    response.status !== 404 ||
    !/session/i.test(text) ||
    !/not found/i.test(text)
  ) {
    return response;
  }
  // Rebuild once even if several requests fail at the same time.
  if (!recoveryInFlight) {
    recoveryInFlight = createSaveSession(recoveryFiles)
      .then((session) => {
        onRecovered?.(session);
        return session;
      })
      .finally(() => {
        recoveryInFlight = null;
      });
  }
  let rebuilt: SaveSession;
  try {
    rebuilt = await recoveryInFlight;
  } catch {
    return response; // recovery failed — surface the original error
  }
  return rawFetch(input.replace(match[1], rebuilt.id), init); // retry against the new id
}

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await apiFetch("/api/rust/health");

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<HealthResponse>;
}

export async function createSaveSession(
  files: File[],
  signal?: AbortSignal,
): Promise<SaveSession> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);

  const response = await apiFetch("/api/rust/sessions", {
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
  const response = await apiFetch(`/api/rust/sessions/${sessionId}`, {
    signal,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveSession>;
}

export async function getSaveRoot(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SaveNodeResponse> {
  const response = await apiFetch(`/api/rust/sessions/${sessionId}/root`, {
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
  const response = await apiFetch(`/api/rust/sessions/${sessionId}/inspect`, {
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
  const response = await apiFetch(`/api/rust/sessions/${sessionId}/scalar`, {
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

export async function getSaveOverview(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SaveOverview> {
  const response = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/overview`,
    { signal },
  );

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.json() as Promise<SaveOverview>;
}

export async function exportSaveSession(
  sessionId: string,
  validate = true,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await apiFetch(
    `/api/rust/sessions/${sessionId}/export?validate=${validate}`,
    { signal },
  );

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.blob();
}

/** Downloads the session's current tree as uncompressed GVAS. */
export async function exportSaveSessionGvas(
  sessionId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/gvas`,
    { signal },
  );

  if (!response.ok) {
    throw await apiError(response);
  }

  return response.blob();
}

export interface ConversionResult {
  blob: Blob;
  fileName: string;
  compression?: string;
  decompressedSize?: number;
}

/** Decompresses a `.sav` into raw GVAS without opening a session. */
export function decompileSav(
  file: File,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  return convert("decompile", file, signal);
}

/** Compresses raw GVAS back into a `.sav` container. */
export function recompileGvas(
  file: File,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  return convert("recompile", file, signal);
}

async function convert(
  operation: "decompile" | "recompile",
  file: File,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const body = new FormData();
  body.append("file", file);

  const response = await apiFetch(`/api/rust/convert/${operation}`, {
    method: "POST",
    body,
    signal,
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  const size = Number(response.headers.get("x-palsave-decompressed-size"));

  return {
    blob: await response.blob(),
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition"),
      operation === "decompile" ? "Level.gvas" : "Level.sav",
    ),
    compression: response.headers.get("x-palsave-compression") ?? undefined,
    decompressedSize: Number.isFinite(size) && size > 0 ? size : undefined,
  };
}

function fileNameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
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
  const response = await apiFetch(
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
  const response = await apiFetch(
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
  const response = await apiFetch(
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

export async function bulkUpdatePals(
  sessionId: string,
  request: {
    expectedRevision: number;
    ids: string[];
    fields: Record<string, FieldUpdate<number>>;
    addPassiveSkills: string[];
  },
): Promise<BulkUpdatePalResponse> {
  const response = await apiFetch(`/api/rust/sessions/${sessionId}/pals/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await apiError(response);
  return response.json();
}

export async function deleteSaveSession(sessionId: string): Promise<boolean> {
  const response = await apiFetch(`/api/rust/sessions/${sessionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  const result = (await response.json()) as DeleteSessionResponse;

  return result.deleted;
}

export interface ContainerReference {
  kind: string;
  containerId: string;
}
export interface PlayerInventoryOwner {
  playerUid: string;
  fileName: string;
  nickname?: string;
  personalContainers: ContainerReference[];
}
export interface InventorySlot {
  /** Position in the stored slot array — how a slot is addressed. */
  index: number;
  /** The in-game slot the entry occupies. Saves store occupied slots only. */
  slotIndex?: number;
  itemId?: string;
  quantity?: number;
  editable: boolean;
  /** Carries durability/ammo data, so its item id cannot be swapped. */
  dynamic: boolean;
}
export interface InventoryContainer {
  kind: string;
  containerId: string;
  /** Slots the game gives this container; `slots.length` is what is used. */
  capacity: number;
  slots: InventorySlot[];
}
export interface UpdateInventorySlotRequest {
  expectedRevision: number;
  itemId?: string;
  quantity?: number;
}
export interface UpdateInventorySlotResponse {
  slot: InventorySlot;
  dirty: boolean;
  revision: number;
}
export interface AddInventoryItemRequest {
  expectedRevision: number;
  itemId: string;
  quantity: number;
  /** Defaults to the lowest free slot in the container. */
  slotIndex?: number;
}
export interface AddInventoryItemResponse {
  slot: InventorySlot;
  /** Item whose durability record was copied for the new stack, if any. */
  dynamicSource: string | null;
  warning?: string;
  dirty: boolean;
  revision: number;
}
export interface KnownItem {
  itemId: string;
  stacks: number;
  totalQuantity: number;
  hasDynamicTemplate: boolean;
}
export async function getInventoryPlayers(
  sessionId: string,
  signal?: AbortSignal,
): Promise<PlayerInventoryOwner[]> {
  const r = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/players`,
    { signal },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
export async function getPlayerInventory(
  sessionId: string,
  playerUid: string,
  signal?: AbortSignal,
): Promise<InventoryContainer[]> {
  const r = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/players/${encodeURIComponent(playerUid)}/inventory`,
    { signal },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
export async function updateInventorySlot(
  sessionId: string,
  playerUid: string,
  containerId: string,
  index: number,
  request: UpdateInventorySlotRequest,
  signal?: AbortSignal,
): Promise<UpdateInventorySlotResponse> {
  const r = await apiFetch(
    `${slotsUrl(sessionId, playerUid, containerId)}/${index}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
export async function addInventoryItem(
  sessionId: string,
  playerUid: string,
  containerId: string,
  request: AddInventoryItemRequest,
  signal?: AbortSignal,
): Promise<AddInventoryItemResponse> {
  const r = await apiFetch(slotsUrl(sessionId, playerUid, containerId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!r.ok) throw await apiError(r);
  return r.json();
}
/** Deletes the slot entry outright, which is how a save records an empty slot. */
export async function removeInventorySlot(
  sessionId: string,
  playerUid: string,
  containerId: string,
  index: number,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<UpdateInventorySlotResponse> {
  const r = await apiFetch(
    `${slotsUrl(sessionId, playerUid, containerId)}/${index}?expectedRevision=${expectedRevision}`,
    { method: "DELETE", signal },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
/** Item ids the uploaded world actually contains, commonest first. */
export async function getKnownItems(
  sessionId: string,
  signal?: AbortSignal,
): Promise<KnownItem[]> {
  const r = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/items`,
    { signal },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
function slotsUrl(sessionId: string, playerUid: string, containerId: string) {
  return `/api/rust/sessions/${encodeURIComponent(sessionId)}/players/${encodeURIComponent(playerUid)}/inventory/${encodeURIComponent(containerId)}/slots`;
}

export interface PlayerStatusPoint {
  /** `StatusName` as the save stores it (Japanese); updates key off this. */
  name: string;
  /** English rendering of `name`, falling back to the raw name. */
  label: string;
  point?: number;
  editable: boolean;
}
export interface PlayerEditCapabilities {
  level: boolean;
  exp: boolean;
  unusedStatusPoint: boolean;
  statusPoints: boolean;
  exStatusPoints: boolean;
}
export interface PlayerDetail {
  id: string;
  mapIndex: number;
  playerUid?: string;
  instanceId?: string;
  nickname?: string;
  level?: number;
  /** Ceiling the `Level` property can store — the only limit on level edits. */
  maxLevel?: number;
  exp?: number;
  unusedStatusPoint?: number;
  statusPoints: PlayerStatusPoint[];
  exStatusPoints: PlayerStatusPoint[];
  missingFields: string[];
  editCapabilities: PlayerEditCapabilities;
  rawPath: SavePathSegment[];
}
export interface StatusPointUpdate {
  name: string;
  value: number;
}
export interface UpdatePlayerRequest {
  expectedRevision: number;
  level?: FieldUpdate<number>;
  exp?: FieldUpdate<number>;
  unusedStatusPoint?: FieldUpdate<number>;
  statusPoints?: FieldUpdate<StatusPointUpdate[]>;
  exStatusPoints?: FieldUpdate<StatusPointUpdate[]>;
}
export interface UpdatePlayerResponse {
  player: PlayerDetail;
  dirty: boolean;
  revision: number;
}
/** Every player in the world file, whether or not their .sav was uploaded. */
export async function getPlayerStats(
  sessionId: string,
  signal?: AbortSignal,
): Promise<PlayerDetail[]> {
  const r = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/player-stats`,
    { signal },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
export async function updatePlayerStats(
  sessionId: string,
  playerUid: string,
  request: UpdatePlayerRequest,
  signal?: AbortSignal,
): Promise<UpdatePlayerResponse> {
  const r = await apiFetch(
    `/api/rust/sessions/${encodeURIComponent(sessionId)}/player-stats/${encodeURIComponent(playerUid)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!r.ok) throw await apiError(r);
  return r.json();
}
