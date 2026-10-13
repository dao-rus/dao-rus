"use client";
import { Fragment, useId, useState, type ReactNode } from "react";

export type CandidateSearchRow = { id: string; name: string; joinedOn: string | null; source: string; status: string; disabled?: boolean; details?: ReactNode };
export function AwardCandidateSelection({ batchId, action, rows, filters = [], labels }: {
  batchId: string; action: "add_selected" | "remove_selected"; rows: CandidateSearchRow[];
  filters?: Array<{ name: string; value: string }>;
  labels: { name: string; date: string; source: string; status: string; unknown: string; selectAll: string;
    deselect: string; selected: string; submit: string; confirm: string; empty: string };
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const formId = useId();
  const selectable = rows.filter(row => !row.disabled);
  if (!rows.length) return <p className="muted">{labels.empty}</p>;
  return <div className="awardSelection"><form id={formId} action="/api/admin/awards/batches" method="post">
    <input type="hidden" name="batchId" value={batchId} />
    <input type="hidden" name="action" value={action} />
    {filters.map((field, i) => <input key={i} type="hidden" name={field.name} value={field.value} />)}
    <div className="actions">
      <button className="button secondary" type="button" onClick={() => setSelected(new Set(selectable.map(row => row.id)))}>{labels.selectAll}</button>
      <button className="button secondary" type="button" onClick={() => setSelected(new Set())}>{labels.deselect}</button>
      <output aria-live="polite">{labels.selected}: {selected.size}</output>
    </div>
    {action === "remove_selected" ? <label><input type="checkbox" name="confirm" required /> {labels.confirm}</label> : null}
    <button className="button secondary" type="submit" disabled={!selected.size}>{labels.submit}</button>
    </form>
    <div className="awardSelectionTable"><table><thead><tr>
      <th scope="col">{labels.name}</th><th scope="col">{labels.date}</th><th scope="col">{labels.source}</th><th scope="col">{labels.status}</th>
    </tr></thead><tbody>{rows.map(row => <Fragment key={row.id}><tr>
      <td><label><input form={formId} type="checkbox" name={action === "add_selected" ? "participantIds" : "candidateIds"} value={row.id}
        disabled={row.disabled} checked={selected.has(row.id)} onChange={event => {
          const checked = event.target.checked;
          setSelected(previous => { const next = new Set(previous); if (checked) next.add(row.id); else next.delete(row.id); return next; });
        }} /> {row.name}</label></td>
      <td>{row.joinedOn ? row.joinedOn.split("-").reverse().join(".") : labels.unknown}</td>
      <td>{row.source}</td><td>{row.status}</td>
    </tr>{row.details ? <tr><td colSpan={4}>{row.details}</td></tr> : null}</Fragment>)}</tbody></table></div>
  </div>;
}
