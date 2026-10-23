// This is the one visual idea the whole product is built around:
// making an opaque government process visibly trackable. It's
// reused on the landing page (as an illustration) and on the
// farmer dashboard (as a live status), so a farmer learns to read
// it once and recognizes it everywhere.

interface ProcessChainProps {
  stages: string[];
  currentIndex: number; // -1 means nothing has started yet
  compact?: boolean;
}

export function ProcessChain({ stages, currentIndex, compact = false }: ProcessChainProps) {
  return (
    <div className="flex w-full items-start overflow-x-auto pb-2">
      {stages.map((stage, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isLast = i === stages.length - 1;

        return (
          <div key={stage} className="flex flex-1 min-w-[84px] flex-col items-center">
            <div className="flex w-full items-center">
              <div
                className={[
                  "flex shrink-0 items-center justify-center rounded-full font-display font-semibold transition",
                  compact ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm",
                  isDone
                    ? "bg-field text-paper"
                    : isCurrent
                    ? "bg-wheat text-soil ring-4 ring-wheat-light/50"
                    : "bg-soil-light/15 text-soil-light",
                ].join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isDone ? "✓" : i + 1}
              </div>
              {!isLast && (
                <div
                  className={[
                    "h-0.5 flex-1",
                    isDone ? "bg-field" : "bg-soil-light/20",
                  ].join(" ")}
                />
              )}
            </div>
            <span
              className={[
                "mt-2 text-center leading-tight",
                compact ? "text-[11px]" : "text-xs",
                isCurrent ? "font-semibold text-soil" : "text-soil-light",
              ].join(" ")}
            >
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
