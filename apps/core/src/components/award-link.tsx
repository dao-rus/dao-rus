"use client";
import { useState } from "react";
export function AwardLink({ href, label, copied }: {
    href: string;
    label: string;
    copied: string;
}) {
    const [done, setDone] = useState(false);
    return <div><a href={href}>{href}</a> <button type="button" onClick={async () => {
            try {
                await navigator.clipboard.writeText(new URL(href, window.location.origin).href);
                setDone(true);
            }
            catch {
                setDone(false);
            }
        }}>{done ? copied : label}</button></div>;
}
