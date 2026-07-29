# syntax=docker/dockerfile:1

FROM rust:1.88-bookworm AS api-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --locked --release -p palsave-api

FROM debian:bookworm-slim AS api
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 palsave
COPY --from=api-builder /app/target/release/palsave-api /usr/local/bin/palsave-api
USER palsave
EXPOSE 47831
ENV PALSAVE_API_HOST=0.0.0.0 \
    PALSAVE_API_PORT=47831
ENTRYPOINT ["palsave-api"]

FROM oven/bun:1 AS web-builder
WORKDIR /app
ENV RUST_API_URL=http://api:47831
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web ./
RUN bun run build

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    RUST_API_URL=http://api:47831
RUN groupadd --system --gid 10001 palsave \
    && useradd --system --uid 10001 --gid palsave palsave
COPY --from=web-builder --chown=palsave:palsave /app/.next/standalone ./
COPY --from=web-builder --chown=palsave:palsave /app/.next/static ./.next/static
COPY --from=web-builder --chown=palsave:palsave /app/public ./public
USER palsave
EXPOSE 3000
CMD ["node", "server.js"]
