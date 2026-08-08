# PalSave Editor

[![Build](https://github.com/Killer88967/PalSaveEditor/actions/workflows/build.yml/badge.svg)](https://github.com/Killer88967/PalSaveEditor/actions/workflows/build.yml)
[![GitHub Issues](https://img.shields.io/github/issues/Killer88967/PalSaveEditor)](https://github.com/Killer88967/PalSaveEditor/issues)
[![GitHub Stars](https://img.shields.io/github/stars/Killer88967/PalSaveEditor)](https://github.com/Killer88967/PalSaveEditor/stargazers)
[![GitHub License](https://img.shields.io/github/license/Killer88967/PalSaveEditor)](LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/Killer88967/PalSaveEditor)](https://github.com/Killer88967/PalSaveEditor/commits/main)
[![GitHub Repo Size](https://img.shields.io/github/repo-size/Killer88967/PalSaveEditor)](#)

[![Rust](https://img.shields.io/badge/Rust-Backend-black?logo=rust)](https://rust-lang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-Frontend-black?logo=nextdotjs)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/)

A browser-based decompiler, recompiler and editor for Palworld save files. It
decompresses both container formats, parses the Unreal property tree, lets you
edit Pals, inventories and individual scalars, and exports a validated
`Level.sav`.

> [!CAUTION]
> Back up your entire world save directory before editing it. This project is
> experimental and is not affiliated with Pocketpair.

## What it does

| Page      | Purpose                                                          |
| --------- | ---------------------------------------------------------------- |
| `/`       | Overview of the project and the container format                 |
| `/editor` | Load a world: dashboard, Pals, players, inventories and raw tree |
| `/tools`  | Stateless `.sav` ⇄ `.gvas` conversion, no session needed         |
| `/wiki`   | Palworld game data (Pals, items, skills, tech) and editor docs   |
| `/guide`  | Save locations, backup steps, format notes and troubleshooting   |

Inside the editor:

- **Overview** — sizes every `worldSaveData` collection and digests the
  character map: species leaders, level spread, per-player Pal counts, parse
  coverage and the decoded container header.
- **Pals** — search by species, nickname or instance ID, filter by level, and
  edit level, star rank, gender, souls, IVs, nickname and skill lists.
- **Players** — edit each player's level, total experience and status points
  (HP, stamina, attack, carry weight, capture power, work speed). Level is
  limited only by what the save field can store; status points cap at 255, as
  Pal souls and IVs do.
- **Inventories** — walk each player's personal containers (pack, key items,
  weapon loadout, armour, food), add or remove items in any free slot, and
  rewrite item IDs and stack quantities. Suggestions are drawn from the item
  IDs the uploaded world actually contains.
- **Raw tree** — page through every parsed property with types, child counts and
  byte lengths, and edit any scalar the parser understands.

Outside the editor, `/wiki` is a browsable copy of Palworld's own game data —
809 Pals, 2,352 items, active and passive skills, elements, work suitability,
technologies and buildings — so the IDs the editor writes can be looked up
without leaving the app. Its Usage, Reference and FAQ pages document the editor
itself. Regenerate the data with `npm run wiki:data` (see
`scripts/build-wiki-data.mjs`).

Both container variants are read: `PlZ` (zlib, pre-0.6) and `PlM` (Oodle Kraken,
0.6 onward). Exports are always written as single-pass `PlZ`, which Palworld
loads and re-saves in its own format.

## Run with Docker

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) or
Docker Engine with the Compose plugin.

```sh
git clone https://github.com/Killer88967/PalSaveEditor.git
cd PalSaveEditor
docker compose up --build -d
```

Open <http://localhost:3000>. Stop the editor with:

```sh
docker compose down
```

To update an existing checkout:

```sh
git pull
docker compose up --build -d
```

The browser is the only service exposed to your computer. Uploaded saves are
kept in API memory, are not written into the container, and disappear when the
API container restarts.

### Choose another port

Copy the example settings and edit `PALSAVE_PORT`:

```sh
cp .env.example .env
docker compose up --build -d
```

For example, `PALSAVE_PORT=8080` makes the editor available at
<http://localhost:8080>. The example file also contains the maximum
decompressed save size and log settings.

### Troubleshooting

View service logs:

```sh
docker compose logs -f
```

Recreate both containers after changing configuration:

```sh
docker compose up --build -d --force-recreate
```

If Docker runs out of memory while opening a large world, increase the memory
available to Docker Desktop. The default decompressed-save limit is 2 GiB.

## Using the editor

1. Stop the game or dedicated server so it cannot overwrite the save.
2. Copy the complete world save directory to a safe backup location.
3. Upload `Level.sav`. To edit player inventories, select `Level.sav` and the
   relevant `.sav` files from the adjacent `Players` directory together.
4. Make your changes and download the exported save.
5. Keep the original backup, then replace the game's `Level.sav` while the game
   or server is stopped.

Steam saves on Windows are commonly under:

```text
%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<Steam ID>\\<World ID>\\
```

The location for dedicated servers and Proton installations depends on their
configuration. Search for a directory containing both `Level.sav` and
`Players/` if needed.

## Local development

Install Rust, [Bun](https://bun.sh/), and the project dependencies:

```sh
cd web
bun install
bun run dev
```

This starts Next.js on <http://localhost:3000> and the Rust API on
<http://localhost:47831>. Useful checks are:

```sh
cargo test --workspace
cd web
bun test
bun run lint
bun run build
```

The API supports these optional environment variables:

- `PALSAVE_API_HOST` (default `0.0.0.0`)
- `PALSAVE_API_PORT` (default `47831`)
- `PALSAVE_MAX_DECOMPRESSED_SIZE` in bytes (default 2 GiB)
- `RUST_LOG` for log filtering

### API routes

The browser reaches these through the Next.js rewrite at `/api/rust/*`.

| Method   | Route                                                                | Purpose                                     |
| -------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `GET`    | `/health`                                                            | Liveness probe                              |
| `POST`   | `/sessions`                                                          | Parse an upload into a session              |
| `GET`    | `/sessions/{id}`                                                     | Session metadata and decoded container      |
| `GET`    | `/sessions/{id}/overview`                                            | Dashboard statistics                        |
| `GET`    | `/sessions/{id}/root`                                                | First page of root properties               |
| `POST`   | `/sessions/{id}/inspect`                                             | Page the children of any property path      |
| `PATCH`  | `/sessions/{id}/scalar`                                              | Write one scalar                            |
| `GET`    | `/sessions/{id}/pals`                                                | Filtered, paged character index             |
| `GET`    | `/sessions/{id}/pals/{palId}`                                        | Full Pal detail and edit capabilities       |
| `PATCH`  | `/sessions/{id}/pals/{palId}`                                        | Update supported Pal fields                 |
| `GET`    | `/sessions/{id}/players`                                             | Players and their container references      |
| `GET`    | `/sessions/{id}/player-stats`                                        | Player level, experience and status points  |
| `PATCH`  | `/sessions/{id}/player-stats/{uid}`                                  | Update player level and status points       |
| `GET`    | `/sessions/{id}/items`                                               | Item IDs present in the world, with counts  |
| `GET`    | `/sessions/{id}/players/{uid}/inventory`                             | Slots for a player's personal containers    |
| `POST`   | `/sessions/{id}/players/{uid}/inventory/{containerId}/slots`         | Add an item to a free slot                  |
| `PATCH`  | `/sessions/{id}/players/{uid}/inventory/{containerId}/slots/{index}` | Write one inventory slot                    |
| `DELETE` | `/sessions/{id}/players/{uid}/inventory/{containerId}/slots/{index}` | Empty a slot by dropping its entry          |
| `GET`    | `/sessions/{id}/export?validate=true`                                | Recompiled `.sav`, re-parsed before sending |
| `GET`    | `/sessions/{id}/gvas`                                                | Uncompressed GVAS for the current tree      |
| `POST`   | `/convert/decompile`                                                 | `.sav` → raw GVAS, stateless                |
| `POST`   | `/convert/recompile`                                                 | Raw GVAS → `.sav`, stateless                |
| `DELETE` | `/sessions/{id}`                                                     | Drop the session from memory                |

Mutating routes take an `expectedRevision` and answer `409` with the current
revision when a write races, so a stale view cannot silently overwrite an edit.
Downloads carry `x-palsave-revision`, `x-palsave-dirty`, `x-palsave-compression`
and `x-palsave-decompressed-size` headers; `/export` adds `x-palsave-validated`.

## License

See [LICENSE](LICENSE).
