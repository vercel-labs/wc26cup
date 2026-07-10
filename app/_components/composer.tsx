"use client";

import { CornerDownLeftIcon, PlusIcon, SquareIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/utils";

export function Composer({
  disabled = false,
  onNewChat,
  onStop,
  onSubmit,
  status,
  streaming = false,
}: {
  readonly disabled?: boolean;
  readonly onNewChat?: () => void;
  readonly onStop: () => void;
  readonly onSubmit: (text: string) => void;
  readonly status?: string;
  readonly streaming?: boolean;
}) {
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSubmit(text.trim());
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="relative rounded-lg border bg-input/30 shadow-sm backdrop-blur-sm transition-colors focus-within:border-ring">
          {status ? (
            <div className="-top-3 absolute left-4 z-10 flex size-5 items-center justify-center rounded-full border bg-[color-mix(in_oklab,var(--input)_30%,var(--background))]">
              <StatusDot status={status} />
            </div>
          ) : null}
          <textarea
            className="field-sizing-content max-h-44 min-h-11 w-full resize-none border-0 bg-transparent px-3.5 pt-3.5 text-foreground text-sm leading-6 outline-none placeholder:text-muted-foreground"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the World Cup…"
            rows={1}
            value={text}
          />
          <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5">
            {onNewChat ? (
              <button
                aria-label="New chat"
                className="mr-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={onNewChat}
                title="New chat"
                type="button"
              >
                <PlusIcon aria-hidden className="size-4" />
              </button>
            ) : null}
            {streaming ? (
              <button
                className="flex items-center gap-1.5 rounded-md border bg-secondary/75 px-2.5 py-1.5 font-mono text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
                onClick={onStop}
                type="button"
              >
                <SquareIcon aria-hidden className="size-3" />
                stop
              </button>
            ) : (
              <button
                className="flex items-center gap-1.5 rounded-md border bg-secondary/75 px-2.5 py-1.5 font-mono text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-secondary/75 disabled:hover:text-muted-foreground"
                disabled={!canSend}
                type="submit"
              >
                <CornerDownLeftIcon aria-hidden className="size-3.5" />
                send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function StatusDot({ status }: { readonly status: string }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : status === "ready"
          ? "bg-muted-foreground"
          : "bg-muted-foreground/50";

  return (
    <span className="relative flex size-1.5">
      {isLive ? (
        <span
          className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", tone)}
        />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full transition-colors", tone)} />
    </span>
  );
}
