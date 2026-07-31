use axum::{
    Json,
    Router,
    body::Body,
    extract::{
        DefaultBodyLimit,
        Multipart,
        Path,
        Query,
        State,
        rejection::{ JsonRejection, QueryRejection },
    },
    http::{ HeaderName, HeaderValue, StatusCode, header::{ CONTENT_DISPOSITION, CONTENT_TYPE } },
    response::{ IntoResponse, Response },
    routing::{ get, patch, post },
};
use dashmap::DashMap;
use serde::{ Deserialize, Serialize };
use std::{ collections::BTreeMap, env, sync::{ Arc, Mutex } };
use tower_http::trace::TraceLayer;
use uesave::Save;
use uuid::Uuid;

mod inventory;
mod nodes;
mod overview;
mod pals;

const DEFAULT_PORT: u16 = 47_831;
const MAX_UPLOAD_SIZE: usize = 512 * 1024 * 1024;
const DEFAULT_MAX_DECOMPRESSED_SIZE: usize = 2 * 1024 * 1024 * 1024;

type SessionStore = Arc<DashMap<Uuid, SaveSession>>;

struct AppState {
    sessions: SessionStore,
    max_decompressed_size: usize,
}

struct SaveSession {
    file_name: String,
    original_size: usize,
    decompressed_size: usize,
    container: palsave_core::SavContainer,
    save: Arc<Mutex<SaveSessionData>>,
}

struct SaveSessionData {
    save: Save,
    dirty: bool,
    revision: u64,
    pal_index: Option<pals::PalIndexCache>,
    player_saves: Vec<inventory::PlayerSaveFile>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    id: Uuid,
    file_name: String,
    original_size: usize,
    decompressed_size: usize,
    dirty: bool,
    revision: u64,
    player_file_count: usize,
    container: palsave_core::SavContainer,
}

#[derive(Debug, Deserialize)]
struct PageQuery {
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PalsQuery {
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
    search: Option<String>,
    character_id: Option<String>,
    owner_player_uid: Option<String>,
    gender: Option<String>,
    min_level: Option<i32>,
    max_level: Option<i32>,
    #[serde(default)]
    include_players: bool,
}

#[derive(Debug, Serialize)]
struct DeleteSessionResponse {
    deleted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<BTreeMap<String, String>>,
}

#[derive(Debug)]
enum ApiError {
    BadRequest(String),
    Validation(BTreeMap<String, String>),
    NotFound(String),
    PayloadTooLarge(String),
    Conflict {
        message: String,
        current_revision: u64,
    },
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message, code, current_revision, fields) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message, None, None, None),
            Self::Validation(fields) =>
                (
                    StatusCode::BAD_REQUEST,
                    "Pal update validation failed".to_string(),
                    Some("validationError"),
                    None,
                    Some(fields),
                ),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message, None, None, None),
            Self::PayloadTooLarge(message) => {
                (StatusCode::PAYLOAD_TOO_LARGE, message, None, None, None)
            }
            Self::Conflict { message, current_revision } =>
                (
                    StatusCode::CONFLICT,
                    message,
                    Some("revisionConflict"),
                    Some(current_revision),
                    None,
                ),
            Self::Internal(message) => {
                (StatusCode::INTERNAL_SERVER_ERROR, message, None, None, None)
            }
        };
        (
            status,
            Json(ErrorResponse {
                error: message,
                code,
                current_revision,
                fields,
            }),
        ).into_response()
    }
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "palsave-api",
    })
}

async fn create_session(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart
) -> Result<(StatusCode, Json<SessionResponse>), ApiError> {
    let mut uploads = Vec::new();
    let mut total_size = 0usize;
    while
        let Some(field) = multipart
            .next_field().await
            .map_err(|e| ApiError::BadRequest(format!("invalid multipart upload: {e}")))?
    {
        if !matches!(field.name(), Some("file" | "files")) {
            continue;
        }
        let file_name = field
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Level.sav".into());
        // Read the field before validating its name. Responding while the
        // client is still uploading resets the stream, and a reverse proxy
        // reports that as a 500 instead of forwarding this 400.
        let bytes = field
            .bytes().await
            .map_err(|e| ApiError::BadRequest(format!("failed to read {file_name}: {e}")))?;
        if !file_name.to_ascii_lowercase().ends_with(".sav") {
            return Err(ApiError::BadRequest(format!("{file_name} is not a .sav file")));
        }
        total_size = total_size
            .checked_add(bytes.len())
            .ok_or_else(|| ApiError::PayloadTooLarge("combined upload size overflow".into()))?;
        if total_size > MAX_UPLOAD_SIZE {
            return Err(
                ApiError::PayloadTooLarge(
                    format!("combined upload is too large: {total_size} bytes")
                )
            );
        }
        uploads.push((file_name, bytes.to_vec()));
    }
    if uploads.is_empty() {
        return Err(ApiError::BadRequest("missing multipart fields named `file` or `files`".into()));
    }
    let level_index = uploads
        .iter()
        .position(|(name, _)| {
            name.rsplit(['/', '\\'])
                .next()
                .is_some_and(|base| base.eq_ignore_ascii_case("Level.sav"))
        })
        .ok_or_else(|| ApiError::BadRequest("the upload must include Level.sav".into()))?;
    let max = state.max_decompressed_size;
    let parsed = tokio::task
        ::spawn_blocking(move || {
            let mut level = None;
            let mut players = Vec::new();
            let mut level_size = 0;
            let mut level_decompressed = 0;
            let mut level_container = None;
            for (index, (name, bytes)) in uploads.into_iter().enumerate() {
                let parsed = palsave_core
                    ::parse_sav_with_metadata_limit(&bytes, max)
                    .map_err(|e| format!("failed to parse {name}: {e}"))?;
                if index == level_index {
                    level_size = bytes.len();
                    level_decompressed = parsed.decompressed_size;
                    level_container = Some(parsed.container);
                    level = Some((name, parsed.save));
                } else {
                    players.push(inventory::PlayerSaveFile {
                        file_name: name,
                        save: parsed.save,
                    });
                }
            }
            let (name, save) = level.ok_or_else(|| "Level.sav was not parsed".to_string())?;
            let container = level_container.ok_or_else(||
                "Level.sav header was not read".to_string()
            )?;
            Ok::<_, String>((name, level_size, level_decompressed, container, save, players))
        }).await
        .map_err(|e| ApiError::Internal(format!("save parser task failed: {e}")))?
        .map_err(ApiError::BadRequest)?;
    let (file_name, original_size, decompressed_size, container, save, player_saves) = parsed;
    let player_file_count = player_saves.len();
    let id = Uuid::new_v4();
    state.sessions.insert(id, SaveSession {
        file_name: file_name.clone(),
        original_size,
        decompressed_size,
        container: container.clone(),
        save: Arc::new(
            Mutex::new(SaveSessionData {
                save,
                dirty: false,
                revision: 0,
                pal_index: None,
                player_saves,
            })
        ),
    });
    Ok((
        StatusCode::CREATED,
        Json(SessionResponse {
            id,
            file_name,
            original_size,
            decompressed_size,
            dirty: false,
            revision: 0,
            player_file_count,
            container,
        }),
    ))
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<SessionResponse>, ApiError> {
    let (file_name, original_size, decompressed_size, container, save) = state.sessions
        .get(&id)
        .map(|session| {
            (
                session.file_name.clone(),
                session.original_size,
                session.decompressed_size,
                session.container.clone(),
                Arc::clone(&session.save),
            )
        })
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let (dirty, revision, player_file_count) = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            Ok::<_, ApiError>((data.dirty, data.revision, data.player_saves.len()))
        }).await
        .map_err(|error| ApiError::Internal(format!("session metadata task failed: {error}")))??;
    Ok(
        Json(SessionResponse {
            id,
            file_name,
            original_size,
            decompressed_size,
            dirty,
            revision,
            player_file_count,
            container,
        })
    )
}

async fn get_overview(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<overview::SaveOverview>, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task
        ::spawn_blocking(move || {
            let mut data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            ensure_pal_index(&mut data)?;
            let index = data.pal_index.as_ref().expect("the index was just ensured");
            Ok::<_, ApiError>(overview::build(&data.save, index, &data.player_saves))
        }).await
        .map_err(|error| ApiError::Internal(format!("save overview task failed: {error}")))??;
    Ok(Json(response))
}

/// Rebuilds the session's Pal index when the revision moved past it.
///
/// Callers then borrow `data.pal_index` directly; the index can hold tens of
/// thousands of rows, so it is shared rather than cloned.
fn ensure_pal_index(data: &mut SaveSessionData) -> Result<(), ApiError> {
    let stale = data.pal_index.as_ref().is_none_or(|cache| cache.revision != data.revision);
    if stale {
        data.pal_index = Some(
            pals::build_index(&data.save, data.revision).map_err(ApiError::BadRequest)?
        );
    }
    Ok(())
}

async fn get_players(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<Vec<inventory::PlayerInventoryOwner>>, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let players = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
            Ok::<_, ApiError>(inventory::owners(&data.save, &data.player_saves))
        }).await
        .map_err(|e| ApiError::Internal(format!("player inventory task failed: {e}")))??;
    Ok(Json(players))
}

async fn get_player_inventory(
    State(state): State<Arc<AppState>>,
    Path((id, player_uid)): Path<(Uuid, String)>
) -> Result<Json<Vec<inventory::InventoryContainer>>, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let containers = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
            let owner = inventory
                ::owners(&data.save, &data.player_saves)
                .into_iter()
                .find(|v| v.player_uid.eq_ignore_ascii_case(&player_uid))
                .ok_or_else(|| {
                    ApiError::NotFound(
                        format!("player {player_uid} was not found among uploaded player saves")
                    )
                })?;
            Ok::<_, ApiError>(inventory::personal_containers(&data.save, &owner))
        }).await
        .map_err(|e| ApiError::Internal(format!("inventory task failed: {e}")))??;
    Ok(Json(containers))
}

async fn get_known_items(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<Vec<inventory::KnownItem>>, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let items = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
            Ok::<_, ApiError>(inventory::known_items(&data.save))
        }).await
        .map_err(|e| ApiError::Internal(format!("item catalogue task failed: {e}")))??;
    Ok(Json(items))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInventorySlotResponse {
    slot: inventory::InventorySlot,
    dirty: bool,
    revision: u64,
}
async fn update_player_inventory_slot(
    State(state): State<Arc<AppState>>,
    Path((id, player_uid, container_id, index)): Path<(Uuid, String, String, usize)>,
    request: Result<Json<inventory::UpdateSlotRequest>, JsonRejection>
) -> Result<Json<UpdateInventorySlotResponse>, ApiError> {
    let Json(request) = request.map_err(|e|
        ApiError::BadRequest(format!("invalid inventory update request: {e}"))
    )?;
    let expected_revision = request.expected_revision;
    let (slot, dirty, revision) = mutate_inventory(
        state,
        id,
        player_uid,
        container_id.clone(),
        expected_revision,
        move |data, _kind| {
            inventory
                ::update_slot(&mut data.save, &container_id, index, &request)
                .map_err(ApiError::BadRequest)
        }
    ).await?;
    Ok(
        Json(UpdateInventorySlotResponse {
            slot,
            dirty,
            revision,
        })
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AddInventoryItemResponse {
    #[serde(flatten)]
    added: inventory::AddedItem,
    dirty: bool,
    revision: u64,
}

async fn add_player_inventory_item(
    State(state): State<Arc<AppState>>,
    Path((id, player_uid, container_id)): Path<(Uuid, String, String)>,
    request: Result<Json<inventory::AddItemRequest>, JsonRejection>
) -> Result<Json<AddInventoryItemResponse>, ApiError> {
    let Json(request) = request.map_err(|e|
        ApiError::BadRequest(format!("invalid add item request: {e}"))
    )?;
    let expected_revision = request.expected_revision;
    let (added, dirty, revision) = mutate_inventory(
        state,
        id,
        player_uid,
        container_id.clone(),
        expected_revision,
        move |data, kind| {
            inventory
                ::add_item(&mut data.save, &container_id, &kind, &request)
                .map_err(ApiError::BadRequest)
        }
    ).await?;
    Ok(
        Json(AddInventoryItemResponse {
            added,
            dirty,
            revision,
        })
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionQuery {
    expected_revision: u64,
}

async fn delete_player_inventory_slot(
    State(state): State<Arc<AppState>>,
    Path((id, player_uid, container_id, index)): Path<(Uuid, String, String, usize)>,
    query: Result<Query<RevisionQuery>, QueryRejection>
) -> Result<Json<UpdateInventorySlotResponse>, ApiError> {
    let Query(query) = query.map_err(|e|
        ApiError::BadRequest(format!("invalid inventory delete request: {e}"))
    )?;
    let (slot, dirty, revision) = mutate_inventory(
        state,
        id,
        player_uid,
        container_id.clone(),
        query.expected_revision,
        move |data, _kind| {
            inventory
                ::remove_slot(&mut data.save, &container_id, index)
                .map_err(ApiError::BadRequest)
        }
    ).await?;
    Ok(
        Json(UpdateInventorySlotResponse {
            slot,
            dirty,
            revision,
        })
    )
}

/// Runs `change` against a container the player actually owns, guarding the
/// session revision and bumping it once the change lands. `change` receives the
/// container's kind so it can reason about equipment slots.
async fn mutate_inventory<T, F>(
    state: Arc<AppState>,
    id: Uuid,
    player_uid: String,
    container_id: String,
    expected_revision: u64,
    change: F
)
    -> Result<(T, bool, u64), ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&mut SaveSessionData, String) -> Result<T, ApiError> + Send + 'static
{
    let save = state.sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    tokio::task
        ::spawn_blocking(move || {
            let mut data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
            if expected_revision != data.revision {
                return Err(ApiError::Conflict {
                    message: "stale inventory revision".into(),
                    current_revision: data.revision,
                });
            }
            let next = data.revision
                .checked_add(1)
                .ok_or_else(|| ApiError::Internal("session revision overflow".into()))?;
            let owner = inventory
                ::owners(&data.save, &data.player_saves)
                .into_iter()
                .find(|v| v.player_uid.eq_ignore_ascii_case(&player_uid))
                .ok_or_else(|| ApiError::NotFound(format!("player {player_uid} was not found")))?;
            let kind = owner.personal_containers
                .iter()
                .find(|v| v.container_id.eq_ignore_ascii_case(&container_id))
                .map(|v| v.kind.clone())
                .ok_or_else(|| {
                    ApiError::NotFound("container is not owned by the selected player".into())
                })?;
            let value = change(&mut data, kind)?;
            data.dirty = true;
            data.revision = next;
            data.pal_index = None;
            Ok((value, data.dirty, data.revision))
        }).await
        .map_err(|e| ApiError::Internal(format!("inventory mutation task failed: {e}")))?
}

async fn get_root(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<PageQuery>
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    inspect_node_for_session(state, id, nodes::InspectSaveNodeRequest {
        path: Vec::new(),
        offset: query.offset,
        limit: query.limit,
    }).await
}

async fn inspect_node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    request: Result<Json<nodes::InspectSaveNodeRequest>, JsonRejection>
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    let Json(request) = request.map_err(|error|
        ApiError::BadRequest(format!("invalid inspect request: {error}"))
    )?;
    inspect_node_for_session(state, id, request).await
}

async fn inspect_node_for_session(
    state: Arc<AppState>,
    id: Uuid,
    request: nodes::InspectSaveNodeRequest
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    let (offset, limit) = request.page().map_err(ApiError::BadRequest)?;
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let path = request.path;
    let response = tokio::task
        ::spawn_blocking(move || {
            let save = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            nodes::inspect_path(&save.save, &path, offset, limit).map_err(ApiError::BadRequest)
        }).await
        .map_err(|error| ApiError::Internal(format!("node inspection task failed: {error}")))??;

    Ok(Json(response))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateScalarRequest {
    path: Vec<nodes::PathSegment>,
    expected_revision: u64,
    value: nodes::EditableScalarValue,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateScalarResponse {
    path: Vec<nodes::PathSegment>,
    value: nodes::EditableScalarValue,
    dirty: bool,
    revision: u64,
}

#[derive(Debug, Deserialize)]
struct ExportQuery {
    validate: Option<bool>,
}

fn run_revisioned_mutation<T>(
    dirty: &mut bool,
    revision: &mut u64,
    expected_revision: u64,
    mutation: impl FnOnce() -> Result<T, ApiError>
) -> Result<T, ApiError> {
    if expected_revision != *revision {
        return Err(ApiError::Conflict {
            message: format!(
                "stale revision: expected {expected_revision}, current revision is {}",
                *revision
            ),
            current_revision: *revision,
        });
    }
    let next_revision = revision
        .checked_add(1)
        .ok_or_else(|| ApiError::Internal("session revision overflow".to_string()))?;
    let result = mutation()?;
    *dirty = true;
    *revision = next_revision;
    Ok(result)
}

fn mutate_session_data(
    data: &mut SaveSessionData,
    request: UpdateScalarRequest
) -> Result<UpdateScalarResponse, ApiError> {
    let SaveSessionData { save, dirty, revision, pal_index, .. } = data;
    let value = run_revisioned_mutation(dirty, revision, request.expected_revision, || {
        nodes::update_scalar(save, &request.path, request.value).map_err(ApiError::BadRequest)
    })?;
    *pal_index = None;
    Ok(UpdateScalarResponse {
        path: request.path,
        value,
        dirty: *dirty,
        revision: *revision,
    })
}

async fn update_scalar(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    request: Result<Json<UpdateScalarRequest>, JsonRejection>
) -> Result<Json<UpdateScalarResponse>, ApiError> {
    let Json(request) = request.map_err(|error|
        ApiError::BadRequest(format!("invalid scalar update request: {error}"))
    )?;
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task
        ::spawn_blocking(move || {
            let mut data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            mutate_session_data(&mut data, request)
        }).await
        .map_err(|error| ApiError::Internal(format!("scalar mutation task failed: {error}")))??;
    Ok(Json(response))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePalResponse {
    pal: pals::PalDetail,
    dirty: bool,
    revision: u64,
}

fn mutate_pal_session_data(
    data: &mut SaveSessionData,
    pal_id: &str,
    request: pals::UpdatePalRequest
) -> Result<UpdatePalResponse, ApiError> {
    if request.expected_revision != data.revision {
        return Err(ApiError::Conflict {
            message: format!(
                "stale revision: expected {}, current revision is {}",
                request.expected_revision,
                data.revision
            ),
            current_revision: data.revision,
        });
    }
    let next = data.revision
        .checked_add(1)
        .ok_or_else(|| ApiError::Internal("session revision overflow".into()))?;
    let pal = pals::update(&mut data.save, pal_id, &request).map_err(|e| {
        match e {
            pals::UpdateError::NotFound(v) => ApiError::NotFound(v),
            pals::UpdateError::Validation(v) => ApiError::Validation(v),
            pals::UpdateError::Internal(v) => ApiError::Internal(v),
        }
    })?;
    data.dirty = true;
    data.revision = next;
    data.pal_index = None;
    Ok(UpdatePalResponse {
        pal,
        dirty: data.dirty,
        revision: data.revision,
    })
}

async fn update_pal(
    State(state): State<Arc<AppState>>,
    Path((id, pal_id)): Path<(Uuid, String)>,
    request: Result<Json<pals::UpdatePalRequest>, JsonRejection>
) -> Result<Json<UpdatePalResponse>, ApiError> {
    let Json(request) = request.map_err(|e|
        ApiError::BadRequest(format!("invalid Pal update request: {e}"))
    )?;
    let save = state.sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task
        ::spawn_blocking(move || {
            let mut data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
            mutate_pal_session_data(&mut data, &pal_id, request)
        }).await
        .map_err(|e| ApiError::Internal(format!("Pal mutation task failed: {e}")))??;
    Ok(Json(response))
}

async fn export_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<ExportQuery>
) -> Result<Response, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let (bytes, revision, dirty, validated) = tokio::task
        ::spawn_blocking(move || {
            let data = save.lock().map_err(|_| "save session lock was poisoned".to_string())?;
            let validate = query.validate.unwrap_or(true);
            let bytes = palsave_core::write_sav(&data.save)?;
            if validate {
                palsave_core
                    ::parse_sav_with_metadata(&bytes)
                    .map_err(|error| format!("export validation failed: {error}"))?;
            }
            Ok::<_, String>((bytes, data.revision, data.dirty, validate))
        }).await
        .map_err(|error| ApiError::Internal(format!("save writer task failed: {error}")))?
        .map_err(ApiError::Internal)?;
    let container = palsave_core::inspect_container(&bytes).ok();
    let mut response = binary_response(
        bytes,
        "Level.roundtrip.sav",
        revision,
        dirty,
        container.as_ref()
    )?;
    response
        .headers_mut()
        .insert(
            HeaderName::from_static("x-palsave-validated"),
            HeaderValue::from_static(if validated { "true" } else { "false" })
        );
    Ok(response)
}

/// Streams the session's current tree back as uncompressed GVAS.
///
/// This is the "decompile" half of the round trip: the same bytes the game
/// compresses into a `.sav`, including any edits made in this session.
async fn export_session_gvas(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Response, ApiError> {
    let (file_name, save) = state.sessions
        .get(&id)
        .map(|session| (session.file_name.clone(), Arc::clone(&session.save)))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let (bytes, revision, dirty) = tokio::task
        ::spawn_blocking(move || {
            let data = save.lock().map_err(|_| "save session lock was poisoned".to_string())?;
            let bytes = palsave_core::write_gvas(&data.save)?;
            Ok::<_, String>((bytes, data.revision, data.dirty))
        }).await
        .map_err(|error| ApiError::Internal(format!("GVAS writer task failed: {error}")))?
        .map_err(ApiError::Internal)?;

    binary_response(
        bytes,
        &format!("{}.gvas", strip_sav_extension(&file_name)),
        revision,
        dirty,
        None
    )
}

/// Decompresses an uploaded `.sav` and returns the raw GVAS payload.
///
/// Stateless on purpose: the tools page converts files without holding a
/// session, so nothing is retained after the response is written.
async fn convert_decompile(
    State(state): State<Arc<AppState>>,
    multipart: Multipart
) -> Result<Response, ApiError> {
    let (file_name, bytes) = single_upload(multipart, ".sav").await?;
    let max = state.max_decompressed_size;

    let (gvas, container) = tokio::task
        ::spawn_blocking(move || { palsave_core::decompress_sav_with_container(&bytes, max) }).await
        .map_err(|error| ApiError::Internal(format!("decompile task failed: {error}")))?
        .map_err(ApiError::BadRequest)?;

    binary_response(
        gvas,
        &format!("{}.gvas", strip_sav_extension(&file_name)),
        0,
        false,
        Some(&container)
    )
}

/// Compresses an uploaded raw GVAS payload back into a `.sav` container.
///
/// The payload is parsed before it is written so a corrupt upload fails here
/// rather than inside the game.
async fn convert_recompile(
    State(state): State<Arc<AppState>>,
    multipart: Multipart
) -> Result<Response, ApiError> {
    let (file_name, bytes) = single_upload(multipart, ".gvas").await?;
    let max = state.max_decompressed_size;

    if bytes.len() > max {
        return Err(
            ApiError::PayloadTooLarge(
                format!("GVAS payload {} bytes exceeds configured limit {max}", bytes.len())
            )
        );
    }

    let sav = tokio::task
        ::spawn_blocking(move || {
            let save = palsave_core::parse_gvas(bytes)?;
            palsave_core::write_sav(&save)
        }).await
        .map_err(|error| ApiError::Internal(format!("recompile task failed: {error}")))?
        .map_err(ApiError::BadRequest)?;

    let container = palsave_core::inspect_container(&sav).map_err(ApiError::Internal)?;

    binary_response(
        sav,
        &format!("{}.sav", strip_gvas_extension(&file_name)),
        0,
        false,
        Some(&container)
    )
}

/// Reads exactly one `file`/`files` multipart field with the expected suffix.
async fn single_upload(
    mut multipart: Multipart,
    expected_extension: &str
) -> Result<(String, Vec<u8>), ApiError> {
    while
        let Some(field) = multipart
            .next_field().await
            .map_err(|error| ApiError::BadRequest(format!("invalid multipart upload: {error}")))?
    {
        if !matches!(field.name(), Some("file" | "files")) {
            continue;
        }
        let file_name = field
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("upload{expected_extension}"));
        // Drain the field before rejecting the name: an early response would
        // reset the upload stream and surface as a proxy 500 rather than this
        // 400. See the matching note in `create_session`.
        let bytes = field
            .bytes().await
            .map_err(|error| {
                ApiError::BadRequest(format!("failed to read {file_name}: {error}"))
            })?;
        if !file_name.to_ascii_lowercase().ends_with(expected_extension) {
            return Err(
                ApiError::BadRequest(format!("{file_name} is not a {expected_extension} file"))
            );
        }
        return Ok((file_name, bytes.to_vec()));
    }

    Err(ApiError::BadRequest("missing multipart fields named `file` or `files`".into()))
}

fn strip_sav_extension(name: &str) -> &str {
    strip_extension(name, ".sav")
}

fn strip_gvas_extension(name: &str) -> &str {
    strip_extension(name, ".gvas")
}

fn strip_extension<'a>(name: &'a str, extension: &str) -> &'a str {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .trim_end_matches(char::is_whitespace);
    let trimmed = if base.to_ascii_lowercase().ends_with(extension) {
        &base[..base.len() - extension.len()]
    } else {
        base
    };
    if trimmed.is_empty() {
        "Level"
    } else {
        trimmed
    }
}

/// Builds a download response with the editor's diagnostic headers attached.
fn binary_response(
    bytes: Vec<u8>,
    file_name: &str,
    revision: u64,
    dirty: bool,
    container: Option<&palsave_core::SavContainer>
) -> Result<Response, ApiError> {
    let mut builder = Response::builder()
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(
            CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\"")).map_err(|error|
                ApiError::Internal(error.to_string())
            )?
        )
        .header(
            HeaderName::from_static("x-palsave-revision"),
            HeaderValue::from_str(&revision.to_string()).map_err(|error|
                ApiError::Internal(error.to_string())
            )?
        )
        .header(HeaderName::from_static("x-palsave-dirty"), if dirty { "true" } else { "false" });

    if let Some(container) = container {
        builder = builder
            .header(
                HeaderName::from_static("x-palsave-compression"),
                HeaderValue::from_str(container.compression).map_err(|error|
                    ApiError::Internal(error.to_string())
                )?
            )
            .header(
                HeaderName::from_static("x-palsave-decompressed-size"),
                HeaderValue::from_str(&container.decompressed_size.to_string()).map_err(|error|
                    ApiError::Internal(error.to_string())
                )?
            );
    }

    builder
        .body(Body::from(bytes))
        .map_err(|error| ApiError::Internal(format!("failed to build download response: {error}")))
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<DeleteSessionResponse>, ApiError> {
    let deleted = state.sessions.remove(&id).is_some();

    if !deleted {
        return Err(ApiError::NotFound(format!("save session {id} was not found")));
    }

    tracing::info!(%id, "deleted save session");

    Ok(Json(DeleteSessionResponse { deleted }))
}

fn max_decompressed_size() -> Result<usize, Box<dyn std::error::Error>> {
    let value = env
        ::var("PALSAVE_MAX_DECOMPRESSED_SIZE")
        .ok()
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(DEFAULT_MAX_DECOMPRESSED_SIZE);
    if value == 0 {
        return Err("PALSAVE_MAX_DECOMPRESSED_SIZE must be greater than zero".into());
    }
    Ok(value)
}

fn server_address() -> Result<(String, u16), Box<dyn std::error::Error>> {
    let host = env::var("PALSAVE_API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

    let port = env
        ::var("PALSAVE_API_PORT")
        .ok()
        .map(|value| value.parse::<u16>())
        .transpose()?
        .unwrap_or(DEFAULT_PORT);

    Ok((host, port))
}

fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/sessions", post(create_session))
        .route("/sessions/{id}", get(get_session).delete(delete_session))
        .route("/sessions/{id}/overview", get(get_overview))
        .route("/sessions/{id}/root", get(get_root))
        .route("/sessions/{id}/players", get(get_players))
        .route("/sessions/{id}/items", get(get_known_items))
        .route("/sessions/{id}/players/{player_uid}/inventory", get(get_player_inventory))
        .route(
            "/sessions/{id}/players/{player_uid}/inventory/{container_id}/slots",
            post(add_player_inventory_item)
        )
        .route(
            "/sessions/{id}/players/{player_uid}/inventory/{container_id}/slots/{index}",
            patch(update_player_inventory_slot).delete(delete_player_inventory_slot)
        )
        .route("/sessions/{id}/inspect", post(inspect_node))
        .route("/sessions/{id}/pals", get(get_pals))
        .route("/sessions/{id}/pals/{pal_id}", get(get_pal).patch(update_pal))
        .route("/sessions/{id}/scalar", patch(update_scalar))
        .route("/sessions/{id}/export", get(export_session))
        .route("/sessions/{id}/gvas", get(export_session_gvas))
        .route("/convert/decompile", post(convert_decompile))
        .route("/convert/recompile", post(convert_recompile))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber
        ::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter
                ::try_from_default_env()
                .unwrap_or_else(|_| "palsave_api=info,tower_http=info".into())
        )
        .init();

    let state = Arc::new(AppState {
        sessions: Arc::new(DashMap::new()),
        max_decompressed_size: max_decompressed_size()?,
    });

    let app = build_app(state);

    let (host, port) = server_address()?;
    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    let address = listener.local_addr()?;

    tracing::info!(%address, "PalSave API listening");

    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install Ctrl+C handler");
        return;
    }

    tracing::info!("shutdown signal received");
}

async fn get_pals(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    query: Result<Query<PalsQuery>, QueryRejection>
) -> Result<Json<pals::PalListResponse>, ApiError> {
    let Query(query) = query.map_err(|error|
        ApiError::BadRequest(format!("invalid Pal list query: {error}"))
    )?;
    let limit = query.limit.unwrap_or(pals::DEFAULT_LIMIT);
    if limit == 0 {
        return Err(ApiError::BadRequest("limit must be greater than zero".to_string()));
    }
    if limit > pals::MAX_LIMIT {
        return Err(ApiError::BadRequest(format!("limit must not exceed {}", pals::MAX_LIMIT)));
    }
    if query.min_level.zip(query.max_level).is_some_and(|(minimum, maximum)| minimum > maximum) {
        return Err(ApiError::BadRequest("minLevel must not exceed maxLevel".to_string()));
    }
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let filter = pals::PalFilter {
        search: query.search,
        character_id: query.character_id,
        owner_player_uid: query.owner_player_uid,
        gender: query.gender,
        min_level: query.min_level,
        max_level: query.max_level,
        include_players: query.include_players,
    };
    let response = tokio::task
        ::spawn_blocking(move || {
            let mut data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            ensure_pal_index(&mut data)?;
            Ok::<_, ApiError>(
                pals::list(
                    data.pal_index.as_ref().expect("cache was built"),
                    query.offset,
                    limit,
                    &filter
                )
            )
        }).await
        .map_err(|error| ApiError::Internal(format!("Pal index task failed: {error}")))??;
    Ok(Json(response))
}

async fn get_pal(
    State(state): State<Arc<AppState>>,
    Path((id, pal_id)): Path<(Uuid, String)>
) -> Result<Json<pals::PalDetail>, ApiError> {
    let save = state.sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            pals::detail(&data.save, &pal_id).map_err(|error| {
                if error.contains("was not found") {
                    ApiError::NotFound(error)
                } else {
                    ApiError::BadRequest(error)
                }
            })
        }).await
        .map_err(|error| ApiError::Internal(format!("Pal detail task failed: {error}")))??;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{ Request, header::CONTENT_TYPE };
    use http_body_util::BodyExt;
    use serde_json::{ Value, json };
    use tower::ServiceExt;
    use uesave::{ Header, MapEntry, Properties, Property, PropertySchemas, Root, StructValue };

    fn test_save(properties: Properties) -> Save {
        let header: Header = serde_json
            ::from_value(
                json!({
            "magic": u32::from_le_bytes(*b"GVAS"), "save_game_version": 3,
            "package_version": { "ue4": 522, "ue5": 1009 },
            "engine_version_major": 5, "engine_version_minor": 1, "engine_version_patch": 1,
            "engine_version_build": 0, "engine_version": "test", "custom_version": [0, []]
        })
            )
            .expect("test header");
        Save {
            header,
            schemas: PropertySchemas::new(),
            root: Root {
                save_game_type: "TestSave".into(),
                properties,
            },
            extra: vec![0; 4],
        }
    }
    fn state_with_save(
        save: Save,
        dirty: bool,
        revision: u64
    ) -> (Arc<AppState>, Uuid, Arc<Mutex<SaveSessionData>>) {
        let state = Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        });
        let id = Uuid::new_v4();
        let data = Arc::new(
            Mutex::new(SaveSessionData {
                save,
                dirty,
                revision,
                pal_index: None,
                player_saves: Vec::new(),
            })
        );
        state.sessions.insert(id, SaveSession {
            file_name: "test.sav".into(),
            original_size: 0,
            decompressed_size: 0,
            container: palsave_core::SavContainer {
                magic: "PlZ".into(),
                save_type: 0x31,
                compression: "zlib",
                decompressed_size: 0,
                compressed_size: 0,
            },
            save: Arc::clone(&data),
        });
        (state, id, data)
    }
    fn scalar_request(id: Uuid, body: Value) -> Request<Body> {
        Request::builder()
            .method("PATCH")
            .uri(format!("/sessions/{id}/scalar"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }
    async fn json_body(response: Response) -> Value {
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    fn test_pal_save() -> Save {
        let instance = uesave::FGuid::parse_str("c1b07a9e-7953-4b0e-bd5e-ed18d8df27b3").unwrap();
        let mut key = Properties::default();
        key.insert("PlayerUId", Property::Struct(StructValue::Guid(uesave::FGuid::nil())));
        key.insert("InstanceId", Property::Struct(StructValue::Guid(instance)));
        key.insert("DebugName", Property::Str("synthetic".into()));
        let entry = MapEntry {
            key: Property::Struct(StructValue::Struct(key)),
            value: Property::Struct(StructValue::Struct(Properties::default())),
        };
        let mut world = Properties::default();
        world.insert("CharacterSaveParameterMap", Property::Map(vec![entry]));
        let mut root = Properties::default();
        root.insert("worldSaveData", Property::Struct(StructValue::Struct(world)));
        test_save(root)
    }

    #[tokio::test]
    async fn pals_missing_session_is_structured_404() {
        let app = build_app(
            Arc::new(AppState {
                sessions: Arc::new(DashMap::new()),
                max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
            })
        );
        let id = Uuid::new_v4();
        let response = app
            .oneshot(
                Request::builder().uri(format!("/sessions/{id}/pals")).body(Body::empty()).unwrap()
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(json_body(response).await["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn pals_list_response_is_paginated_and_cached() {
        let (state, id, data) = state_with_save(test_pal_save(), false, 4);
        let app = build_app(state);
        for _ in 0..2 {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/sessions/{id}/pals?limit=1&includePlayers=true"))
                        .body(Body::empty())
                        .unwrap()
                ).await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let body = json_body(response).await;
            assert_eq!(body["total"], 1);
            assert_eq!(body["items"][0]["parseStatus"], "unsupported");
        }
        let data = data.lock().unwrap();
        assert_eq!(data.pal_index.as_ref().unwrap().revision, 4);
        assert_eq!(data.pal_index.as_ref().unwrap().items.len(), 1);
    }

    #[tokio::test]
    async fn pal_detail_response_and_invalid_id_status() {
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        let app = build_app(state);
        let pal_id = "instance%3Ac1b07a9e-7953-4b0e-bd5e-ed18d8df27b3";
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/pals/{pal_id}"))
                    .body(Body::empty())
                    .unwrap()
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await["mapIndex"], 0);
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/pals/map%3A99"))
                    .body(Body::empty())
                    .unwrap()
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn malformed_pal_query_is_structured_400() {
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        for query in ["limit=nope", "limit=0", "limit=201", "minLevel=3&maxLevel=2"] {
            let response = build_app(Arc::clone(&state))
                .oneshot(
                    Request::builder()
                        .uri(format!("/sessions/{id}/pals?{query}"))
                        .body(Body::empty())
                        .unwrap()
                ).await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert!(json_body(response).await["error"].is_string());
        }
    }

    #[test]
    fn successful_mutation_invalidates_pal_cache() {
        let mut properties = Properties::default();
        properties.insert("Value", Property::Int(7));
        let mut data = SaveSessionData {
            save: test_save(properties),
            dirty: false,
            revision: 0,
            pal_index: Some(pals::PalIndexCache {
                revision: 0,
                items: vec![],
            }),
            player_saves: Vec::new(),
        };
        mutate_session_data(&mut data, UpdateScalarRequest {
            path: vec![nodes::PathSegment::Property {
                name: "Value".into(),
                index: 0,
            }],
            expected_revision: 0,
            value: nodes::EditableScalarValue::Int32(8),
        }).unwrap();
        assert!(data.pal_index.is_none());
        assert_eq!(data.revision, 1);
    }

    #[test]
    fn revision_conflict_does_not_run_mutation() {
        let mut dirty = false;
        let mut revision = 2;
        let mut ran = false;
        let result = run_revisioned_mutation(&mut dirty, &mut revision, 1, || {
            ran = true;
            Ok(())
        });
        assert!(
            matches!(
                result,
                Err(ApiError::Conflict {
                    current_revision: 2,
                    ..
                })
            )
        );
        assert!(!ran);
        assert_eq!(revision, 2);
        assert!(!dirty);
    }
    #[test]
    fn successful_second_edit_uses_new_revision_and_stale_edit_fails() {
        let mut dirty = false;
        let mut revision = 0;
        assert!(
            run_revisioned_mutation(&mut dirty, &mut revision, 0, || Ok::<_, ApiError>(())).is_ok()
        );
        assert!(
            run_revisioned_mutation(&mut dirty, &mut revision, 1, || Ok::<_, ApiError>(())).is_ok()
        );
        assert_eq!(revision, 2);
        assert!(dirty);
        assert!(
            matches!(
                run_revisioned_mutation(&mut dirty, &mut revision, 1, || Ok::<_, ApiError>(())),
                Err(ApiError::Conflict {
                    current_revision: 2,
                    ..
                })
            )
        );
    }
    #[test]
    fn failed_mutations_preserve_dirty_and_revision() {
        for initial_dirty in [false, true] {
            let mut dirty = initial_dirty;
            let mut revision = 4;
            let result = run_revisioned_mutation::<()>(&mut dirty, &mut revision, 4, || {
                Err(ApiError::BadRequest("invalid".into()))
            });
            assert!(result.is_err());
            assert_eq!(revision, 4);
            assert_eq!(dirty, initial_dirty);
        }
    }
    #[test]
    fn revision_overflow_never_changes_save_dirty_or_revision() {
        for initial_dirty in [false, true] {
            let mut properties = Properties::default();
            properties.insert("Value", Property::Int(7));
            let mut data = SaveSessionData {
                save: test_save(properties),
                dirty: initial_dirty,
                revision: u64::MAX,
                pal_index: None,
                player_saves: Vec::new(),
            };
            let request = UpdateScalarRequest {
                path: vec![nodes::PathSegment::Property {
                    name: "Value".into(),
                    index: 0,
                }],
                expected_revision: u64::MAX,
                value: nodes::EditableScalarValue::Int32(8),
            };
            assert!(matches!(mutate_session_data(&mut data, request), Err(ApiError::Internal(_))));
            assert_eq!(
                data.save.root.properties.0.get(&uesave::PropertyKey(0, "Value".into())),
                Some(&Property::Int(7))
            );
            assert_eq!(data.revision, u64::MAX);
            assert_eq!(data.dirty, initial_dirty);
        }
    }

    #[test]
    fn failed_path_and_type_mutations_do_not_change_session_metadata_or_save() {
        let mut properties = Properties::default();
        properties.insert("Value", Property::Int(7));
        let mut data = SaveSessionData {
            save: test_save(properties),
            dirty: false,
            revision: 3,
            pal_index: None,
            player_saves: Vec::new(),
        };
        for (path, value) in [
            (
                vec![nodes::PathSegment::Property {
                    name: "Missing".into(),
                    index: 0,
                }],
                nodes::EditableScalarValue::Int32(8),
            ),
            (
                vec![nodes::PathSegment::Property {
                    name: "Value".into(),
                    index: 0,
                }],
                nodes::EditableScalarValue::Bool(true),
            ),
        ] {
            let request = UpdateScalarRequest {
                path,
                expected_revision: 3,
                value,
            };
            assert!(mutate_session_data(&mut data, request).is_err());
            assert_eq!(data.revision, 3);
            assert!(!data.dirty);
            assert_eq!(
                data.save.root.properties.0.get(&uesave::PropertyKey(0, "Value".into())),
                Some(&Property::Int(7))
            );
        }
    }

    #[tokio::test]
    async fn scalar_http_errors_have_expected_status_and_conflict_shape() {
        let missing = Uuid::new_v4();
        let app = build_app(
            Arc::new(AppState {
                sessions: Arc::new(DashMap::new()),
                max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
            })
        );
        let response = app
            .clone()
            .oneshot(
                scalar_request(
                    missing,
                    json!({"path":[],"expectedRevision":0,"value":{"type":"int32","value":1}})
                )
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let malformed = Request::builder()
            .method("PATCH")
            .uri(format!("/sessions/{missing}/scalar"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from("{"))
            .unwrap();
        let response = app.oneshot(malformed).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let mut properties = Properties::default();
        properties.insert("Value", Property::Int(7));
        let (state, id, _) = state_with_save(test_save(properties), false, 1);
        let app = build_app(state);
        let conflict = app
            .clone()
            .oneshot(
                scalar_request(
                    id,
                    json!({"path":[{"type":"property","name":"Value","index":0}],"expectedRevision":0,"value":{"type":"int32","value":8}})
                )
            ).await
            .unwrap();
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let body = json_body(conflict).await;
        assert_eq!(body["code"], "revisionConflict");
        assert_eq!(body["currentRevision"], 1);
        assert!(body["error"].as_str().unwrap().contains("stale"));
        let bad_path = app
            .clone()
            .oneshot(
                scalar_request(
                    id,
                    json!({"path":[{"type":"property","name":"Missing","index":0}],"expectedRevision":1,"value":{"type":"int32","value":8}})
                )
            ).await
            .unwrap();
        assert_eq!(bad_path.status(), StatusCode::BAD_REQUEST);
        let mismatch = app
            .oneshot(
                scalar_request(
                    id,
                    json!({"path":[{"type":"property","name":"Value","index":0}],"expectedRevision":1,"value":{"type":"bool","value":true}})
                )
            ).await
            .unwrap();
        assert_eq!(mismatch.status(), StatusCode::BAD_REQUEST);
    }

    const TEST_PLAYER: &str = "10b4ee74-0000-0000-0000-000000000000";

    /// A level holding one item container plus the player save that owns it.
    fn test_inventory_state() -> (Arc<AppState>, Uuid) {
        const CONTAINER: &str = "11111111-2222-3333-4444-555555555555";
        let guid = uesave::FGuid::parse_str(CONTAINER).unwrap();

        let raw = |bytes: Vec<u8>| {
            Property::Array(uesave::ValueVec::Byte(uesave::ByteArray::Byte(bytes)))
        };

        // slot 0, one Wood: index, count, FString, two blank ids, blank tail.
        let mut slot_bytes = Vec::new();
        slot_bytes.extend((0_i32).to_le_bytes());
        slot_bytes.extend((1_i32).to_le_bytes());
        slot_bytes.extend((5_i32).to_le_bytes());
        slot_bytes.extend(b"Wood\0");
        slot_bytes.extend([0; 52]);

        let mut slot = Properties::default();
        slot.insert("RawData", raw(slot_bytes));

        let mut container = Properties::default();
        container.insert(
            "Slots",
            Property::Array(uesave::ValueVec::Struct(vec![StructValue::Struct(slot)]))
        );
        container.insert("SlotNum", Property::Int(4));

        let mut key = Properties::default();
        key.insert("ID", Property::Struct(StructValue::Guid(guid)));

        let mut world = Properties::default();
        world.insert(
            "ItemContainerSaveData",
            Property::Map(
                vec![MapEntry {
                    key: Property::Struct(StructValue::Struct(key)),
                    value: Property::Struct(StructValue::Struct(container)),
                }]
            )
        );
        let mut level = Properties::default();
        level.insert("worldSaveData", Property::Struct(StructValue::Struct(world)));

        let mut reference = Properties::default();
        reference.insert("ID", Property::Struct(StructValue::Guid(guid)));
        let mut info = Properties::default();
        info.insert("CommonContainerId", Property::Struct(StructValue::Struct(reference)));
        let mut player = Properties::default();
        player.insert(
            "PlayerUId",
            Property::Struct(StructValue::Guid(uesave::FGuid::parse_str(TEST_PLAYER).unwrap()))
        );
        player.insert("InventoryInfo", Property::Struct(StructValue::Struct(info)));
        let mut player_root = Properties::default();
        player_root.insert("SaveData", Property::Struct(StructValue::Struct(player)));

        let (state, id, data) = state_with_save(test_save(level), false, 0);
        data.lock()
            .unwrap()
            .player_saves.push(inventory::PlayerSaveFile {
                file_name: "player.sav".into(),
                save: test_save(player_root),
            });
        (state, id)
    }

    fn inventory_request(method: &str, uri: String, body: Option<Value>) -> Request<Body> {
        let builder = Request::builder().method(method).uri(uri);
        match body {
            Some(body) =>
                builder
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            None => builder.body(Body::empty()).unwrap(),
        }
    }

    #[tokio::test]
    async fn inventory_items_can_be_added_and_removed_over_http() {
        const PLAYER: &str = TEST_PLAYER;
        const CONTAINER: &str = "11111111-2222-3333-4444-555555555555";
        let (state, id) = test_inventory_state();
        let app = build_app(state);
        let slots = format!("/sessions/{id}/players/{PLAYER}/inventory/{CONTAINER}/slots");

        let added = app
            .clone()
            .oneshot(
                inventory_request(
                    "POST",
                    slots.clone(),
                    Some(json!({"expectedRevision":0,"itemId":"KeySphere_01","quantity":1}))
                )
            ).await
            .unwrap();
        assert_eq!(added.status(), StatusCode::OK);
        let body = json_body(added).await;
        assert_eq!(body["slot"]["slotIndex"], 1);
        assert_eq!(body["slot"]["itemId"], "KeySphere_01");
        assert_eq!(body["revision"], 1);
        assert_eq!(body["dirty"], true);

        let stale = app
            .clone()
            .oneshot(
                inventory_request(
                    "POST",
                    slots.clone(),
                    Some(json!({"expectedRevision":0,"itemId":"Wood","quantity":1}))
                )
            ).await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        assert_eq!(json_body(stale).await["currentRevision"], 1);

        let unowned = app
            .clone()
            .oneshot(
                inventory_request(
                    "POST",
                    format!(
                        "/sessions/{id}/players/{PLAYER}/inventory/99999999-0000-0000-0000-000000000000/slots"
                    ),
                    Some(json!({"expectedRevision":1,"itemId":"Wood","quantity":1}))
                )
            ).await
            .unwrap();
        assert_eq!(unowned.status(), StatusCode::NOT_FOUND);

        let removed = app
            .clone()
            .oneshot(
                inventory_request("DELETE", format!("{slots}/0?expectedRevision=1"), None)
            ).await
            .unwrap();
        assert_eq!(removed.status(), StatusCode::OK);
        assert_eq!(json_body(removed).await["slot"]["itemId"], "Wood");

        let containers = app
            .oneshot(
                inventory_request("GET", format!("/sessions/{id}/players/{PLAYER}/inventory"), None)
            ).await
            .unwrap();
        let body = json_body(containers).await;
        assert_eq!(body[0]["capacity"], 4);
        assert_eq!(body[0]["slots"].as_array().unwrap().len(), 1);
        assert_eq!(body[0]["slots"][0]["itemId"], "KeySphere_01");
    }

    #[tokio::test]
    async fn successful_scalar_http_update_returns_exact_value_and_metadata() {
        let mut properties = Properties::default();
        properties.insert("Big", Property::UInt64(0));
        let (state, id, data) = state_with_save(test_save(properties), false, 0);
        let response = build_app(state)
            .oneshot(
                scalar_request(
                    id,
                    json!({"path":[{"type":"property","name":"Big","index":0}],"expectedRevision":0,"value":{"type":"uint64","value":"18446744073709551615"}})
                )
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["value"], json!({"type":"uint64","value":"18446744073709551615"}));
        assert_eq!(body["dirty"], true);
        assert_eq!(body["revision"], 1);
        let data = data.lock().unwrap();
        assert_eq!(
            data.save.root.properties.0.get(&uesave::PropertyKey(0, "Big".into())),
            Some(&Property::UInt64(u64::MAX))
        );
    }

    #[test]
    fn synthetic_empty_save_writes_and_reparses() {
        let bytes = palsave_core
            ::write_sav(&test_save(Properties::default()))
            .expect("write synthetic save");
        palsave_core::parse_sav_with_metadata(&bytes).expect("reparse synthetic save");
    }

    #[tokio::test]
    async fn export_validation_headers_and_state_are_correct() {
        for validate in [false, true] {
            let (state, id, data) = state_with_save(test_save(Properties::default()), true, 9);
            let response = build_app(state)
                .oneshot(
                    Request::builder()
                        .uri(format!("/sessions/{id}/export?validate={validate}"))
                        .body(Body::empty())
                        .unwrap()
                ).await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-palsave-revision"], "9");
            assert_eq!(response.headers()["x-palsave-dirty"], "true");
            assert_eq!(response.headers()["x-palsave-validated"], if validate {
                "true"
            } else {
                "false"
            });
            let data = data.lock().unwrap();
            assert!(data.dirty);
            assert_eq!(data.revision, 9);
        }
    }

    /// Builds a `multipart/form-data` body with a single `file` field.
    fn multipart_request(uri: &str, file_name: &str, bytes: Vec<u8>) -> Request<Body> {
        const BOUNDARY: &str = "palsaveboundary";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n"
            ).as_bytes()
        );
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(&bytes);
        body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());

        Request::builder()
            .method("POST")
            .uri(uri)
            .header(CONTENT_TYPE, format!("multipart/form-data; boundary={BOUNDARY}"))
            .body(Body::from(body))
            .unwrap()
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        response.into_body().collect().await.unwrap().to_bytes().to_vec()
    }

    fn empty_state() -> Arc<AppState> {
        Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        })
    }

    #[tokio::test]
    async fn overview_reports_engine_metadata_and_collection_sizes() {
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        let response = build_app(state)
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/overview"))
                    .body(Body::empty())
                    .unwrap()
            ).await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = json_body(response).await;
        assert_eq!(body["saveGameType"], "TestSave");
        assert_eq!(body["engineVersion"], "5.1.1 build 0");
        assert_eq!(body["rootPropertyCount"], 1);
        assert_eq!(body["worldCollections"][0]["name"], "CharacterSaveParameterMap");
        assert_eq!(body["worldCollections"][0]["entryCount"], 1);
        assert_eq!(body["characters"]["total"], 1);
        assert_eq!(body["characters"]["unsupported"], 1);
        // The synthetic entry has no decodable level, so no average is reported.
        assert!(body["characters"]["averagePalLevel"].is_null());
    }

    #[tokio::test]
    async fn overview_missing_session_is_a_structured_404() {
        let id = Uuid::new_v4();
        let response = build_app(empty_state())
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/overview"))
                    .body(Body::empty())
                    .unwrap()
            ).await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(json_body(response).await["error"].as_str().unwrap().contains("not found"));
    }

    #[tokio::test]
    async fn gvas_export_matches_the_core_writer_and_recompiles_to_a_valid_sav() {
        let save = test_save(Properties::default());
        let expected = palsave_core::write_gvas(&save).expect("reference GVAS");
        let (state, id, _) = state_with_save(save, true, 5);
        let app = build_app(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder().uri(format!("/sessions/{id}/gvas")).body(Body::empty()).unwrap()
            ).await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-palsave-revision"], "5");
        assert_eq!(response.headers()["x-palsave-dirty"], "true");
        assert!(response.headers()[CONTENT_DISPOSITION].to_str().unwrap().contains("test.gvas"));
        let gvas = body_bytes(response).await;
        assert_eq!(gvas, expected);

        // Feeding that payload straight back must produce a loadable container.
        let response = app
            .oneshot(multipart_request("/convert/recompile", "test.gvas", gvas.clone())).await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-palsave-compression"], "zlib");
        assert!(response.headers()[CONTENT_DISPOSITION].to_str().unwrap().contains("test.sav"));
        let sav = body_bytes(response).await;
        assert_eq!(palsave_core::decompress_sav(&sav).unwrap(), gvas);
    }

    #[tokio::test]
    async fn decompile_returns_the_raw_gvas_payload() {
        let gvas = palsave_core::write_gvas(&test_save(Properties::default())).unwrap();
        let sav = palsave_core::compress_sav(&gvas).unwrap();

        let response = build_app(empty_state())
            .oneshot(multipart_request("/convert/decompile", "Level.sav", sav)).await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-palsave-compression"], "zlib");
        assert_eq!(response.headers()["x-palsave-decompressed-size"], gvas.len().to_string());
        assert!(response.headers()[CONTENT_DISPOSITION].to_str().unwrap().contains("Level.gvas"));
        assert_eq!(body_bytes(response).await, gvas);
    }

    #[tokio::test]
    async fn converters_reject_wrong_extensions_missing_fields_and_corrupt_payloads() {
        let app = build_app(empty_state());

        // Wrong extension for the decompiler.
        let response = app
            .clone()
            .oneshot(multipart_request("/convert/decompile", "Level.gvas", vec![0; 16])).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(json_body(response).await["error"].as_str().unwrap().contains("not a .sav file"));

        // A .sav that is not a Palworld container.
        let response = app
            .clone()
            .oneshot(multipart_request("/convert/decompile", "Level.sav", vec![0; 64])).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // Garbage that is not GVAS at all.
        let response = app
            .clone()
            .oneshot(
                multipart_request("/convert/recompile", "Level.gvas", b"not gvas".to_vec())
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        // No `file`/`files` field at all.
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/convert/recompile")
                    .header(CONTENT_TYPE, "multipart/form-data; boundary=x")
                    .body(Body::from("--x--\r\n"))
                    .unwrap()
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn download_names_survive_paths_and_missing_extensions() {
        assert_eq!(strip_sav_extension("Level.sav"), "Level");
        assert_eq!(strip_sav_extension("saves/world/Level.SAV"), "Level");
        assert_eq!(strip_sav_extension("C:\\saves\\Level.sav"), "Level");
        assert_eq!(strip_sav_extension("Level"), "Level");
        assert_eq!(strip_sav_extension(".sav"), "Level");
        assert_eq!(strip_gvas_extension("Level.gvas"), "Level");
        assert_eq!(strip_gvas_extension("Level.sav"), "Level.sav");
    }

    fn pal_update_request(id: Uuid, pal_id: &str, body: Value) -> Request<Body> {
        Request::builder()
            .method("PATCH")
            .uri(format!("/sessions/{id}/pals/{pal_id}"))
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    #[tokio::test]
    async fn pal_update_missing_session_and_pal_are_404() {
        let empty = Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        });
        let id = Uuid::new_v4();
        let response = build_app(empty)
            .oneshot(
                pal_update_request(id, "map:0", json!({"expectedRevision":0,"level":{"value":2}}))
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        let response = build_app(state)
            .oneshot(
                pal_update_request(id, "map:99", json!({"expectedRevision":0,"level":{"value":2}}))
            ).await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn pal_update_rejects_malformed_unknown_and_stale_requests() {
        let (state, id, _) = state_with_save(test_pal_save(), false, 2);
        let app = build_app(state);
        let malformed = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/{id}/pals/map:0"))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from("{"))
                    .unwrap()
            ).await
            .unwrap();
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
        let unknown = app
            .clone()
            .oneshot(
                pal_update_request(id, "map:0", json!({"expectedRevision":2,"unknown":1}))
            ).await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
        let stale = app
            .oneshot(
                pal_update_request(id, "map:0", json!({"expectedRevision":1,"level":{"value":2}}))
            ).await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        let body = json_body(stale).await;
        assert_eq!(body["currentRevision"], 2);
        assert_eq!(body["code"], "revisionConflict");
    }
}
