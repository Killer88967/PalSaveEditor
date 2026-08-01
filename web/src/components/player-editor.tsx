"use client";

import { useEffect, useState } from "react";
import {
  getPlayerStats,
  updatePlayerStats,
  PalSaveApiError,
  type PlayerDetail,
  type PlayerStatusPoint,
} from "@/lib/palsave-api";
import {
  buildPlayerUpdate,
  hasChanges,
  maxLevel,
  spentPoints,
  validatePlayerForm,
  MAX_STATUS_POINT,
  type StatusKind,
} from "@/lib/player-form";
import { formatCount, shortId } from "@/lib/format";
import { AlertIcon, PlayerIcon } from "@/components/icons";

const STATUS_GROUPS = [
  {
    kind: "statusPoints" as StatusKind,
    title: "Status points",
    hint: "The points spent on level-up. The game derives HP, stamina and carry weight from these.",
  },
  {
    kind: "exStatusPoints" as StatusKind,
    title: "Bonus status points",
    hint: "The separate allocation Palworld tracks alongside the main one.",
  },
];

export function PlayerEditor({
  sessionId,
  revision,
  focusPlayerUid,
  onSessionUpdateAction,
}: {
  sessionId: string;
  revision: number;
  /** Pre-selects a player, e.g. after clicking a row in the overview. */
  focusPlayerUid?: string;
  onSessionUpdateAction: (dirty: boolean, revision: number) => void;
}) {
  const [players, setPlayers] = useState<PlayerDetail[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    const abort = new AbortController();

    void getPlayerStats(sessionId, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        const requested = focusPlayerUid
          ? value.find(
              (player) =>
                player.playerUid?.toLowerCase() ===
                focusPlayerUid.toLowerCase(),
            )
          : undefined;
        const chosen = requested ?? value[0];
        setPlayers(value);
        setSelected(chosen?.playerUid ?? "");
        setForm(chosen ?? null);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [sessionId, focusPlayerUid]);

  const original = players.find((player) => player.playerUid === selected);

  function choose(playerUid: string) {
    setSelected(playerUid);
    setForm(players.find((player) => player.playerUid === playerUid) ?? null);
    setFields({});
    setError(undefined);
    setNotice(undefined);
  }

  function setStatus(kind: StatusKind, name: string, point: number) {
    setForm((current) =>
      current
        ? {
            ...current,
            [kind]: current[kind].map((entry) =>
              entry.name === name ? { ...entry, point } : entry,
            ),
          }
        : current,
    );
  }

  async function submit() {
    if (!original || !form || !form.playerUid) return;

    const invalid = validatePlayerForm(form);
    if (Object.keys(invalid).length) {
      setFields(invalid);
      setNotice(undefined);
      return;
    }

    const request = buildPlayerUpdate(original, form, revision);
    if (!hasChanges(request)) {
      setNotice("Nothing changed, so nothing was written.");
      return;
    }

    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    setFields({});
    try {
      const response = await updatePlayerStats(
        sessionId,
        form.playerUid,
        request,
      );
      setPlayers((current) =>
        current.map((player) =>
          player.playerUid === response.player.playerUid
            ? response.player
            : player,
        ),
      );
      setForm(response.player);
      setNotice(
        `Saved ${response.player.nickname || shortId(form.playerUid)} at level ${response.player.level ?? "?"}.`,
      );
      onSessionUpdateAction(response.dirty, response.revision);
    } catch (cause) {
      const failure = cause as Error & { fields?: Record<string, string> };
      setError(
        cause instanceof PalSaveApiError && cause.status === 409
          ? `${failure.message}. Reload before retrying.`
          : failure.message,
      );
      setFields(failure.fields ?? {});
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Loading players…
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="alert alert-warning">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-warning" />
        <div>
          <p className="font-medium">No player characters in this world</p>
          <p className="mt-1 text-muted">
            Player rows live in <code className="text-accent">Level.sav</code>,
            inside <code>CharacterSaveParameterMap</code>. This world file holds
            none the editor recognises.
          </p>
        </div>
      </div>
    );
  }

  const capabilities = form?.editCapabilities;
  const limit = form ? maxLevel(form) : 0;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <label className="min-w-56">
          <span className="field-label">Player</span>
          <select
            value={selected}
            onChange={(event) => choose(event.target.value)}
            className="field"
          >
            {players.map((player) => (
              <option key={player.id} value={player.playerUid ?? ""}>
                {player.nickname || shortId(player.playerUid ?? player.id)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2 pb-1">
          {form?.playerUid && (
            <span className="badge" title={form.playerUid}>
              <span className="font-mono">{shortId(form.playerUid)}</span>
            </span>
          )}
          {original?.level !== undefined && (
            <span className="badge badge-accent">Level {original.level}</span>
          )}
          {original?.exp !== undefined && (
            <span className="badge">{formatCount(original.exp)} XP</span>
          )}
        </div>
      </div>

      {error && (
        <p className="alert alert-danger text-sm" role="alert">
          {error}
        </p>
      )}

      {notice && !error && (
        <p className="alert alert-accent text-sm" role="status">
          {notice}
        </p>
      )}

      {form && capabilities && (
        <form
          className="card space-y-5 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-accent-soft p-1.5 text-accent">
              <PlayerIcon className="size-4" />
            </span>
            <h3 className="font-medium">
              {form.nickname || shortId(form.playerUid ?? form.id)}
            </h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {capabilities.level && (
              <NumberField
                label="Level"
                hint={`1 – ${limit}`}
                min={1}
                max={limit}
                value={form.level}
                error={fields.level}
                onChange={(value) =>
                  setForm((current) =>
                    current ? { ...current, level: value } : current,
                  )
                }
              />
            )}
            {capabilities.exp && (
              <NumberField
                label="Experience"
                hint="Total XP earned"
                min={0}
                value={form.exp}
                error={fields.exp}
                onChange={(value) =>
                  setForm((current) =>
                    current ? { ...current, exp: value } : current,
                  )
                }
              />
            )}
            {capabilities.unusedStatusPoint && (
              <NumberField
                label="Unspent points"
                hint={`0 – ${MAX_STATUS_POINT}`}
                min={0}
                max={MAX_STATUS_POINT}
                value={form.unusedStatusPoint}
                error={fields.unusedStatusPoint}
                onChange={(value) =>
                  setForm((current) =>
                    current
                      ? { ...current, unusedStatusPoint: value }
                      : current,
                  )
                }
              />
            )}
          </div>

          {STATUS_GROUPS.map(
            ({ kind, title, hint }) =>
              capabilities[kind] && (
                <StatusGroup
                  key={kind}
                  title={title}
                  hint={hint}
                  points={form[kind]}
                  errors={fields}
                  kind={kind}
                  onChange={(name, value) => setStatus(kind, name, value)}
                />
              ),
          )}

          <div className="alert alert-warning text-xs">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Level and experience are stored separately, so raising one leaves
              the other where it was — set both if you want the next level-up to
              behave. HP, stamina and carry weight are not stored directly:
              Palworld recalculates them in-game from the level and the points
              below.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-sm"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(original ?? null);
                setFields({});
                setError(undefined);
                setNotice(undefined);
              }}
              className="btn btn-secondary btn-sm"
            >
              Reset
            </button>
          </div>

          {form.missingFields.length > 0 && (
            <div className="alert alert-warning text-xs">
              <AlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>
                <strong className="font-medium">
                  Not present in this entry:
                </strong>{" "}
                {form.missingFields.join(", ")}. Those fields are hidden rather
                than created, so the save keeps its original shape.
              </p>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function StatusGroup({
  title,
  hint,
  points,
  kind,
  errors,
  onChange,
}: {
  title: string;
  hint: string;
  points: PlayerStatusPoint[];
  kind: StatusKind;
  errors: Record<string, string>;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="badge">{spentPoints(points)} spent</span>
      </div>
      <p className="mt-0.5 text-xs text-subtle">{hint}</p>

      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {points.map((entry) => (
          <NumberField
            key={entry.name}
            label={entry.label}
            hint={entry.label === entry.name ? undefined : entry.name}
            min={0}
            max={MAX_STATUS_POINT}
            value={entry.point}
            disabled={!entry.editable}
            error={errors[`${kind}:${entry.name}`]}
            onChange={(value) => onChange(entry.name, value)}
          />
        ))}
      </div>
    </section>
  );
}

function NumberField({
  label,
  hint,
  min,
  max,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max?: number;
  value?: number;
  error?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field tabular-nums"
        aria-invalid={Boolean(error)}
      />
      {(error || hint) && (
        <span
          className={`mt-1 block text-xs ${error ? "text-danger" : "text-subtle"}`}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
