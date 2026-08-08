import { useEffect, useState } from 'react';
import type { SnapshotFrom } from 'xstate';
import { useWorldStore } from '../store/worldStore';
import { initialContext } from './worldMachine';
import type { WorldContext, WorldEvent, worldMachine } from './worldMachine';

type WorldSnapshot = SnapshotFrom<typeof worldMachine>;

export function useWorldEngine() {
  const actor = useWorldStore((s) => s.actor);
  const initActor = useWorldStore((s) => s.initActor);

  useEffect(() => {
    initActor();
  }, [initActor]);

  return actor;
}

export function useWorldState(): {
  phase: WorldContext['phase'];
  /** 状态机当前状态（genesis/idle/observing/.../summoning/dialogue/dialogueTurn） */
  state: string;
  context: WorldContext;
  send: (event: WorldEvent) => void;
  ready: boolean;
} {
  const actor = useWorldEngine();
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(() =>
    actor ? actor.getSnapshot() : null
  );

  useEffect(() => {
    if (!actor) return;
    setSnapshot(actor.getSnapshot());
    const sub = actor.subscribe((s) => setSnapshot(s));
    return () => sub.unsubscribe();
  }, [actor]);

  return {
    phase: snapshot?.context.phase ?? initialContext.phase,
    state: String(snapshot?.value ?? 'genesis'),
    context: snapshot?.context ?? initialContext,
    send: (event) => actor?.send(event),
    ready: actor !== null,
  };
}
