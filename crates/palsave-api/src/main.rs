use axum::{
    Json,
    Router,
    body::Body,
    extract::{ DefaultBodyLimit, Multipart, Path, Query, State, rejection::JsonRejection },
    http::{ HeaderName, HeaderValue, StatusCode, header::{ CONTENT_DISPOSITION, CONTENT_TYPE } },
    response::{ IntoResponse, Response },
    routing::{ get, patch, post },
};
use dashmap::DashMap;
use serde::{ Deserialize, Serialize };
use std::{ env, sync::{ Arc, Mutex } };
use tower_http::trace::TraceLayer;
use uesave::Save;
use uuid::Uuid;

mod nodes;

const DEFAULT_PORT: u16 = 47_831;
const MAX_UPLOAD_SIZE: usize = 512 * 1024 * 1024;

type SessionStore = Arc<DashMap<Uuid, SaveSession>>;

struct AppState {
    sessions: SessionStore,
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
}

#[derive(Debug, Deserialize)]
struct PageQuery {
    #[serde(default)]
    offset: usize,
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
struct DeleteSessionResponse {
    deleted: bool,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_revision: Option<u64>,
}

enum ApiError {
    BadRequest(String),
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
        let (status, message, code, current_revision) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message, None, None),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message, None, None),
            Self::PayloadTooLarge(message) => (StatusCode::PAYLOAD_TOO_LARGE, message, None, None),
            Self::Conflict { message, current_revision } =>
                (StatusCode::CONFLICT, message, Some("revisionConflict"), Some(current_revision)),
            Self::Internal(message) => (StatusCode::INTERNAL_SERVER_ERROR, message, None, None),
        };
        (
            status,
            Json(ErrorResponse {
                error: message,
                code,
                current_revision,
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
    let mut uploaded_file: Option<(String, Vec<u8>)> = None;

    while
        let Some(field) = multipart
            .next_field().await
            .map_err(|error| ApiError::BadRequest(format!("invalid multipart upload: {error}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let file_name = field
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Level.sav".to_string());

        let bytes = field
            .bytes().await
            .map_err(|error| {
                ApiError::BadRequest(format!("failed to read uploaded file: {error}"))
            })?;

        if bytes.len() > MAX_UPLOAD_SIZE {
            return Err(
                ApiError::PayloadTooLarge(
                    format!("uploaded file is too large: {} bytes", bytes.len())
                )
            );
        }

        uploaded_file = Some((file_name, bytes.to_vec()));
        break;
    }

    let (file_name, bytes) = uploaded_file.ok_or_else(||
        ApiError::BadRequest("missing multipart field named `file`".to_string())
    )?;

    if !file_name.to_ascii_lowercase().ends_with(".sav") {
        return Err(ApiError::BadRequest("uploaded file must have a .sav extension".to_string()));
    }

    let original_size = bytes.len();

    let parsed = tokio::task
        ::spawn_blocking(move || palsave_core::parse_sav_with_metadata(&bytes)).await
        .map_err(|error| ApiError::Internal(format!("save parser task failed: {error}")))?
        .map_err(ApiError::BadRequest)?;
    let decompressed_size = parsed.decompressed_size;

    let id = Uuid::new_v4();

    state.sessions.insert(id, SaveSession {
        file_name: file_name.clone(),
        original_size,
        decompressed_size,
        save: Arc::new(
            Mutex::new(SaveSessionData {
                save: parsed.save,
                dirty: false,
                revision: 0,
            })
        ),
    });

    tracing::info!(
        %id,
        %file_name,
        original_size,
        decompressed_size,
        "created save session"
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
        }),
    ))
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>
) -> Result<Json<SessionResponse>, ApiError> {
    let (file_name, original_size, decompressed_size, save) = state.sessions
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
    let (dirty, revision) = tokio::task
        ::spawn_blocking(move || {
            let data = save
                .lock()
                .map_err(|_| ApiError::Internal("save session lock was poisoned".to_string()))?;
            Ok::<_, ApiError>((data.dirty, data.revision))
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
        })
    )
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

fn mutate_session_data(
    data: &mut SaveSessionData,
    request: UpdateScalarRequest
) -> Result<UpdateScalarResponse, ApiError> {
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
    let value = nodes
        ::update_scalar(&mut data.save, &request.path, request.value)
        .map_err(ApiError::BadRequest)?;
    data.dirty = true;
    data.revision = data.revision
        .checked_add(1)
        .ok_or_else(|| ApiError::Internal("session revision overflow".to_string()))?;
    Ok(UpdateScalarResponse {
        path: request.path,
        value,
        dirty: data.dirty,
        revision: data.revision,
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
    Response::builder()
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_DISPOSITION, "attachment; filename=\"Level.roundtrip.sav\"")
        .header(
            HeaderName::from_static("x-palsave-revision"),
            HeaderValue::from_str(&revision.to_string()).map_err(|e|
                ApiError::Internal(e.to_string())
            )?
        )
        .header(HeaderName::from_static("x-palsave-dirty"), if dirty { "true" } else { "false" })
        .header(HeaderName::from_static("x-palsave-validated"), if validated {
            "true"
        } else {
            "false"
        })
        .body(Body::from(bytes))
        .map_err(|error| ApiError::Internal(format!("failed to build export response: {error}")))
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
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", post(create_session))
        .route("/sessions/{id}", get(get_session).delete(delete_session))
        .route("/sessions/{id}/root", get(get_root))
        .route("/sessions/{id}/inspect", post(inspect_node))
        .route("/sessions/{id}/scalar", patch(update_scalar))
        .route("/sessions/{id}/export", get(export_session))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

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
