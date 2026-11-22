"use client";

import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { useRouter } from "next/navigation";
import { isCatalogueItem, type CatalogueItem } from "@unitrack/contracts";
import ReservationForm from "@/components/ReservationForm";
import { Icon } from "@/components/icon";
import { PageStatus } from "@/components/page-status";

const REFRESH_MS = 30_000; // refresh every 30 s, so changes show within 1 minute

export default function CatalogueClient() {
  const router = useRouter();
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load the items. Runs when the search or category changes, and every 30 s.
  const loadItems = useCallback(async (signal: AbortSignal) => {
    try {
      const params = new URLSearchParams({ search, category });
      const res = await fetch(`/api/items?${params}`, { signal });
      if (signal.aborted) return;
      if (res.status === 401) {
        router.replace("/login"); // session ended
        return;
      }
      if (!res.ok) throw new Error("bad response");
      const data: unknown = await res.json();
      if (!Array.isArray(data) || !data.every(isCatalogueItem)) throw new Error("invalid catalogue response");
      if (signal.aborted) return;
      setItems(data);
      setPartial(res.headers.has("X-UniTrack-Partial-Data"));
      setError("");
    } catch {
      if (signal.aborted) return;
      setError("Could not load the catalogue. Please try again.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [search, category, router]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void loadItems(controller.signal);
    const t = setTimeout(refresh, 300); // small delay while typing
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      controller.abort();
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [loadItems]);

  // If categories are unavailable, use the categories found in the lab’s items.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error();
        const data: { name: string }[] = await res.json();
        setCategories(data.map((c) => c.name));
      } catch {
        const res = await fetch("/api/items").catch(() => null);
        if (res?.ok) {
          const all: unknown = await res.json().catch(() => null);
          if (Array.isArray(all) && all.every(isCatalogueItem)) {
            setCategories([...new Set(all.map((i) => i.category))].sort());
          }
        }
      }
    })();
  }, []);

  return (
    <>
      <div className="catalogue-filters">
        <label className="catalogue-search">
          <span className="sr-only">Search equipment by name or asset code</span>
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search by name or asset code"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>

      {partial && !error && <PageStatus>Some return dates are unavailable.</PageStatus>}
      {error && <p role="alert" className="notice-panel">{error}</p>}
      {loading && !error && <PageStatus>Loading equipment…</PageStatus>}
      {!loading && !error && items.length === 0 && <PageStatus>No equipment matches these filters.</PageStatus>}

      <ul className="catalogue-grid" aria-label="Equipment">
        {items.map((item) => (
          <li key={item.id} className="panel catalogue-card">
            <div className="catalogue-card-heading">
              <div className="catalogue-tile">
                <Icon name={item.isKit ? "kit" : "equipment"} />
              </div>
              <div>
                <h2>{item.name}</h2>
                <p className="catalogue-meta">{item.assetCode}</p>
                <p className="catalogue-meta">{item.category}{item.isKit && !/\bkits?\b/i.test(item.category) && " · Kit"}</p>
              </div>
              <div className="catalogue-status">
                <StatusBadge status={item.status} />
                {item.expectedReturn && (
                  <p>
                    Expected return{" "}
                    <time dateTime={item.expectedReturn}>
                      {new Date(item.expectedReturn).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </time>
                  </p>
                )}
              </div>
            </div>
            {item.canReserve && item.status === "Available" && !item.isRestricted && (
              <ReservationForm itemId={item.id} itemName={item.name} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
