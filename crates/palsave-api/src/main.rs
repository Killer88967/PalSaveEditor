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
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_revision: Option<u64>,
}

#[derive(Debug)]
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
    let max_decompressed_size = state.max_decompressed_size;

    let parsed = tokio::task
        ::spawn_blocking(move || {
            palsave_core::parse_sav_with_metadata_limit(&bytes, max_decompressed_size)
        }).await
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
    let SaveSessionData { save, dirty, revision } = data;
    let value = run_revisioned_mutation(dirty, revision, request.expected_revision, || {
        nodes::update_scalar(save, &request.path, request.value).map_err(ApiError::BadRequest)
    })?;
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
        .route("/sessions/{id}/root", get(get_root))
        .route("/sessions/{id}/inspect", post(inspect_node))
        .route("/sessions/{id}/scalar", patch(update_scalar))
        .route("/sessions/{id}/export", get(export_session))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{ Request, header::CONTENT_TYPE };
    use http_body_util::BodyExt;
    use serde_json::{ Value, json };
    use tower::ServiceExt;
    use uesave::{ Header, Properties, Property, PropertySchemas, Root };

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
            })
        );
        state.sessions.insert(id, SaveSession {
            file_name: "test.sav".into(),
            original_size: 0,
            decompressed_size: 0,
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
}
