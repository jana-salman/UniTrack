"use client";

import { useEffect, useState, type FormEvent } from "react";
import { validateCreateCategoryInput } from "@/lib/category-validation";

type Category = {
  id: number;
  name: string;
};

type CategoryResponse = {
  id?: number;
  name?: string;
  error?: string;
  errors?: string[];
};

export default function CategoryManagementClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [showValidation, setShowValidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const validationErrors = showValidation
    ? validateCreateCategoryInput({ name, description })
    : [];

  // Load existing categories.
  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch("/api/categories");

        if (!response.ok) {
          throw new Error("Could not load categories.");
        }

        const data: Category[] = await response.json();

        if (!cancelled) {
          setCategories(data);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Could not load categories.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  // Create a category.
  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setShowValidation(true);
    setFormError("");
    setSuccessMessage("");

    const errors = validateCreateCategoryInput({ name, description });

    if (errors.length > 0) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      const result: CategoryResponse = await response.json();

      if (!response.ok) {
        setFormError(
          result.errors?.join(" ") ??
          result.error ??
          "Could not create category."
        );
        return;
      }

      if (
        typeof result.id !== "number" ||
        typeof result.name !== "string"
      ) {
        throw new Error("Unexpected server response.");
      }

      // Add the new category to the displayed list.
      const createdCategory: Category = {
        id: result.id,
        name: result.name,
      };

      setCategories((current) =>
        [...current, createdCategory].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );

      // Reset the form.
      setName("");
      setDescription("");
      setShowValidation(false);
      setSuccessMessage("Category created successfully.");

    } catch {
      setFormError("Could not connect to the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-950">
          Manage Equipment Categories
        </h1>

        <p className="mt-2 text-slate-600">
          View existing equipment categories and create new ones.
        </p>
      </header>

      {/* Existing categories */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold text-slate-900">
          Existing Categories
        </h2>

        {loading && (
          <p className="text-slate-500">Loading categories...</p>
        )}

        {loadError && (
          <p role="alert" className="text-red-600">
            {loadError}
          </p>
        )}

        {!loading && !loadError && (
          <ul className="divide-y divide-slate-200">
            {categories.map((category) => (
              <li
                key={category.id}
                className="py-3 text-slate-800"
              >
                {category.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create category */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-5 text-xl font-semibold text-slate-900">
          Create New Category
        </h2>

        <form noValidate onSubmit={handleCreateCategory}>
          <div>
            <label
              htmlFor="category-name"
              className="block font-medium text-slate-700"
            >
              Category Name
            </label>

            <input
              id="category-name"
              type="text"
              placeholder="e.g. Drones"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setShowValidation(true)}
              required
              maxLength={100}
              className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />

            <p className="mt-1 text-xs text-slate-500">
              {name.length}/100 characters
            </p>

            {validationErrors.map((message) => (
              <p
                key={message}
                role="alert"
                className="mt-2 text-sm text-red-600"
              >
                {message}
              </p>
            ))}
          </div>

          <div className="mt-6">
            <label
              htmlFor="category-description"
              className="block font-medium text-slate-700"
            >
              Description (Optional)
            </label>

            <textarea
              id="category-description"
              placeholder="e.g. Drones and their accessories"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-4 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {formError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {formError}
            </p>
          )}

          {successMessage && (
            <p role="status" className="mt-4 text-sm text-green-700">
              {successMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-6 min-h-11 rounded-lg bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Category"}
          </button>
        </form>
      </section>
    </main>
  );
}