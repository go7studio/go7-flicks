import { useEffect, useState, type ComponentProps } from "react";
import { CanvasScreen } from "./ui/CanvasScreen";
import { ChannelScreen } from "./ui/ChannelScreen";
import { ConnectionsScreen } from "./ui/ConnectionsScreen";
import { HomeScreen } from "./ui/HomeScreen";
import { RankingStudio } from "./ui/RankingStudio";
import { SplitStudio } from "./ui/SplitStudio";

export type Route =
  | { name: "home"; nav?: "home" | "library" }
  | { name: "connections"; back: Route }
  | { name: "channel"; dir: string }
  | { name: "canvas"; dir: string; flickId: string }
  | { name: "ranking"; dir?: string; flickId?: string }
  | { name: "split"; dir?: string; flickId?: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  if (!window.flicks) {
    return (
      <main className="page">
        <h1>Go7Flicks</h1>
        <p className="muted">Open the desktop app. This window is only the editor shell.</p>
      </main>
    );
  }
  if (route.name === "connections") {
    return (
      <ConnectionsScreen
        onHome={() => setRoute({ name: "home", nav: "home" })}
        onLibrary={() => setRoute({ name: "home", nav: "library" })}
        onBack={route.back.name === "home" ? undefined : () => setRoute(route.back)}
      />
    );
  }
  if (route.name === "channel") {
    return (
      <ChannelScreen
        dir={route.dir}
        onHome={() => setRoute({ name: "home", nav: "home" })}
        onConnections={() => setRoute({ name: "connections", back: route })}
        onOpen={(flickId) => setRoute({ name: "canvas", dir: route.dir, flickId })}
      />
    );
  }
  if (route.name === "ranking") {
    return (
      <RankingStudio
        onBack={() => setRoute({ name: "home" })}
        onOpen={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })}
        channelDir={route.dir}
        flickId={route.flickId}
      />
    );
  }
  if (route.name === "split") {
    return (
      <SplitStudio
        onBack={() => setRoute({ name: "home" })}
        onOpen={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })}
        channelDir={route.dir}
        flickId={route.flickId}
      />
    );
  }
  if (route.name === "canvas") {
    return <CanvasRoute route={route} setRoute={setRoute} />;
  }
  return (
    <HomeScreen
      openOn={route.nav ?? "home"}
      onOpen={(dir) => setRoute({ name: "channel", dir })}
      onOpenFlick={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })}
      onRanking={() => setRoute({ name: "ranking" })}
      onSplit={() => setRoute({ name: "split" })}
      onConnections={() => setRoute({ name: "connections", back: route })}
    />
  );
}

function CanvasRoute({ route, setRoute }: { route: Extract<Route, { name: "canvas" }>; setRoute: (next: Route) => void }) {
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoaded(false);
    void window.flicks!.readFlick(route.dir, route.flickId).then((result) => {
      if (cancel || !result.ok) return;
      setTemplateId(result.flick?.templateId);
      setLoaded(true);
    });
    return () => {
      cancel = true;
    };
  }, [route.dir, route.flickId]);

  function openDesk(id: string | undefined) {
    if (id === "builtin-ranking") setRoute({ name: "ranking", dir: route.dir, flickId: route.flickId });
    else if (id === "builtin-dual" || id === "builtin-split") setRoute({ name: "split", dir: route.dir, flickId: route.flickId });
  }

  function onOpenDesk() {
    if (loaded) {
      openDesk(templateId);
      return;
    }
    void window.flicks!.readFlick(route.dir, route.flickId).then((result) => openDesk(result.flick?.templateId));
  }

  return (
    <CanvasScreen
      {...({
        dir: route.dir,
        flickId: route.flickId,
        onBack: () => setRoute({ name: "channel", dir: route.dir }),
        onHome: () => setRoute({ name: "home", nav: "home" }),
        onLibrary: () => setRoute({ name: "home", nav: "library" }),
        onConnections: () => setRoute({ name: "connections", back: route }),
        onOpenDesk,
      } as ComponentProps<typeof CanvasScreen>)}
    />
  );
}
