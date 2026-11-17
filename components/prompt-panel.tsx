"use client";

export function PromptPanel({
  prompt,
  override,
  onOverrideChange,
  onPromptChange,
  onRebuild,
}: {
  prompt: string;
  override: boolean;
  onOverrideChange: (value: boolean) => void;
  onPromptChange: (value: string) => void;
  onRebuild: () => void;
}) {
  return (
    <div className="field">
      <div className="row between">
        <label htmlFor="prompt">Six-section MiniMax H3 prompt</label>
        <div className="row" style={{ gap: 8 }}>
          {override ? (
            <>
              <button className="btn small ghost" onClick={onRebuild}>Rebuild from fields</button>
              <button className="btn small ghost" onClick={() => onOverrideChange(false)}>Return to automatic</button>
            </>
          ) : (
            <button className="btn small ghost" onClick={() => onOverrideChange(true)}>Edit manually</button>
          )}
        </div>
      </div>
      <textarea
        id="prompt"
        className="textarea prompt"
        value={prompt}
        readOnly={!override}
        onChange={(event) => onPromptChange(event.target.value)}
        spellCheck={false}
      />
      {override ? (
        <span className="note warn">
          Manual prompt active: changes to the fields above are not applied to the prompt. Rebuild or return to automatic to
          follow the fields again.
        </span>
      ) : (
        <span className="note">
          Generated from the fields above. Viggle Remake reads this verbatim: subject_definitions, summary,
          retention_analysis, detailed_description, overall_soundscape, non_diegetic_music.
        </span>
      )}
    </div>
  );
}
