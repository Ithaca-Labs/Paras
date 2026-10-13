/** Re-mounts on every navigation, so each page ink-rises in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="rise">{children}</div>;
}
