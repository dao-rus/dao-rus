"use client";
import { useState } from "react";

export type CandidateSearchRow = { id: string; name: string; joinedOn: string | null; source: string; status: string; disabled?: boolean };
export function AwardCandidateSelection({ batchId, action, rows, filters = [], labels }: {
  batchId: string; action: "add_selected" | "exclude_selected"; rows: CandidateSearchRow[];
  filters?: Array<{ name: string; value: string }>;
  labels: { name: string; date: string; source: string; status: string; unknown: string; selectAll: string;
    deselect: string; selected: string; submit: string; confirm: string; empty: string };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = rows.filter(row => !row.disabled);
  if (!rows.length) return <p className="muted">{labels.empty}</p>;
  return <form action="/api/admin/awards/batches" method="post" className="awardSelection">
    <input type="hidden" name="batchId" value={batchId} />
    <input type="hidden" name="action" value={action} />
    {filters.map((field, i) => <input key={i} type="hidden" name={field.name} value={field.value} />)}
    <div className="actions">
      <button className="button secondary" type="button" onClick={() => setSelected(new Set(selectable.map(row => row.id)))}>{labels.selectAll}</button>
      <button className="button secondary" type="button" onClick={() => setSelected(new Set())}>{labels.deselect}</button>
      <output aria-live="polite">{labels.selected}: {selected.size}</output>
    </div>
    <div className="awardSelectionTable"><table><thead><tr>
      <th scope="col">{labels.name}</th><th scope="col">{labels.date}</th><th scope="col">{labels.source}</th><th scope="col">{labels.status}</th>
    </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
      <td><label><input type="checkbox" name={action === "add_selected" ? "participantIds" : "candidateIds"} value={row.id}
        disabled={row.disabled} checked={selected.has(row.id)} onChange={event => {
          const checked = event.target.checked;
          setSelected(previous => { const next = new Set(previous); if (checked) next.add(row.id); else next.delete(row.id); return next; });
        }} /> {row.name}</label></td>
      <td>{row.joinedOn ? row.joinedOn.split("-").reverse().join(".") : labels.unknown}</td>
      <td>{row.source}</td><td>{row.status}</td>
    </tr>)}</tbody></table></div>
    {action === "exclude_selected" ? <label><input type="checkbox" name="confirm" required /> {labels.confirm}</label> : null}
    <button className="button secondary" type="submit" disabled={!selected.size}>{labels.submit}</button>
  </form>;
}
