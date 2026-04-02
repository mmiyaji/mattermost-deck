import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getChannelByName,
  getChannelsForCurrentUser,
  getCurrentUser,
  getRecentPosts,
  getTeamByName,
  getTeamUnread,
  getTeamsForCurrentUser,
  readCurrentRoute,
  type MattermostChannel,
  type MattermostPost,
  type MattermostTeam,
  type TeamUnread,
} from "../mattermost/api";
import { createColumn, getColumnTitle, STORAGE_KEY, type DeckColumn, type DeckColumnType } from "./layout";
import { loadDeckLayout, loadStoredNumber, saveDeckLayout, saveStoredNumber } from "./storage";

interface AppProps {
  routeKey: string;
}

interface AppState {
  status: "loading" | "ready" | "error";
  userId: string | null;
  username: string | null;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  currentTeamId: string | undefined;
  currentChannelId: string | undefined;
  currentTeamLabel: string | null;
  currentChannelLabel: string | null;
  error: string | null;
}

interface ChannelState {
  status: "idle" | "loading" | "ready" | "error";
  channels: MattermostChannel[];
  error: string | null;
}

interface PostState {
  status: "idle" | "loading" | "ready" | "error";
  posts: MattermostPost[];
  error: string | null;
}

const POLL_INTERVAL_MS = 15_000;
const AVAILABLE_COLUMN_TYPES: DeckColumnType[] = ["mentions", "channelWatch"];
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const MIN_RAIL_WIDTH = 360;
const MAX_RAIL_WIDTH = 1400;
const DEFAULT_RAIL_WIDTH = 720;

function formatPostTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function summarisePost(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(empty message)";
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

async function loadAppState(): Promise<Omit<AppState, "status" | "error">> {
  const route = readCurrentRoute();
  const user = await getCurrentUser();

  const [teams, unreads, routeTeam] = await Promise.all([
    getTeamsForCurrentUser(),
    getTeamUnread(user.id),
    route.teamName ? getTeamByName(route.teamName).catch(() => null) : Promise.resolve(null),
  ]);

  const routeChannel =
    routeTeam && route.channelName
      ? await getChannelByName(routeTeam.id, route.channelName).catch(() => null)
      : null;

  return {
    userId: user.id,
    username: user.username,
    teams,
    unreads,
    currentTeamId: routeTeam?.id,
    currentChannelId: routeChannel?.id,
    currentTeamLabel: routeTeam?.display_name ?? routeTeam?.name ?? route.teamName,
    currentChannelLabel: routeChannel?.display_name ?? routeChannel?.name ?? route.channelName,
  };
}

function useDeckState(routeKey: string): AppState {
  const [state, setState] = useState<AppState>({
    status: "loading",
    userId: null,
    username: null,
    teams: [],
    unreads: [],
    currentTeamId: undefined,
    currentChannelId: undefined,
    currentTeamLabel: null,
    currentChannelLabel: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const data = await loadAppState();
        if (!cancelled) {
          setState({
            status: "ready",
            error: null,
            ...data,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "error",
            error: error instanceof Error ? error.message : "Failed to load Mattermost data.",
          }));
        }
      }
    };

    setState((current) => ({
      ...current,
      status: "loading",
      error: null,
    }));

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [routeKey]);

  return state;
}

function useDeckLayout(): [
  DeckColumn[] | null,
  (type: DeckColumnType, defaults?: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void,
  (id: string) => void,
  (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void,
] {
  const [columns, setColumns] = useState<DeckColumn[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const layout = await loadDeckLayout(STORAGE_KEY);
      if (!cancelled) {
        setColumns(layout);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (nextColumns: DeckColumn[]): void => {
    setColumns(nextColumns);
    void saveDeckLayout(STORAGE_KEY, nextColumns);
  };

  const addColumn = (
    type: DeckColumnType,
    defaults: Partial<Pick<DeckColumn, "teamId" | "channelId">> = {},
  ): void => {
    const nextColumns = [...(columns ?? []), createColumn(type, defaults)];
    persist(nextColumns);
  };

  const removeColumn = (id: string): void => {
    const nextColumns = (columns ?? []).filter((column) => column.id !== id);
    persist(nextColumns.length > 0 ? nextColumns : [createColumn("mentions")]);
  };

  const updateColumn = (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>): void => {
    const nextColumns = (columns ?? []).map((column) =>
      column.id === id
        ? {
            ...column,
            ...patch,
          }
        : column,
    );
    persist(nextColumns);
  };

  return [columns, addColumn, removeColumn, updateColumn];
}

function clampRailWidth(nextWidth: number): number {
  const viewportMax = Math.max(MIN_RAIL_WIDTH, window.innerWidth - 320);
  return Math.min(Math.max(nextWidth, MIN_RAIL_WIDTH), Math.min(MAX_RAIL_WIDTH, viewportMax));
}

function useRailWidth(): [number, (nextWidth: number) => void] {
  const [railWidth, setRailWidth] = useState<number>(DEFAULT_RAIL_WIDTH);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = await loadStoredNumber(RAIL_WIDTH_STORAGE_KEY);
      if (!cancelled && stored !== null) {
        setRailWidth(clampRailWidth(stored));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--mattermost-deck-rail-width", `${railWidth}px`);
    void saveStoredNumber(RAIL_WIDTH_STORAGE_KEY, railWidth);
  }, [railWidth]);

  useEffect(() => {
    const handleResize = () => {
      setRailWidth((current) => clampRailWidth(current));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return [railWidth, (nextWidth: number) => setRailWidth(clampRailWidth(nextWidth))];
}

function TeamSelect({
  teams,
  teamId,
  onChange,
}: {
  teams: MattermostTeam[];
  teamId?: string;
  onChange: (teamId: string) => void;
}): React.JSX.Element {
  return (
    <label className="deck-field">
      <span>Team</span>
      <select className="deck-select" value={teamId ?? ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select team</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.display_name || team.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MentionsColumn({
  column,
  teams,
  unreads,
  onUpdate,
  onRemove,
}: {
  column: DeckColumn;
  teams: MattermostTeam[];
  unreads: TeamUnread[];
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const mentionCount = column.teamId
    ? unreads.find((entry) => entry.team_id === column.teamId)?.mention_count ?? 0
    : null;

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div>
          <h2>Mentions</h2>
          <p>{selectedTeam ? selectedTeam.display_name || selectedTeam.name : "Pick a team for this column"}</p>
        </div>
        <div className="deck-column-actions">
          <div className="deck-badge">{mentionCount ?? "--"}</div>
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => onRemove(column.id)}
            aria-label="Remove mentions column"
          >
            x
          </button>
        </div>
      </header>

      <div className="deck-stack">
        <div className="deck-controls">
          <TeamSelect
            teams={teams}
            teamId={column.teamId}
            onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined })}
          />
        </div>

        {!column.teamId ? (
          <article className="deck-card">
            <strong>Select a team</strong>
            <p>This mentions pane stays pinned to the team you choose here.</p>
          </article>
        ) : (
          <>
            <article className="deck-card">
              <strong>Team</strong>
              <p>{selectedTeam?.display_name || selectedTeam?.name || "Unknown team"}</p>
            </article>
            <article className="deck-card">
              <strong>Mentions</strong>
              <p>{mentionCount === null ? "Loading..." : `${mentionCount} unread mention(s) in this team`}</p>
            </article>
          </>
        )}
      </div>
    </section>
  );
}

function ChannelWatchColumn({
  column,
  teams,
  onUpdate,
  onRemove,
}: {
  column: DeckColumn;
  teams: MattermostTeam[];
  onUpdate: (id: string, patch: Partial<Pick<DeckColumn, "teamId" | "channelId">>) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const [channelState, setChannelState] = useState<ChannelState>({
    status: "idle",
    channels: [],
    error: null,
  });
  const [postState, setPostState] = useState<PostState>({
    status: "idle",
    posts: [],
    error: null,
  });

  const selectedTeam = teams.find((team) => team.id === column.teamId);
  const selectedChannel = channelState.channels.find((channel) => channel.id === column.channelId);

  useEffect(() => {
    let cancelled = false;

    if (!column.teamId) {
      setChannelState({
        status: "idle",
        channels: [],
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setChannelState((current) => ({
        ...current,
        status: "loading",
        error: null,
      }));

      try {
        const channels = await getChannelsForCurrentUser(column.teamId as string);
        if (!cancelled) {
          setChannelState({
            status: "ready",
            channels,
            error: null,
          });

          if (column.channelId && !channels.some((channel) => channel.id === column.channelId)) {
            onUpdate(column.id, { channelId: undefined });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setChannelState({
            status: "error",
            channels: [],
            error: error instanceof Error ? error.message : "Failed to load channels.",
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [column.channelId, column.id, column.teamId, onUpdate]);

  useEffect(() => {
    let cancelled = false;

    if (!column.channelId) {
      setPostState({
        status: "idle",
        posts: [],
        error: null,
      });
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setPostState((current) => ({
        ...current,
        status: current.posts.length > 0 ? current.status : "loading",
        error: null,
      }));

      try {
        const posts = await getRecentPosts(column.channelId as string);
        if (!cancelled) {
          setPostState({
            status: "ready",
            posts,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPostState({
            status: "error",
            posts: [],
            error: error instanceof Error ? error.message : "Failed to load posts.",
          });
        }
      }
    };

    void run();
    const timer = window.setInterval(() => {
      void run();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [column.channelId]);

  return (
    <section className="deck-column">
      <header className="deck-column-header">
        <div>
          <h2>Channel Watch</h2>
          <p>{selectedChannel ? selectedChannel.display_name || selectedChannel.name : "Pick a team and channel"}</p>
        </div>
        <div className="deck-column-actions">
          <button
            type="button"
            className="deck-icon-button deck-icon-button--ghost"
            onClick={() => onRemove(column.id)}
            aria-label="Remove channel watch column"
          >
            x
          </button>
        </div>
      </header>

      <div className="deck-stack">
        <div className="deck-controls">
          <TeamSelect
            teams={teams}
            teamId={column.teamId}
            onChange={(teamId) => onUpdate(column.id, { teamId: teamId || undefined, channelId: undefined })}
          />
          <label className="deck-field">
            <span>Channel</span>
            <select
              className="deck-select"
              value={column.channelId ?? ""}
              disabled={!column.teamId || channelState.status === "loading"}
              onChange={(event) => onUpdate(column.id, { channelId: event.target.value || undefined })}
            >
              <option value="">Select channel</option>
              {channelState.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.display_name || channel.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!column.teamId ? (
          <article className="deck-card">
            <strong>Select a team</strong>
            <p>This pane no longer follows the main page. Choose a fixed team first.</p>
          </article>
        ) : !column.channelId ? (
          <article className="deck-card">
            <strong>Select a channel</strong>
            <p>{channelState.error ?? "Choose which channel this pane should watch."}</p>
          </article>
        ) : postState.status === "error" ? (
          <article className="deck-card">
            <strong>Failed to load posts</strong>
            <p>{postState.error ?? "Unknown error"}</p>
          </article>
        ) : postState.posts.length === 0 ? (
          <article className="deck-card">
            <strong>No posts yet</strong>
            <p>This pinned channel does not have recent posts to show.</p>
          </article>
        ) : (
          <ul className="deck-list">
            {postState.posts.slice(0, 8).map((post) => (
              <li key={post.id} className="deck-card deck-card--post">
                <div className="deck-card-header">
                  <strong>{formatPostTime(post.create_at)}</strong>
                  <span>{post.user_id.slice(0, 8)}</span>
                </div>
                <p>{summarisePost(post.message)}</p>
              </li>
            ))}
          </ul>
        )}

        {selectedTeam && (
          <article className="deck-card deck-card--muted">
            <strong>Pinned target</strong>
            <p>
              {selectedTeam.display_name || selectedTeam.name}
              {selectedChannel ? ` / ${selectedChannel.display_name || selectedChannel.name}` : ""}
            </p>
          </article>
        )}
      </div>
    </section>
  );
}

export function App({ routeKey }: AppProps): React.JSX.Element {
  const state = useDeckState(routeKey);
  const [columns, addColumn, removeColumn, updateColumn] = useDeckLayout();
  const [railWidth, setRailWidth] = useRailWidth();
  const [isResizing, setIsResizing] = useState(false);
  const resizeStateRef = useRef<{ pointerId: number } | null>(null);
  const nextColumnType = useMemo(() => {
    const loadedColumns = columns ?? [];
    return AVAILABLE_COLUMN_TYPES.find((type) => !loadedColumns.some((column) => column.type === type)) ?? "channelWatch";
  }, [columns]);

  const statusText = useMemo(() => {
    if (state.status === "error") {
      return state.error ?? "Failed to load data.";
    }
    if (state.status === "loading" || columns === null) {
      return "Loading Mattermost data...";
    }

    const scope = [state.currentTeamLabel, state.currentChannelLabel].filter(Boolean).join(" / ");
    const layoutText = columns.length === 1 ? "1 saved column" : `${columns.length} saved columns`;
    return scope
      ? `Current page is ${scope}. Existing columns stay pinned to their own selections. ${layoutText}.`
      : `Existing columns stay pinned to their own selections. ${layoutText}.`;
  }, [columns, state.currentChannelLabel, state.currentTeamLabel, state.error, state.status]);

  const defaultColumnTarget = useMemo(
    () => ({
      teamId: state.currentTeamId,
      channelId: state.currentChannelId,
    }),
    [state.currentChannelId, state.currentTeamId],
  );

  useEffect(() => {
    document.body.classList.toggle("mattermost-deck-resizing", isResizing);
    return () => {
      document.body.classList.remove("mattermost-deck-resizing");
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      setRailWidth(window.innerWidth - event.clientX);
    };

    const finishResize = (event: PointerEvent) => {
      if (!resizeStateRef.current || event.pointerId !== resizeStateRef.current.pointerId) {
        return;
      }

      resizeStateRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [isResizing, setRailWidth]);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = { pointerId: event.pointerId };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  return (
    <aside className="deck-shell" aria-label="Mattermost Deck">
      <button
        type="button"
        className={`deck-resizer${isResizing ? " deck-resizer--active" : ""}`}
        onPointerDown={handleResizeStart}
        aria-label="Resize deck area"
        title="Drag to resize deck area"
      >
        <span />
      </button>

      <header className="deck-topbar">
        <div className="deck-topbar-copy">
          <p className="deck-eyebrow">Mattermost Deck</p>
          <h1>Multi Pane</h1>
          <p className="deck-meta">
            {state.username ? `Signed in as @${state.username}` : "Using current Mattermost session"}
          </p>
        </div>
        <div className="deck-topbar-actions">
          <div className="deck-status-inline">
            <span className="deck-dot" />
            <span>{statusText}</span>
          </div>
          <button
            type="button"
            className="deck-button"
            onClick={() => addColumn(nextColumnType, defaultColumnTarget)}
            disabled={columns === null || state.status === "loading"}
          >
            Add {getColumnTitle(nextColumnType)}
          </button>
        </div>
      </header>

      <div className="deck-scroll-wrap">
        <main className="deck-columns" style={{ minWidth: Math.max((columns?.length ?? 1) * 340 + 32, railWidth - 24) }}>
          {(columns ?? []).map((column) => {
            switch (column.type) {
              case "mentions":
                return (
                  <MentionsColumn
                    key={column.id}
                    column={column}
                    teams={state.teams}
                    unreads={state.unreads}
                    onUpdate={updateColumn}
                    onRemove={removeColumn}
                  />
                );
              case "channelWatch":
                return (
                  <ChannelWatchColumn
                    key={column.id}
                    column={column}
                    teams={state.teams}
                    onUpdate={updateColumn}
                    onRemove={removeColumn}
                  />
                );
            }
          })}
        </main>
      </div>
    </aside>
  );
}
