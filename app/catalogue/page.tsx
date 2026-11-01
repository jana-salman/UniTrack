"use client";

import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";

type Item = {
  id: string;
  name: string;
  category: string;
  status: string;
  expectedReturn: string | null;
};

const REFRESH_MS = 30_000; // refresh every 30 s, so changes show within 1 minute

export default function CataloguePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Load the items. Runs when the search or category changes, and every 30 s.
  const loadItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ search, category });
      const res = await fetch(`/api/items?${params}`);
      if (!res.ok) throw new Error("bad response");
      setItems(await res.json());
      setError("");
    } catch {
      setError("Could not load the catalogue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    const t = setTimeout(loadItems, 300); // small delay while typing
    const timer = setInterval(loadItems, REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [loadItems]);

  // Category list. SN builds GET /api/categories. Until it exists, we use
  // the categories found in the items.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error();
        const data: { name: string }[] = await res.json();
        setCategories(data.map((c) => c.name));
      } catch {
        const res = await fetch("/api/items");
        if (res.ok) {
          const all: Item[] = await res.json();
          setCategories([...new Set(all.map((i) => i.category))].sort());
        }
      }
    })();
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Equipment catalogue</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search by name"
          aria-label="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 180px", padding: 10, fontSize: 16 }}
        />
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ flex: "1 1 140px", padding: 10, fontSize: 16 }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert" style={{ color: "#991b1b" }}>{error}</p>}
      {loading && !error && <p>Loading…</p>}
      {!loading && !error && items.length === 0 && <p>No equipment found.</p>}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {items.map((item) => (
          <li
            key={item.id}
            style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>{item.name}</strong>
              <StatusBadge status={item.status} />
            </div>
            <div style={{ color: "#4b5563", fontSize: 14, marginTop: 4 }}>
              {item.id} · {item.category}
            </div>
            {item.expectedReturn && (
              <div style={{ fontSize: 14, marginTop: 4 }}>
                Expected return:{" "}
                {new Date(item.expectedReturn).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}