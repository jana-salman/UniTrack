export function PageStatus({ children }: { children: string }) {
  return <p className="status-panel" role="status">{children}</p>;
}
