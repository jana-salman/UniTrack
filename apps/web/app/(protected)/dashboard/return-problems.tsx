"use client";
import { useEffect, useState } from "react";
import { isStudentReturnProblem, type StudentReturnProblem } from "@unitrack/contracts";

export default function ReturnProblems() {
  const [data, setData] = useState<{ returns: StudentReturnProblem[]; partialData: boolean } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/returns/problems/mine", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw 0;
        const value: unknown = await response.json();
        if (!value || typeof value !== "object" || !("returns" in value) || !Array.isArray(value.returns) || !value.returns.every(isStudentReturnProblem) || !("partialData" in value) || typeof value.partialData !== "boolean") throw 0;
        if (!controller.signal.aborted) setData({ returns: value.returns, partialData: value.partialData });
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load(); return () => controller.abort();
  }, []);
  return <section className="panel mt-6 space-y-4 p-4 sm:p-6" aria-labelledby="return-problems-heading">
    <h2 id="return-problems-heading" className="text-lg font-semibold text-slate-950">My return problems</h2>
    <p className="text-slate-600">Missing items or new damage recorded when your equipment was returned.</p>
    {error ? <p role="alert" className="notice-panel">Return problems are temporarily unavailable. Please try again later.</p> : !data ? <p role="status" className="status-panel">Loading return records...</p> : <>
      {data.partialData && <p role="status">Some equipment or component labels are unavailable. Your recorded problems are still shown.</p>}
      {!data.returns.length && <p>No missing items or new damage recorded for your completed returns.</p>}
      <ul className="space-y-4">{data.returns.map(record => <li key={record.loanId} className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold">{record.itemName}</h3>
        <p>Returned: <time dateTime={record.returnedAt}>{new Date(record.returnedAt).toLocaleString()}</time></p>
        <ul>{record.problems.map(problem => <li key={problem.componentId ?? "main"} className="mt-2">
          <p>{problem.label}: <strong>{problem.kind === "missing" ? "Missing at return" : "New or additional damage at return"}</strong></p>
          {problem.notes && <p className="whitespace-pre-wrap">{problem.notes}</p>}
        </li>)}</ul>
      </li>)}</ul>
    </>}
  </section>;
}
