"use client";

import { useSyncExternalStore } from "react";

const formatOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "medium",
};

export function formatLocalDateTime(value: string, timeZone?: string, dateOnly = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ru-RU", {
    ...(dateOnly ? { dateStyle: "long" as const } : formatOptions),
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

type LocalDateTimeProps = {
  value: string;
  // A day without the time of day, for dates where the hour means nothing to the reader.
  dateOnly?: boolean;
};

const subscribe = () => () => undefined;
const serverFallback = "…";

export function LocalDateTime({ value, dateOnly = false }: LocalDateTimeProps) {
  const formatted = useSyncExternalStore(
    subscribe,
    () => formatLocalDateTime(value, undefined, dateOnly),
    () => serverFallback,
  );

  return <time dateTime={value}>{formatted}</time>;
}
