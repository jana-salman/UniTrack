import "server-only";
import { EQUIPMENT_ERROR_CONTRACT, isEquipmentItemSnapshot, isEquipmentComponentSnapshot, isOwnReturnProblem, type StudentReturnProblem } from "@unitrack/contracts";
import { AuthorizationError } from "@/lib/auth/errors";
import { createServiceCaller } from "./call-service";
import { callLoans, trustedIdentity } from "./loans";

export async function forwardReturnProblems(request: Request): Promise<Response> {
  try {
    const identity = await trustedIdentity(request);
    if (identity.role !== "student") return Response.json({ error: "Permission denied." }, { status: 403 });
    // Ignore browser-supplied borrower/lab/role parameters. Loans scopes the read.
    const response = await callLoans("/returns/problems/mine", identity);
    if (!response.ok) { response.headers.set("Cache-Control", "private, no-store"); return response; }
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(isOwnReturnProblem)) return Response.json({ error: "Invalid service response." }, { status: 502 });
    if (!data.length) return Response.json({ returns: [], partialData: false }, { headers: { "Cache-Control": "private, no-store" } });
    // Equipment supplies labels only after Loans has authorized the own-return read.
    let partialData = false;
    const labels = new Map<string, { name: string; components: Map<string, string> }>();
    let callEquipment: ReturnType<typeof createServiceCaller> | undefined;
    try { callEquipment = createServiceCaller({ baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "", secret: process.env.INTERNAL_JWT_SECRET ?? "", errorContract: EQUIPMENT_ERROR_CONTRACT }); }
    catch { partialData = true; }
    for (const itemId of new Set(data.map(row => row.itemId))) {
      let name = "Equipment label unavailable";
      const components = new Map<string, string>();
      if (callEquipment) {
        const [item, componentResponse] = await Promise.all([callEquipment("/items/" + encodeURIComponent(itemId), identity), callEquipment("/items/" + encodeURIComponent(itemId) + "/component-labels", identity)]);
        const itemData: unknown = item.ok ? await item.json() : null;
        const componentData: unknown = componentResponse.ok ? await componentResponse.json() : null;
        if (isEquipmentItemSnapshot(itemData) && itemData.id === itemId && itemData.lab_id === identity.lab_id) name = itemData.name;
        else partialData = true;
        if (Array.isArray(componentData) && componentData.every(isEquipmentComponentSnapshot)) for (const component of componentData) components.set(component.id, component.component_name);
        else partialData = true;
      }
      labels.set(itemId, { name, components });
    }
    const returns: StudentReturnProblem[] = data.map(row => ({
      loanId: row.loanId, itemId: row.itemId, returnedAt: row.returnedAt,
      itemName: labels.get(row.itemId)!.name,
      problems: row.problems.map(problem => {
        const label = problem.componentId === null ? "Main item" : labels.get(row.itemId)!.components.get(problem.componentId);
        if (!label) partialData = true;
        return { componentId: problem.componentId, kind: problem.kind, notes: problem.notes, label: label ?? "Component label unavailable" };
      }),
    }));
    return Response.json({ returns, partialData }, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": identity.rid } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Return problems are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
