"use client";

import { PageHeading } from "@/components/page-heading";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import EquipmentQrLabel from "@/components/equipment/equipment-qr-label";

type Category = { id: number; name: string };
type Equipment = { id: string; asset_code: string; name: string; status: string; is_restricted: boolean };
type Component = { id: string; component_name: string; tracked_item_id: string | null; tracked_asset_code: string | null; tracked_status: string | null; tracked_is_restricted: boolean | null; is_active: boolean };
type Kit = Equipment & { description: string | null; serial_number: string | null; category_id: number; condition: string; components: Component[] };
const input = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900";

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data && typeof data.error === "string" ? data.error : "The kit request could not be completed.");
  return data;
}

export default function KitManagementClient() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [componentChoice, setComponentChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    const [kitRows, equipmentRows, categoryRows] = await Promise.all([
      jsonRequest("/api/kits"), jsonRequest("/api/manager/equipment"), jsonRequest("/api/categories"),
    ]);
    if (!Array.isArray(kitRows) || !Array.isArray(equipmentRows) || !Array.isArray(categoryRows)) throw new Error("The kit catalogue response was invalid.");
    return [kitRows as Kit[], equipmentRows as Equipment[], categoryRows as Category[]] as const;
  }, []);

  const reload = useCallback(async () => {
    const [kitRows, equipmentRows, categoryRows] = await loadData();
    setKits(kitRows as Kit[]); setEquipment(equipmentRows as Equipment[]); setCategories(categoryRows as Category[]);
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [kitRows, equipmentRows, categoryRows] = await loadData();
        if (!cancelled) { setKits(kitRows); setEquipment(equipmentRows); setCategories(categoryRows); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load kits.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [loadData]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await jsonRequest("/api/kits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        asset_code: String(data.get("asset_code") ?? "").trim(), name: String(data.get("name") ?? "").trim(),
        description: String(data.get("description") ?? "").trim(), category_id: Number(data.get("category_id")),
        condition: "good", is_restricted: false, componentIds: selectedComponents,
      }) });
      setSelectedComponents([]); form.reset(); await reload(); setSuccess("Kit created. Its main item and QR code are ready.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the kit."); }
    finally { setBusy(false); }
  }

  async function saveKit(kit: Kit, form: HTMLFormElement) {
    const data = new FormData(form); setBusy(true); setError(""); setSuccess("");
    try {
      await jsonRequest(`/api/kits/${kit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: String(data.get("name") ?? "").trim(), description: String(data.get("description") ?? "").trim(),
        serial_number: String(data.get("serial_number") ?? "").trim(),
        category_id: Number(data.get("category_id")), condition: String(data.get("condition") ?? "good"),
        is_restricted: data.get("is_restricted") === "on",
      }) });
      await reload(); setSuccess(`${kit.name} updated.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the kit."); }
    finally { setBusy(false); }
  }

  async function addComponent(kit: Kit) {
    const selected = componentChoice[kit.id]; if (!selected) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await jsonRequest(`/api/kits/${kit.id}/components`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tracked_item_id: selected }) });
      setComponentChoice(previous => ({ ...previous, [kit.id]: "" })); await reload(); setSuccess("Component added.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add the component."); }
    finally { setBusy(false); }
  }

  async function removeComponent(kit: Kit, component: Component) {
    if (!component.tracked_item_id) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await jsonRequest(`/api/kits/${kit.id}/components/${component.id}`, { method: "DELETE" });
      await reload(); setSuccess("Component removed from the kit.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove the component."); }
    finally { setBusy(false); }
  }

  const kitIds = new Set(kits.map(kit => kit.id));
  const componentOptions = equipment.filter(item => !kitIds.has(item.id) && item.status === "available" && !item.is_restricted);

  return (
    <div className="space-y-6">
      <PageHeading title="Kit management" section="Kits" description="Create kits and manage their tracked components." />
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      {success && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{success}</p>}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Create a kit</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={create}>
          <label className="text-sm font-medium">Main QR / asset code<input className={input} name="asset_code" required maxLength={50} /></label>
          <label className="text-sm font-medium">Kit name<input className={input} name="name" required maxLength={150} /></label>
          <label className="text-sm font-medium">Category<select className={input} name="category_id" required defaultValue=""><option value="" disabled>Select category</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label className="text-sm font-medium">Description<input className={input} name="description" maxLength={500} /></label>
          <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Tracked components</legend><div className="mt-2 flex flex-wrap gap-2">{componentOptions.map(item => <button type="button" key={item.id} onClick={() => setSelectedComponents(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} aria-pressed={selectedComponents.includes(item.id)} className={`rounded-lg border px-3 py-2 text-sm ${selectedComponents.includes(item.id) ? "border-aub-700 bg-aub-50 text-aub-800" : "border-slate-300 text-slate-700"}`}>{item.name} · {item.asset_code}</button>)}{!componentOptions.length && <span className="text-sm text-slate-500">No eligible component items are available.</span>}</div></fieldset>
          <button disabled={busy} className="min-h-11 rounded-lg bg-aub-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">{busy ? "Saving…" : "Create kit"}</button>
        </form>
      </section>
      <section className="space-y-4"><h2 className="text-lg font-semibold">Existing kits</h2>
        {!kits.length && <p className="text-slate-600">No kits have been created for this laboratory.</p>}
        {kits.map(kit => {
          const active = kit.components.filter(component => component.is_active);
          const assigned = new Set(active.map(component => component.tracked_item_id).filter((id): id is string => !!id));
          const options = componentOptions.filter(item => !assigned.has(item.id));
          return <article key={kit.id} className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_auto]">
            <div className="space-y-4">
              <form onSubmit={event => { event.preventDefault(); void saveKit(kit, event.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">Kit name<input className={input} name="name" defaultValue={kit.name} required maxLength={150} /></label>
                <label className="text-sm font-medium">Category<select className={input} name="category_id" defaultValue={kit.category_id}>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                <label className="text-sm font-medium sm:col-span-2">Description<input className={input} name="description" defaultValue={kit.description ?? ""} /></label>
                <label className="text-sm font-medium">Serial number<input className={input} name="serial_number" defaultValue={kit.serial_number ?? ""} maxLength={100} /></label>
                <input type="hidden" name="condition" value={kit.condition} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_restricted" defaultChecked={kit.is_restricted} /> Restricted item</label>
                <button disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold text-slate-800 disabled:opacity-50">Save kit details</button>
              </form>
              <div><h3 className="font-semibold">Components</h3>{active.length ? <ul className="mt-2 divide-y divide-slate-100">{active.map(component => <li key={component.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{component.component_name}{component.tracked_asset_code ? ` · ${component.tracked_asset_code}` : ""}</span><button type="button" disabled={busy} onClick={() => void removeComponent(kit, component)} className="rounded-md px-3 py-1 text-red-700 hover:bg-red-50">Remove</button></li>)}</ul> : <p className="mt-1 text-sm text-slate-600">No components added yet.</p>}</div>
              <div className="flex flex-col gap-2 sm:flex-row"><select aria-label={`Add component to ${kit.name}`} className={input} value={componentChoice[kit.id] ?? ""} onChange={event => setComponentChoice(previous => ({ ...previous, [kit.id]: event.target.value }))}><option value="">Choose an available component</option>{options.map(item => <option key={item.id} value={item.id}>{item.name} · {item.asset_code}</option>)}</select><button type="button" disabled={busy || !componentChoice[kit.id]} onClick={() => void addComponent(kit)} className="min-h-11 shrink-0 rounded-lg bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">Add component</button></div>
            </div>
            <div className="lg:w-[280px]"><p className="mb-2 text-sm text-slate-600">Main item · {kit.asset_code}</p><EquipmentQrLabel itemId={kit.id} name={kit.name} assetCode={kit.asset_code} /></div>
          </article>;
        })}
      </section>
    </div>
  );
}
