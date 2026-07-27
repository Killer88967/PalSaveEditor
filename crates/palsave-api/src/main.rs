use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use dashmap::DashMap;
use serde::Serialize;
use std::{env, sync::Arc};
use tower_http::trace::TraceLayer;
use uesave::Save;
use uuid::Uuid;

const DEFAULT_PORT: u16 = 47_831;
const MAX_UPLOAD_SIZE: usize = 512 * 1024 * 1024;

type SessionStore = Arc<DashMap<Uuid, SaveSession>>;

struct AppState {
    sessions: SessionStore,
}

struct SaveSession {
    file_name: String,
    original_size: usize,
    save: Save,
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
}

#[derive(Debug, Serialize)]
struct DeleteSessionResponse {
    deleted: bool,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

enum ApiError {
    BadRequest(String),
    NotFound(String),
    PayloadTooLarge(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::PayloadTooLarge(message) => (StatusCode::PAYLOAD_TOO_LARGE, message),
            Self::Internal(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };

        (status, Json(ErrorResponse { error: message })).into_response()
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
    let mut uploaded_file: Option<(String, Vec<u8>)> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::BadRequest(format!("invalid multipart upload: {error}")))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let file_name = field
            .file_name()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Level.sav".to_string());

        let bytes = field.bytes().await.map_err(|error| {
            ApiError::BadRequest(format!("failed to read uploaded file: {error}"))
        })?;

        if bytes.len() > MAX_UPLOAD_SIZE {
            return Err(ApiError::PayloadTooLarge(format!(
                "uploaded file is too large: {} bytes",
                bytes.len()
            )));
        }

        uploaded_file = Some((file_name, bytes.to_vec()));
        break;
    }

    let (file_name, bytes) = uploaded_file
        .ok_or_else(|| ApiError::BadRequest("missing multipart field named `file`".to_string()))?;

    if !file_name.to_ascii_lowercase().ends_with(".sav") {
        return Err(ApiError::BadRequest(
            "uploaded file must have a .sav extension".to_string(),
        ));
    }

    let original_size = bytes.len();

    let save = tokio::task::spawn_blocking(move || palsave_core::parse_sav(&bytes))
        .await
        .map_err(|error| ApiError::Internal(format!("save parser task failed: {error}")))?
        .map_err(ApiError::BadRequest)?;

    let id = Uuid::new_v4();

    state.sessions.insert(
        id,
        SaveSession {
            file_name: file_name.clone(),
            original_size,
            save,
        },
    );

    tracing::info!(
        %id,
        %file_name,
        original_size,
        "created save session"
    );

    Ok((
        StatusCode::CREATED,
        Json(SessionResponse {
            id,
            file_name,
            original_size,
        }),
    ))
}

async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<SessionResponse>, ApiError> {
    let session = state
        .sessions
        .get(&id)
        .ok_or_else(|| ApiError::NotFound(format!("save session {id} was not found")))?;

    Ok(Json(SessionResponse {
        id,
        file_name: session.file_name.clone(),
        original_size: session.original_size,
    }))
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

fn server_address() -> Result<(String, u16), Box<dyn std::error::Error>> {
    let host = env::var("PALSAVE_API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

    let port = env::var("PALSAVE_API_PORT")
        .ok()
        .map(|value| value.parse::<u16>())
        .transpose()?
        .unwrap_or(DEFAULT_PORT);

    Ok((host, port))
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
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", post(create_session))
        .route("/sessions/{id}", get(get_session).delete(delete_session))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

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
