"use client";

import { useEffect, useState } from "react";
import { validateCreateCategoryInput } from "@/lib/category-validation";

type Category = {
  id: number;
  name: string;
};

export default function CategoryManagementPage() {
  // Existing categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New category form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

const validationErrors = nameTouched
  ? validateCreateCategoryInput({ name, description })
  : [];

  // Load existing categories from the database
  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch("/api/categories");

        if (!response.ok) {
          throw new Error("Failed to fetch categories");
        }

        const data: Category[] = await response.json();

        if (!cancelled) {
          setCategories(data);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load categories.");
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

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
      }}
    >
      {/* Page heading */}
      <h1>Manage Equipment Categories</h1>

      <p>
        Here, Lab Managers can view existing equipment categories
        and create new ones.
      </p>

      {/* Existing categories */}
      <section style={{ marginTop: 30 }}>
        <h2>Existing Categories</h2>

        {loading && <p>Loading categories...</p>}

        {error && <p role="alert">{error}</p>}

        {!loading && !error && (
          <ul>
            {categories.map((category) => (
              <li key={category.id}>
                {category.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create category form */}
      <section style={{ marginTop: 30 }}>
        <h2>Create New Category</h2>

        {/* Category name */}
        <label htmlFor="category-name">
          Category Name
        </label>

        <input
          id="category-name"
          type="text"
          placeholder="e.g. Drones"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={100}
          onBlur={() => setNameTouched(true)}
          style={{
            display: "block",
            width: "100%",
            padding: 10,
            marginTop: 8,
            border: "1px solid #525252",
            borderRadius: 6,
            backgroundColor: "#171717",
            color: "white",
          }}
        />

        {/* Character counter */}
        <p
          style={{
            fontSize: 12,
            color: "#9ca3af",
            marginTop: 5,
          }}
        >
          {name.length}/100 characters
        </p>
        {validationErrors.map((message) => (
  <p
    key={message}
    role="alert"
    style={{
      color: "#f87171",
      fontSize: 14,
      marginTop: 5,
    }}
  >
    {message}
  </p>
))}

        {/* Description */}
        <label
          htmlFor="category-description"
          style={{
            display: "block",
            marginTop: 20,
          }}
        >
          Description (Optional)
        </label>

        <textarea
          id="category-description"
          placeholder="e.g. Drones and their accessories"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          style={{
            display: "block",
            width: "100%",
            padding: 10,
            marginTop: 8,
            border: "1px solid #525252",
            borderRadius: 6,
            backgroundColor: "#171717",
            color: "white",
          }}
        />

        {/* Create category button */}
        <button
          type="button"
          disabled
          style={{
            display: "block",
            marginTop: 20,
            padding: "10px 20px",
            borderRadius: 6,
            backgroundColor: "#2563eb",
            color: "white",
            opacity: 0.6,
            cursor: "not-allowed",
          }}
        >
          Create Category
        </button>
      </section>
    </main>
  );
}