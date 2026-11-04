"use client";

import { useEffect, useState, type FormEvent } from "react";

type Category = {
  id: number;
  name: string;
};

type CreatedEquipment = {
  id: string;
  name: string;
  asset_code: string;
};

const inputStyle =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function EquipmentCreationClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdEquipment, setCreatedEquipment] =
    useState<CreatedEquipment | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch("/api/categories");

        if (!response.ok) {
          throw new Error("Could not load equipment categories.");
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("Unexpected categories response.");
        }

        if (!cancelled) {
          setCategories(data as Category[]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load categories."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingCategories(false);
        }
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    const payload = {
      asset_code: String(formData.get("asset_code") ?? "").trim(),
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
      serial_number: String(formData.get("serial_number") ?? "").trim(),
      category_id: Number(formData.get("category_id")),
      condition: String(formData.get("condition") ?? "unknown"),
      is_restricted: formData.get("is_restricted") === "on",
    };

    setSaving(true);
    setError("");
    setCreatedEquipment(null);

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Could not create equipment.");
      }

      setCreatedEquipment({
        id: result.id,
        name: result.name,
        asset_code: result.asset_code,
      });

      form.reset();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
          Equipment Management
        </p>

        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          Add Equipment
        </h1>

        <p className="mt-2 text-slate-600">
          Register new equipment in your laboratory.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="asset_code" className="block text-sm font-medium">
                Asset Code *
              </label>

              <input
                id="asset_code"
                name="asset_code"
                required
                maxLength={50}
                placeholder="e.g. AUB-DRONE-001"
                className={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium">
                Equipment Name *
              </label>

              <input
                id="name"
                name="name"
                required
                maxLength={150}
                placeholder="e.g. DJI Mini Drone"
                className={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="category_id" className="block text-sm font-medium">
                Category *
              </label>

              <select
                id="category_id"
                name="category_id"
                required
                defaultValue=""
                disabled={loadingCategories}
                className={inputStyle}
              >
                <option value="" disabled>
                  {loadingCategories
                    ? "Loading categories..."
                    : "Select a category"}
                </option>

                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              {!loadingCategories && categories.length === 0 && (
                <p className="mt-2 text-sm text-amber-700">
                  No categories available. Create a category first.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="condition" className="block text-sm font-medium">
                Equipment Condition *
              </label>

              <select
                id="condition"
                name="condition"
                defaultValue="unknown"
                className={inputStyle}
              >
                <option value="good">Good</option>
                <option value="damaged">Damaged</option>
                <option value="missing">Missing</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div>
              <label htmlFor="serial_number" className="block text-sm font-medium">
                Serial Number
              </label>

              <input
                id="serial_number"
                name="serial_number"
                maxLength={100}
                placeholder="Optional"
                className={inputStyle}
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <input
                id="is_restricted"
                name="is_restricted"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
              />

              <label htmlFor="is_restricted" className="text-sm font-medium">
                Restricted Equipment
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium">
              Description
            </label>

            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Optional equipment description"
              className={inputStyle}
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || loadingCategories || categories.length === 0}
            className="rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creating Equipment..." : "Create Equipment"}
          </button>
        </form>
      </div>

      {createdEquipment && (
        <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-semibold text-green-900">
            Equipment Created Successfully!
          </h2>

          <p className="mt-2 text-green-800">
            {createdEquipment.name} ({createdEquipment.asset_code})
          </p>

          <p className="mt-2 break-all text-sm text-green-700">
            Equipment UUID: {createdEquipment.id}
          </p>
        </section>
      )}
    </main>
  );
}