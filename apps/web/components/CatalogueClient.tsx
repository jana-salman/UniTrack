"use client";

import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { useRouter } from "next/navigation";
import { isCatalogueItem, type CatalogueItem } from "@unitrack/contracts";

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
  const loadItems = useCallback(async () => {
    try {
      const params = new URLSearchParams({ search, category });
      const res = await fetch(`/api/items?${params}`);
      if (res.status === 401) {
           router.replace("/login"); // session ended
        return;
      }
      if (!res.ok) throw new Error("bad response");
      const data: unknown = await res.json();
      if (!Array.isArray(data) || !data.every(isCatalogueItem)) throw new Error("invalid catalogue response");
      setItems(data);
      setPartial(res.headers.has("X-UniTrack-Partial-Data"));
      setError("");
    } catch {
      setError("Could not load the catalogue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [search, category, router]);

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
          const all: unknown = await res.json();
          if (Array.isArray(all) && all.every(isCatalogueItem)) {
            setCategories([...new Set(all.map((i) => i.category))].sort());
          }
        }
      }
    })();
  }, []);

    const field =
    "min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600";

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-gray-900">
        Equipment catalogue
      </h1>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search by name"
          aria-label="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${field} flex-1 basis-44`}
        />
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${field} flex-1 basis-36`}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {partial && <p role="status" className="text-gray-700">Some return dates are unavailable. Equipment details are still shown.</p>}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {loading && !error && <p className="text-gray-700">Loading…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-gray-700">No equipment found.</p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <strong className="text-gray-900">{item.name}</strong>
              <StatusBadge status={item.status} />
            </div>
            <div className="mt-1 text-sm text-gray-600">
              {item.assetCode} · {item.category}
            </div>
            {item.expectedReturn && (
              <div className="mt-1 text-sm text-gray-900">
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
    </div>
  );
}
