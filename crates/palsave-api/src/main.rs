use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::env;
use tower_http::trace::TraceLayer;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "palsave-api",
    })
}

fn server_address() -> Result<(String, u16), Box<dyn std::error::Error>> {
    let host = env::var("PALSAVE_API_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("PALSAVE_API_PORT")
        .ok()
        .map(|value| value.parse::<u16>())
        .transpose()?
        .unwrap_or(47_831);

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

    let app = Router::new()
        .route("/health", get(health))
        .layer(TraceLayer::new_for_http());

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
