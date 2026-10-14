"use client";
import { useRef } from "react";
// Знак награды крупно и по центру; по клику — то же изображение в полный экран.
// Диалог — родной браузерный: закрывается кликом и Escape, без библиотек.
export function AwardImage({ src, alt }: {
  src: string;
  alt: string;
}) {
  const zoom = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="awardMedal" aria-label={`${alt}: открыть изображение целиком`} onClick={() => zoom.current?.showModal()}>
      <img className="awardImage" src={src} alt={alt} width={400} height={400} />
    </button>
    <dialog className="awardZoom" ref={zoom} aria-label={alt} onClick={() => zoom.current?.close()}>
      <img src={src} alt={alt} />
    </dialog>
  </>;
}
