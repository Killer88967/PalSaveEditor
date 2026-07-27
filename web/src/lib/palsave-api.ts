export interface HealthResponse {
  status: "ok";
  service: "palsave-api";
}

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/rust/health");

  if (!response.ok) {
    throw new Error(`PalSave API health check failed (${response.status})`);
  }

  return response.json() as Promise<HealthResponse>;
}
