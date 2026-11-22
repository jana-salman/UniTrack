"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { isReservation } from "@unitrack/contracts";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function ReservationForm({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const reserveButton = useRef<HTMLButtonElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const today = new Date();
  const maximumStart = new Date(today);
  maximumStart.setDate(maximumStart.getDate() + 14);
  const maximumEnd = new Date(today);
  maximumEnd.setDate(maximumEnd.getDate() + 20);

  useEffect(() => {
    if (open) startField.current?.focus();
    else if (restoreFocus.current) {
      reserveButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConfirmation("");
    if (!startDate || !endDate) { setError("Choose both reservation dates."); return; }
    const start = new Date(`${startDate}T00:00:00`);
    if (startDate === localDate(new Date())) {
      const nextMinute = new Date();
      nextMinute.setSeconds(0, 0);
      nextMinute.setMinutes(nextMinute.getMinutes() + 1);
      if (localDate(nextMinute) !== startDate) { setError("Choose tomorrow or a later start date."); return; }
      start.setTime(nextMinute.getTime());
    }
    const exclusiveEnd = new Date(`${endDate}T00:00:00`);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    setSaving(true);
    try {
      const response = await fetch("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, startAt: start.toISOString(), endAt: exclusiveEnd.toISOString() }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Could not create the reservation.";
        throw new Error(message);
      }
      if (!isReservation(body) || body.item_id !== itemId) throw new Error("The reservation service returned an unexpected response.");
      setConfirmation(`Reservation confirmed for ${itemName} from ${startDate} through ${endDate}.`);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the reservation.");
    } finally { setSaving(false); }
  }

  return (
    <div className="reserve-dates mt-3">
      {confirmation && <p role="status" className="mb-2 text-sm font-medium text-green-800">{confirmation}</p>}
      {!open ? <button ref={reserveButton} type="button" onClick={() => { restoreFocus.current = true; setOpen(true); setError(""); }} className="action-secondary text-sm">Reserve dates</button> : (
        <form onSubmit={submit} className="reservation-fields grid gap-3 rounded-lg bg-slate-50 p-3" aria-label={`Reserve ${itemName}`}>
          <label className="text-sm font-medium text-slate-800">Start date
            <input ref={startField} required type="date" min={localDate(today)} max={localDate(maximumStart)} value={startDate} onChange={event => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>
          <label className="text-sm font-medium text-slate-800">End date
            <input required type="date" min={startDate || localDate(today)} max={startDate ? (() => { const date = new Date(`${startDate}T00:00:00`); date.setDate(date.getDate() + 6); return localDate(date); })() : localDate(maximumEnd)} value={endDate} onChange={event => setEndDate(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" />
          </label>
          {error && <p role="alert" className="col-span-full text-sm text-red-700">{error}</p>}
          <div className="col-span-full flex flex-wrap gap-2">
            <button type="submit" disabled={saving || !startDate || !endDate} className="action-primary text-sm">{saving ? "Reserving…" : "Confirm reservation"}</button>
            <button type="button" onClick={() => setOpen(false)} className="action-secondary text-sm">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
