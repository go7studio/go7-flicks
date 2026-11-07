import { useState } from "react";
import { CanvasScreen } from "./ui/CanvasScreen";
import { ChannelScreen } from "./ui/ChannelScreen";
import { ConnectionsScreen } from "./ui/ConnectionsScreen";
import { HomeScreen } from "./ui/HomeScreen";
import { RankingStudio } from "./ui/RankingStudio";
import { SplitStudio } from "./ui/SplitStudio";

export type Route =
  | { name: "home" }
  | { name: "connections"; back: Route }
  | { name: "channel"; dir: string }
  | { name: "canvas"; dir: string; flickId: string }
  | { name: "ranking" }
  | { name: "split" };

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
    return <ConnectionsScreen onBack={() => setRoute(route.back)} />;
  }
  if (route.name === "channel") {
    return (
      <ChannelScreen
        dir={route.dir}
        onHome={() => setRoute({ name: "home" })}
        onConnections={() => setRoute({ name: "connections", back: route })}
        onOpen={(flickId) => setRoute({ name: "canvas", dir: route.dir, flickId })}
      />
    );
  }
  if (route.name === "ranking") {
    return <RankingStudio onBack={() => setRoute({ name: "home" })} onOpen={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })} />;
  }
  if (route.name === "split") {
    return <SplitStudio onBack={() => setRoute({ name: "home" })} onOpen={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })} />;
  }
  if (route.name === "canvas") {
    return (
      <CanvasScreen
        dir={route.dir}
        flickId={route.flickId}
        onBack={() => setRoute({ name: "channel", dir: route.dir })}
        onConnections={() => setRoute({ name: "connections", back: route })}
      />
    );
  }
  return (
    <HomeScreen
      onOpen={(dir) => setRoute({ name: "channel", dir })}
      onOpenFlick={(dir, flickId) => setRoute({ name: "canvas", dir, flickId })}
      onRanking={() => setRoute({ name: "ranking" })}
      onSplit={() => setRoute({ name: "split" })}
      onConnections={() => setRoute({ name: "connections", back: route })}
    />
  );
}
