"use client";

import { useEffect, useRef, useState } from "react";

export type WizardStep = { label: string; optional?: boolean; ready?: boolean; hint?: string };

export function useWizardStep(count: number) {
  const [step, setStepState] = useState(0);

  useEffect(() => {
    const read = () => {
      const raw = Number(new URLSearchParams(window.location.search).get("step"));
      const next = Number.isFinite(raw) && raw >= 1 ? Math.min(count, Math.round(raw)) - 1 : 0;
      setStepState(next);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [count]);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    setStepState(clamped);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(clamped + 1));
    window.history.pushState({ step: clamped }, "", url);
  };

  return { step, go };
}

// Move focus to the new step's heading when the step changes (not on the first render).
export function useStepFocus(step: number) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const section = document.querySelector<HTMLElement>(`[data-wizard-step="${step}"]`);
    const heading = section?.querySelector<HTMLElement>("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [step]);
}

export function StepNav({
  base,
  steps,
  step,
  done,
  onStep,
}: {
  base: string;
  steps: WizardStep[];
  step: number;
  done: boolean[];
  onStep: (step: number) => void;
}) {
  return (
    <nav className="wizard" aria-label="Steps">
      <ol className="wizard-steps">
        {steps.map((item, index) => {
          const reachable = index === step || index < step || item.ready !== false;
          const content = (
            <>
              <span className="wizard-n">{done[index] ? "✓" : index + 1}</span>
              <span>
                {item.label}
                {item.optional ? <span className="wizard-optional"> · optional</span> : null}
              </span>
            </>
          );
          const className = `wizard-step${index === step ? " active" : ""}${done[index] ? " done" : ""}${reachable ? "" : " blocked"}`;
          return (
            <li key={item.label}>
              {reachable ? (
                <a
                  className={className}
                  href={`${base}?step=${index + 1}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    event.preventDefault();
                    onStep(index);
                  }}
                  aria-current={index === step ? "step" : undefined}
                >
                  {content}
                </a>
              ) : (
                <button
                  type="button"
                  className={className}
                  aria-disabled="true"
                  aria-label={`${item.label}${item.optional ? " (optional)" : ""} — ${item.hint ?? "Not available yet"}`}
                  title={item.hint}
                  onClick={(event) => event.preventDefault()}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WizardFooter({
  step,
  count,
  onStep,
  canAdvance,
  hint,
}: {
  step: number;
  count: number;
  onStep: (step: number) => void;
  canAdvance: boolean;
  hint?: string;
}) {
  return (
    <div className="wizard-footer">
      <button type="button" className="btn small ghost" onClick={() => onStep(step - 1)} disabled={step === 0}>
        ← Back
      </button>
      <span className="note" aria-live="polite">
        {step < count - 1 && !canAdvance && hint ? hint : `Step ${step + 1} of ${count}`}
      </span>
      {step < count - 1 ? (
        <button
          type="button"
          className="btn small"
          onClick={() => onStep(step + 1)}
          disabled={!canAdvance}
          title={!canAdvance ? hint : undefined}
        >
          Next →
        </button>
      ) : (
        <span className="note" aria-hidden="true" />
      )}
    </div>
  );
}
