"use client";

import { useId, useState } from "react";
import Link from "next/link";

type ParticipantNameProps = {
  participantId: string;
  children: string;
  verificationPoints: number;
  positiveCount: number;
};

function Index({ value, kind, label, explanation }: {
  value: number; kind: "verification" | "reputation"; label: string; explanation: string;
}) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <span className={`participantIndex ${kind}Index`}>
      <button type="button" title={explanation} aria-label={`${label}: ${value}. ${open ? "Скрыть" : "Показать"} пояснение`}
        aria-expanded={open} aria-controls={helpId} onClick={() => setOpen(!open)}>
        <sup>{value}</sup>
      </button>
      <span id={helpId} className="participantIndexHelp" hidden={!open}>{explanation}</span>
    </span>
  );
}

export function ParticipantName({ participantId, children, verificationPoints, positiveCount }: ParticipantNameProps) {
  return (
    <span className="participantName">
      <Link href={`/profile/${participantId}`}>{children}</Link>
      <Index value={verificationPoints} kind="verification" label="Вес верификации"
        explanation={`Вес верификации: ${verificationPoints}. Сейчас это число действующих подтверждений от верифицированных участников.`} />
      <Index value={positiveCount} kind="reputation" label="Репутация: положительные сигналы"
        explanation={`Репутация: ${positiveCount} действующих положительных сигналов о хорошем опыте взаимодействия.`} />
    </span>
  );
}
