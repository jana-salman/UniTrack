"use client";

import { useEffect, useState } from "react";

type EquipmentItem = {
  id: string;
  asset_code: string;
  name: string;
  description: string | null;
  serial_number: string | null;
  category_id: number;
  condition: string;
  status: string;
  is_restricted: boolean;
};

type Category = {
  id: number;
  name: string;
};

type EditDraft = {
  name: string;
  description: string;
  serial_number: string;
  category_id: number;
  condition: string;
  is_restricted: boolean;
};

export default function EquipmentListClient() {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState("");
  const [retireSuccess, setRetireSuccess] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEquipment() {
      try {
        const response = await fetch("/api/manager/equipment", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to load equipment.");
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("Invalid equipment response.");
        }

        if (active) {
          setEquipment(data as EquipmentItem[]);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Something went wrong."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadEquipment();

    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
  let active = true;

  async function loadCategories() {
    try {
      const response = await fetch("/api/categories");

      if (!response.ok) {
        throw new Error("Could not load categories.");
      }

      const data: unknown = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Invalid categories response.");
      }

      if (active) {
        setCategories(data as Category[]);
      }
    } catch (err) {
      if (active) {
        setCategoriesError(
          err instanceof Error
            ? err.message
            : "Could not load categories."
        );
      }
    }
  }

  void loadCategories();

  return () => {
    active = false;
  };
}, []);
async function saveEquipmentChanges() {
  if (!selectedEquipmentId || !editDraft || saving) {
    return;
  }

  setSaveError("");
  setSaveSuccess("");

  if (!editDraft.name.trim()) {
    setSaveError("Equipment name is required.");
    return;
  }

  setSaving(true);

  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(selectedEquipmentId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editDraft.name.trim(),
          description: editDraft.description.trim() || null,
          serial_number: editDraft.serial_number.trim() || null,
          category_id: editDraft.category_id,
          condition: editDraft.condition,
          is_restricted: editDraft.is_restricted,
        }),
      }
    );

    const result: unknown = await response.json();

    if (!response.ok) {
      const message =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "Failed to update equipment.";

      throw new Error(message);
    }

    setEquipment((previous) =>
      previous.map((item) =>
        item.id === selectedEquipmentId
          ? {
              ...item,
              ...editDraft,
              name: editDraft.name.trim(),
            }
          : item
      )
    );

    setSaveSuccess("Equipment updated successfully!");
  } catch (err) {
    setSaveError(
      err instanceof Error ? err.message : "Something went wrong."
    );
  } finally {
    setSaving(false);
  }
}
async function retireEquipment(item: EquipmentItem) {
  if (item.status === "retired" || retiringId !== null) {
    return;
  }

  const reason = window.prompt(
    `Retire ${item.name} (${item.asset_code})?\n\nEnter a retirement reason, or click Cancel to keep it active:`
  );

  if (reason === null) {
    return;
  }

  if (!reason.trim()) {
    setRetireError("Please enter a retirement reason.");
    setRetireSuccess("");
    return;
  }

  setRetiringId(item.id);
  setRetireError("");
  setRetireSuccess("");

  try {
    const response = await fetch(
      `/api/items/${encodeURIComponent(item.id)}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "retired",
          reason: reason.trim(),
        }),
      }
    );

    const result: unknown = await response.json();

    if (!response.ok) {
      const message =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "Failed to retire equipment.";

      throw new Error(message);
    }

    setEquipment((previous) =>
      previous.map((equipmentItem) =>
        equipmentItem.id === item.id
          ? { ...equipmentItem, status: "retired" }
          : equipmentItem
      )
    );

    setRetireSuccess(`${item.asset_code} retired successfully.`);
  } catch (err) {
    setRetireError(
      err instanceof Error ? err.message : "Something went wrong."
    );
  } finally {
    setRetiringId(null);
  }
}
  return (
    <section className="mx-auto mt-8 max-w-7xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-2xl font-bold text-slate-900">
        Existing Equipment
      </h2>

      <p className="mt-2 text-slate-600">
        Equipment registered in your laboratory.
      </p>

      {loading && (
        <p className="mt-6 text-slate-600">Loading equipment...</p>
      )}

      {error && (
        <p className="mt-6 text-red-600">{error}</p>
      )}
      {retireError && (
  <p role="alert" className="mt-4 text-red-600">
    {retireError}
  </p>
)}

{retireSuccess && (
  <p role="status" className="mt-4 text-green-700">
    {retireSuccess}
  </p>
)}

      {!loading && !error && equipment.length === 0 && (
        <p className="mt-6 text-slate-600">
          No equipment found.
        </p>
      )}
{selectedEquipmentId && editDraft && (
  <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6">
    <h3 className="mb-2 text-xl font-bold text-slate-900">
      Edit Equipment
    </h3>

    <p className="mb-5 text-slate-600">
      Asset Code:{" "}
      {equipment.find((item) => item.id === selectedEquipmentId)?.asset_code}
    </p>

    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <label className="block">
        <span className="mb-2 block font-medium">Equipment Name *</span>
        <input
          type="text"
          value={editDraft.name}
          onChange={(e) =>
            setEditDraft({ ...editDraft, name: e.target.value })
          }
          className="w-full rounded-lg border border-slate-300 bg-white p-3"
        />
      </label>

      <label className="block">
        <span className="mb-2 block font-medium">Serial Number</span>
        <input
          type="text"
          value={editDraft.serial_number}
          onChange={(e) =>
            setEditDraft({ ...editDraft, serial_number: e.target.value })
          }
          className="w-full rounded-lg border border-slate-300 bg-white p-3"
        />
      </label>
      <label className="block">
  <span className="mb-2 block font-medium">
    Category *
  </span>

  <select
    value={editDraft.category_id}
    onChange={(e) =>
      setEditDraft({
        ...editDraft,
        category_id: Number(e.target.value),
      })
    }
    disabled={categories.length === 0}
    className="w-full rounded-lg border border-slate-300 bg-white p-3"
  >
    {!categories.some(
      (category) => category.id === editDraft.category_id
    ) && (
      <option value={editDraft.category_id}>
        Current Category (ID {editDraft.category_id})
      </option>
    )}

    {categories.map((category) => (
      <option key={category.id} value={category.id}>
        {category.name}
      </option>
    ))}
  </select>
</label>

{categoriesError && (
  <p role="alert" className="text-sm text-red-600">
    {categoriesError}
  </p>
)}
      <label className="block">
        <span className="mb-2 block font-medium">Equipment Condition *</span>
        <select
          value={editDraft.condition}
          onChange={(e) =>
            setEditDraft({ ...editDraft, condition: e.target.value })
          }
          className="w-full rounded-lg border border-slate-300 bg-white p-3"
        >
          <option value="unknown">Unknown</option>
          <option value="good">Good</option>
          <option value="damaged">Damaged</option>
          <option value="missing">Missing</option>
        </select>
      </label>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={editDraft.is_restricted}
          onChange={(e) =>
            setEditDraft({
              ...editDraft,
              is_restricted: e.target.checked,
            })
          }
          className="h-5 w-5"
        />
        <span className="font-medium">Restricted Equipment</span>
      </label>
    </div>

    <label className="mt-5 block">
      <span className="mb-2 block font-medium">Description</span>
      <textarea
        value={editDraft.description}
        onChange={(e) =>
          setEditDraft({ ...editDraft, description: e.target.value })
        }
        rows={3}
        className="w-full rounded-lg border border-slate-300 bg-white p-3"
      />
    </label>
{saveError && (
  <p role="alert" className="mt-4 text-red-600">
    {saveError}
  </p>
)}

{saveSuccess && (
  <p role="status" className="mt-4 text-green-700">
    {saveSuccess}
  </p>
)}

<button
  type="button"
  onClick={() => void saveEquipmentChanges()}
  disabled={saving}
  className="mt-5 mr-3 rounded-lg bg-blue-600 px-5 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
>
  {saving ? "Saving..." : "Save Changes"}
</button>
    <button
      type="button"
      onClick={() => {
        setSelectedEquipmentId(null);
        setEditDraft(null);
      }}
      className="mt-5 rounded-lg border border-slate-300 bg-white px-5 py-3 text-slate-700 hover:bg-slate-100"
    >
      Cancel
    </button>
  </div>
)}
      {!loading && !error && equipment.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-3">Asset Code</th>
                <th className="p-3">Equipment Name</th>
                <th className="p-3">Condition</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {equipment.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-slate-100"
                >
                  <td className="p-3">{item.asset_code}</td>
                  <td className="p-3">{item.name}</td>
                  <td className="p-3 capitalize">{item.condition}</td>
                  <td className="p-3 capitalize">
                    {item.status.replaceAll("_", " ")}
                  </td>
                  <td className="p-3">
  <button
    type="button"
    onClick={() => {
  setSelectedEquipmentId(item.id);

  setEditDraft({
    name: item.name,
    description: item.description ?? "",
    serial_number: item.serial_number ?? "",
    category_id: item.category_id,
    condition: item.condition,
    is_restricted: item.is_restricted,
  });
}}
    className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
  >
    {selectedEquipmentId === item.id ? "Selected" : "Edit"}
  </button>
  {item.status !== "retired" && (
  <button
    type="button"
    disabled={retiringId !== null}
    onClick={() => void retireEquipment(item)}
    className="ml-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {retiringId === item.id ? "Retiring..." : "Retire"}
  </button>
)}
</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}