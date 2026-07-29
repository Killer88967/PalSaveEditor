use axum::{
    Json, Router,
    body::Body,
    extract::{
        DefaultBodyLimit, Multipart, Path, Query, State,
        rejection::{JsonRejection, QueryRejection},
    },
    http::{
        HeaderName, HeaderValue, StatusCode,
        header::{CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env,
    sync::{Arc, Mutex},
};
use tower_http::trace::TraceLayer;
use uesave::Save;
use uuid::Uuid;

mod inventory;
mod nodes;
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
            Self::Validation(fields) => (
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
            Self::Conflict {
                message,
                current_revision,
            } => (
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
        )
            .into_response()
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
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<SessionResponse>), ApiError> {
    let mut uploads = Vec::new();
    let mut total_size = 0usize;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("invalid multipart upload: {e}")))?
    {
        if !matches!(field.name(), Some("file" | "files")) {
            continue;
        }
        let file_name = field
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Level.sav".into());
        if !file_name.to_ascii_lowercase().ends_with(".sav") {
            return Err(ApiError::BadRequest(format!(
                "{file_name} is not a .sav file"
            )));
        }
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ApiError::BadRequest(format!("failed to read {file_name}: {e}")))?;
        total_size = total_size
            .checked_add(bytes.len())
            .ok_or_else(|| ApiError::PayloadTooLarge("combined upload size overflow".into()))?;
        if total_size > MAX_UPLOAD_SIZE {
            return Err(ApiError::PayloadTooLarge(format!(
                "combined upload is too large: {total_size} bytes"
            )));
        }
        uploads.push((file_name, bytes.to_vec()));
    }
    if uploads.is_empty() {
        return Err(ApiError::BadRequest(
            "missing multipart fields named `file` or `files`".into(),
        ));
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
    let parsed = tokio::task::spawn_blocking(move || {
        let mut level = None;
        let mut players = Vec::new();
        let mut level_size = 0;
        let mut level_decompressed = 0;
        for (index, (name, bytes)) in uploads.into_iter().enumerate() {
            let parsed = palsave_core::parse_sav_with_metadata_limit(&bytes, max)
                .map_err(|e| format!("failed to parse {name}: {e}"))?;
            if index == level_index {
                level_size = bytes.len();
                level_decompressed = parsed.decompressed_size;
                level = Some((name, parsed.save));
            } else {
                players.push(inventory::PlayerSaveFile {
                    file_name: name,
                    save: parsed.save,
                });
            }
        }
        let (name, save) = level.ok_or_else(|| "Level.sav was not parsed".to_string())?;
        Ok::<_, String>((name, level_size, level_decompressed, save, players))
    })
    .await
    .map_err(|e| ApiError::Internal(format!("save parser task failed: {e}")))?
    .map_err(ApiError::BadRequest)?;
    let (file_name, original_size, decompressed_size, save, player_saves) = parsed;
    let player_file_count = player_saves.len();
    let id = Uuid::new_v4();
    state.sessions.insert(
        id,
        SaveSession {
            file_name: file_name.clone(),
            original_size,
            decompressed_size,
            save: Arc::new(Mutex::new(SaveSessionData {
                save,
                dirty: false,
                revision: 0,
                pal_index: None,
                player_saves,
            })),
        },
    );
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
        }),
    ))
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<SessionResponse>, ApiError> {
    let (file_name, original_size, decompressed_size, save) = state
        .sessions
        .get(&id)
        .map(|session| {
            (
                session.file_name.clone(),
                session.original_size,
                session.decompressed_size,
                Arc::clone(&session.save),
            )
        })
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let (dirty, revision, player_file_count) = tokio::task::spawn_blocking(move || {
        let data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
        Ok::<_, ApiError>((data.dirty, data.revision, data.player_saves.len()))
    })
    .await
    .map_err(|error| ApiError::Internal(format!("session metadata task failed: {error}")))??;
    Ok(Json(SessionResponse {
        id,
        file_name,
        original_size,
        decompressed_size,
        dirty,
        revision,
        player_file_count,
    }))
}

async fn get_players(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<inventory::PlayerInventoryOwner>>, ApiError> {
    let save = state
        .sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let players = tokio::task::spawn_blocking(move || {
        let data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
        Ok::<_, ApiError>(inventory::owners(&data.save, &data.player_saves))
    })
    .await
    .map_err(|e| ApiError::Internal(format!("player inventory task failed: {e}")))??;
    Ok(Json(players))
}

async fn get_player_inventory(
    State(state): State<Arc<AppState>>,
    Path((id, player_uid)): Path<(Uuid, String)>,
) -> Result<Json<Vec<inventory::InventoryContainer>>, ApiError> {
    let save = state
        .sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let containers = tokio::task::spawn_blocking(move || {
        let data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
        let owner = inventory::owners(&data.save, &data.player_saves)
            .into_iter()
            .find(|v| v.player_uid.eq_ignore_ascii_case(&player_uid))
            .ok_or_else(|| {
                ApiError::NotFound(format!(
                    "player {player_uid} was not found among uploaded player saves"
                ))
            })?;
        Ok::<_, ApiError>(inventory::personal_containers(&data.save, &owner))
    })
    .await
    .map_err(|e| ApiError::Internal(format!("inventory task failed: {e}")))??;
    Ok(Json(containers))
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
    request: Result<Json<inventory::UpdateSlotRequest>, JsonRejection>,
) -> Result<Json<UpdateInventorySlotResponse>, ApiError> {
    let Json(request) = request
        .map_err(|e| ApiError::BadRequest(format!("invalid inventory update request: {e}")))?;
    let save = state
        .sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task::spawn_blocking(move || {
        let mut data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
        if request.expected_revision != data.revision {
            return Err(ApiError::Conflict {
                message: "stale inventory revision".into(),
                current_revision: data.revision,
            });
        }
        let next = data
            .revision
            .checked_add(1)
            .ok_or_else(|| ApiError::Internal("session revision overflow".into()))?;
        let owner = inventory::owners(&data.save, &data.player_saves)
            .into_iter()
            .find(|v| v.player_uid.eq_ignore_ascii_case(&player_uid))
            .ok_or_else(|| ApiError::NotFound(format!("player {player_uid} was not found")))?;
        let authorized = owner
            .personal_containers
            .iter()
            .any(|v| v.container_id.eq_ignore_ascii_case(&container_id));
        if !authorized {
            return Err(ApiError::NotFound(
                "container is not owned by the selected player".into(),
            ));
        }
        let slot = inventory::update_slot(&mut data.save, &container_id, index, &request)
            .map_err(ApiError::BadRequest)?;
        data.dirty = true;
        data.revision = next;
        data.pal_index = None;
        Ok(UpdateInventorySlotResponse {
            slot,
            dirty: data.dirty,
            revision: data.revision,
        })
    })
    .await
    .map_err(|e| ApiError::Internal(format!("inventory mutation task failed: {e}")))??;
    Ok(Json(response))
}

async fn get_root(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<PageQuery>,
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    inspect_node_for_session(
        state,
        id,
        nodes::InspectSaveNodeRequest {
            path: Vec::new(),
            offset: query.offset,
            limit: query.limit,
        },
    )
    .await
}

async fn inspect_node(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    request: Result<Json<nodes::InspectSaveNodeRequest>, JsonRejection>,
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    let Json(request) = request
        .map_err(|error| ApiError::BadRequest(format!("invalid inspect request: {error}")))?;
    inspect_node_for_session(state, id, request).await
}

async fn inspect_node_for_session(
    state: Arc<AppState>,
    id: Uuid,
    request: nodes::InspectSaveNodeRequest,
) -> Result<Json<nodes::SaveNodeResponse>, ApiError> {
    let (offset, limit) = request.page().map_err(ApiError::BadRequest)?;
    let save = state
        .sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let path = request.path;
    let response = tokio::task::spawn_blocking(move || {
        let save = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
        nodes::inspect_path(&save.save, &path, offset, limit).map_err(ApiError::BadRequest)
    })
    .await
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
    mutation: impl FnOnce() -> Result<T, ApiError>,
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
    request: UpdateScalarRequest,
) -> Result<UpdateScalarResponse, ApiError> {
    let SaveSessionData {
        save,
        dirty,
        revision,
        pal_index,
        ..
    } = data;
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
    request: Result<Json<UpdateScalarRequest>, JsonRejection>,
) -> Result<Json<UpdateScalarResponse>, ApiError> {
    let Json(request) = request
        .map_err(|error| ApiError::BadRequest(format!("invalid scalar update request: {error}")))?;
    let save = state
        .sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task::spawn_blocking(move || {
        let mut data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
        mutate_session_data(&mut data, request)
    })
    .await
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
    request: pals::UpdatePalRequest,
) -> Result<UpdatePalResponse, ApiError> {
    if request.expected_revision != data.revision {
        return Err(ApiError::Conflict {
            message: format!(
                "stale revision: expected {}, current revision is {}",
                request.expected_revision, data.revision
            ),
            current_revision: data.revision,
        });
    }
    let next = data
        .revision
        .checked_add(1)
        .ok_or_else(|| ApiError::Internal("session revision overflow".into()))?;
    let pal = pals::update(&mut data.save, pal_id, &request).map_err(|e| match e {
        pals::UpdateError::NotFound(v) => ApiError::NotFound(v),
        pals::UpdateError::Validation(v) => ApiError::Validation(v),
        pals::UpdateError::Internal(v) => ApiError::Internal(v),
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
    request: Result<Json<pals::UpdatePalRequest>, JsonRejection>,
) -> Result<Json<UpdatePalResponse>, ApiError> {
    let Json(request) =
        request.map_err(|e| ApiError::BadRequest(format!("invalid Pal update request: {e}")))?;
    let save = state
        .sessions
        .get(&id)
        .map(|s| Arc::clone(&s.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task::spawn_blocking(move || {
        let mut data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".into()))?;
        mutate_pal_session_data(&mut data, &pal_id, request)
    })
    .await
    .map_err(|e| ApiError::Internal(format!("Pal mutation task failed: {e}")))??;
    Ok(Json(response))
}

async fn export_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<ExportQuery>,
) -> Result<Response, ApiError> {
    let save = state
        .sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let (bytes, revision, dirty, validated) = tokio::task::spawn_blocking(move || {
        let data = save
            .lock()
            .map_err(|_| "save session lock was poisoned".to_string())?;
        let validate = query.validate.unwrap_or(true);
        let bytes = palsave_core::write_sav(&data.save)?;
        if validate {
            palsave_core::parse_sav_with_metadata(&bytes)
                .map_err(|error| format!("export validation failed: {error}"))?;
        }
        Ok::<_, String>((bytes, data.revision, data.dirty, validate))
    })
    .await
    .map_err(|error| ApiError::Internal(format!("save writer task failed: {error}")))?
    .map_err(ApiError::Internal)?;
    Response::builder()
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(
            CONTENT_DISPOSITION,
            "attachment; filename=\"Level.roundtrip.sav\"",
        )
        .header(
            HeaderName::from_static("x-palsave-revision"),
            HeaderValue::from_str(&revision.to_string())
                .map_err(|e| ApiError::Internal(e.to_string()))?,
        )
        .header(
            HeaderName::from_static("x-palsave-dirty"),
            if dirty { "true" } else { "false" },
        )
        .header(
            HeaderName::from_static("x-palsave-validated"),
            if validated { "true" } else { "false" },
        )
        .body(Body::from(bytes))
        .map_err(|error| ApiError::Internal(format!("failed to build export response: {error}")))
}

async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<DeleteSessionResponse>, ApiError> {
    let deleted = state.sessions.remove(&id).is_some();

    if !deleted {
        return Err(ApiError::NotFound(format!(
            "save session {id} was not found"
        )));
    }

    tracing::info!(%id, "deleted save session");

    Ok(Json(DeleteSessionResponse { deleted }))
}

fn max_decompressed_size() -> Result<usize, Box<dyn std::error::Error>> {
    let value = env::var("PALSAVE_MAX_DECOMPRESSED_SIZE")
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

    let port = env::var("PALSAVE_API_PORT")
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
        .route("/sessions/{id}/root", get(get_root))
        .route("/sessions/{id}/players", get(get_players))
        .route(
            "/sessions/{id}/players/{player_uid}/inventory",
            get(get_player_inventory),
        )
        .route(
            "/sessions/{id}/players/{player_uid}/inventory/{container_id}/slots/{index}",
            patch(update_player_inventory_slot),
        )
        .route("/sessions/{id}/inspect", post(inspect_node))
        .route("/sessions/{id}/pals", get(get_pals))
        .route(
            "/sessions/{id}/pals/{pal_id}",
            get(get_pal).patch(update_pal),
        )
        .route("/sessions/{id}/scalar", patch(update_scalar))
        .route("/sessions/{id}/export", get(export_session))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "palsave_api=info,tower_http=info".into()),
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

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

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
    query: Result<Query<PalsQuery>, QueryRejection>,
) -> Result<Json<pals::PalListResponse>, ApiError> {
    let Query(query) =
        query.map_err(|error| ApiError::BadRequest(format!("invalid Pal list query: {error}")))?;
    let limit = query.limit.unwrap_or(pals::DEFAULT_LIMIT);
    if limit == 0 {
        return Err(ApiError::BadRequest(
            "limit must be greater than zero".to_string(),
        ));
    }
    if limit > pals::MAX_LIMIT {
        return Err(ApiError::BadRequest(format!(
            "limit must not exceed {}",
            pals::MAX_LIMIT
        )));
    }
    if query
        .min_level
        .zip(query.max_level)
        .is_some_and(|(minimum, maximum)| minimum > maximum)
    {
        return Err(ApiError::BadRequest(
            "minLevel must not exceed maxLevel".to_string(),
        ));
    }
    let save = state
        .sessions
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
    let response = tokio::task::spawn_blocking(move || {
        let mut data = save
            .lock()
            .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
        let rebuild = data
            .pal_index
            .as_ref()
            .is_none_or(|cache| cache.revision != data.revision);
        if rebuild {
            data.pal_index =
                Some(pals::build_index(&data.save, data.revision).map_err(ApiError::BadRequest)?);
        }
        Ok::<_, ApiError>(pals::list(
            data.pal_index.as_ref().expect("cache was built"),
            query.offset,
            limit,
            &filter,
        ))
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Pal index task failed: {error}")))??;
    Ok(Json(response))
}

async fn get_pal(
    State(state): State<Arc<AppState>>,
    Path((id, pal_id)): Path<(Uuid, String)>,
) -> Result<Json<pals::PalDetail>, ApiError> {
    let save = state
        .sessions
        .get(&id)
        .map(|session| Arc::clone(&session.save))
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;
    let response = tokio::task::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| ApiError::Internal(format!("Pal detail task failed: {error}")))??;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{Request, header::CONTENT_TYPE};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;
    use uesave::{Header, MapEntry, Properties, Property, PropertySchemas, Root, StructValue};

    fn test_save(properties: Properties) -> Save {
        let header: Header = serde_json::from_value(json!({
            "magic": u32::from_le_bytes(*b"GVAS"), "save_game_version": 3,
            "package_version": { "ue4": 522, "ue5": 1009 },
            "engine_version_major": 5, "engine_version_minor": 1, "engine_version_patch": 1,
            "engine_version_build": 0, "engine_version": "test", "custom_version": [0, []]
        }))
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
        revision: u64,
    ) -> (Arc<AppState>, Uuid, Arc<Mutex<SaveSessionData>>) {
        let state = Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        });
        let id = Uuid::new_v4();
        let data = Arc::new(Mutex::new(SaveSessionData {
            save,
            dirty,
            revision,
            pal_index: None,
            player_saves: Vec::new(),
        }));
        state.sessions.insert(
            id,
            SaveSession {
                file_name: "test.sav".into(),
                original_size: 0,
                decompressed_size: 0,
                save: Arc::clone(&data),
            },
        );
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
        key.insert(
            "PlayerUId",
            Property::Struct(StructValue::Guid(uesave::FGuid::nil())),
        );
        key.insert("InstanceId", Property::Struct(StructValue::Guid(instance)));
        key.insert("DebugName", Property::Str("synthetic".into()));
        let entry = MapEntry {
            key: Property::Struct(StructValue::Struct(key)),
            value: Property::Struct(StructValue::Struct(Properties::default())),
        };
        let mut world = Properties::default();
        world.insert("CharacterSaveParameterMap", Property::Map(vec![entry]));
        let mut root = Properties::default();
        root.insert(
            "worldSaveData",
            Property::Struct(StructValue::Struct(world)),
        );
        test_save(root)
    }

    #[tokio::test]
    async fn pals_missing_session_is_structured_404() {
        let app = build_app(Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        }));
        let id = Uuid::new_v4();
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/pals"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(
            json_body(response).await["error"]
                .as_str()
                .unwrap()
                .contains("not found")
        );
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
                        .unwrap(),
                )
                .await
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
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_body(response).await["mapIndex"], 0);
        let response = app
            .oneshot(
                Request::builder()
                    .uri(format!("/sessions/{id}/pals/map%3A99"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn malformed_pal_query_is_structured_400() {
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        for query in [
            "limit=nope",
            "limit=0",
            "limit=201",
            "minLevel=3&maxLevel=2",
        ] {
            let response = build_app(Arc::clone(&state))
                .oneshot(
                    Request::builder()
                        .uri(format!("/sessions/{id}/pals?{query}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
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
        mutate_session_data(
            &mut data,
            UpdateScalarRequest {
                path: vec![nodes::PathSegment::Property {
                    name: "Value".into(),
                    index: 0,
                }],
                expected_revision: 0,
                value: nodes::EditableScalarValue::Int32(8),
            },
        )
        .unwrap();
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
        assert!(matches!(
            result,
            Err(ApiError::Conflict {
                current_revision: 2,
                ..
            })
        ));
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
        assert!(matches!(
            run_revisioned_mutation(&mut dirty, &mut revision, 1, || Ok::<_, ApiError>(())),
            Err(ApiError::Conflict {
                current_revision: 2,
                ..
            })
        ));
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
            assert!(matches!(
                mutate_session_data(&mut data, request),
                Err(ApiError::Internal(_))
            ));
            assert_eq!(
                data.save
                    .root
                    .properties
                    .0
                    .get(&uesave::PropertyKey(0, "Value".into())),
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
                data.save
                    .root
                    .properties
                    .0
                    .get(&uesave::PropertyKey(0, "Value".into())),
                Some(&Property::Int(7))
            );
        }
    }

    #[tokio::test]
    async fn scalar_http_errors_have_expected_status_and_conflict_shape() {
        let missing = Uuid::new_v4();
        let app = build_app(Arc::new(AppState {
            sessions: Arc::new(DashMap::new()),
            max_decompressed_size: DEFAULT_MAX_DECOMPRESSED_SIZE,
        }));
        let response = app
            .clone()
            .oneshot(scalar_request(
                missing,
                json!({"path":[],"expectedRevision":0,"value":{"type":"int32","value":1}}),
            ))
            .await
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
        assert_eq!(
            body["value"],
            json!({"type":"uint64","value":"18446744073709551615"})
        );
        assert_eq!(body["dirty"], true);
        assert_eq!(body["revision"], 1);
        let data = data.lock().unwrap();
        assert_eq!(
            data.save
                .root
                .properties
                .0
                .get(&uesave::PropertyKey(0, "Big".into())),
            Some(&Property::UInt64(u64::MAX))
        );
    }

    #[test]
    fn synthetic_empty_save_writes_and_reparses() {
        let bytes = palsave_core::write_sav(&test_save(Properties::default()))
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
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-palsave-revision"], "9");
            assert_eq!(response.headers()["x-palsave-dirty"], "true");
            assert_eq!(
                response.headers()["x-palsave-validated"],
                if validate { "true" } else { "false" }
            );
            let data = data.lock().unwrap();
            assert!(data.dirty);
            assert_eq!(data.revision, 9);
        }
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
            .oneshot(pal_update_request(
                id,
                "map:0",
                json!({"expectedRevision":0,"level":{"value":2}}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let (state, id, _) = state_with_save(test_pal_save(), false, 0);
        let response = build_app(state)
            .oneshot(pal_update_request(
                id,
                "map:99",
                json!({"expectedRevision":0,"level":{"value":2}}),
            ))
            .await
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
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
        let unknown = app
            .clone()
            .oneshot(pal_update_request(
                id,
                "map:0",
                json!({"expectedRevision":2,"unknown":1}),
            ))
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::BAD_REQUEST);
        let stale = app
            .oneshot(pal_update_request(
                id,
                "map:0",
                json!({"expectedRevision":1,"level":{"value":2}}),
            ))
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        let body = json_body(stale).await;
        assert_eq!(body["currentRevision"], 2);
        assert_eq!(body["code"], "revisionConflict");
    }
}
