# PalSave Editor

A browser-based editor for Palworld save files. It can inspect the raw save
tree, edit supported Pal and inventory fields, and export a validated
`Level.sav`.

> [!CAUTION]
> Back up your entire world save directory before editing it. This project is
> experimental and is not affiliated with Pocketpair.

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

## License

See [LICENSE](LICENSE).
