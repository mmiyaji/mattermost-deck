import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FavoriteButton, FavoritesProvider, useFavorites } from "../../src/ui/FavoritesContext";
import i18n from "../../src/ui/i18n";

const post = { id: "post1", user_id: "author", channel_id: "channel", create_at: 1, message: "Cached favorite" };
function Content() {
  const favorites = useFavorites()!;
  return <>
    <FavoriteButton post={post} />
    <button onClick={() => void favorites.refresh(true)}>Refresh</button>
    <button onClick={() => void favorites.refresh()}>Check cache</button>
    <button onClick={() => void favorites.remove(post.id)}>Remove</button>
    <div data-testid="entries">{favorites.entries.map(f => <p key={f.id}>{f.post?.message ?? "Unavailable"}</p>)}</div>
    <output>{favorites.ready ? "Ready" : "Loading"}</output>
  </>;
}
function Fixture() {
  const [user, setUser] = useState("userA");
  return <><button onClick={() => setUser(u => u === "userA" ? "userB" : "userA")}>Switch account</button>
    <FavoritesProvider key={user} server="https://example.test/team/" userId={user}><Content /></FavoritesProvider></>;
}
await i18n.changeLanguage("en");
createRoot(document.getElementById("root")!).render(<Fixture />);
