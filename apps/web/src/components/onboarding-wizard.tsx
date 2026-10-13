'use client';

import type { InterestProfile, TaxonomyCategory } from '@paras/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorState } from './states';

type Opts = Awaited<ReturnType<typeof api.getOnboardingOptions>>;
type Suggestion = Awaited<ReturnType<typeof api.interpretInterest>>['matches'][number];
type Explainer = Awaited<ReturnType<typeof api.getExplainer>>;

const STEPS = ['Categories', 'Topics', 'Your interests', 'About you', 'How it works'] as const;
const btn =
  'rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:brightness-110 disabled:opacity-50';
const ghost = 'rounded-sm border border-border px-4 py-2 text-sm text-muted hover:text-fg';
const pill = (on: boolean) =>
  `flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm ${
    on
      ? 'border-fg bg-fg text-bg before:size-2 before:rounded-[2px] before:bg-seal'
      : 'border-border text-muted hover:border-fg/50 hover:text-fg'
  }`;

const toggle = (xs: string[], x: string) =>
  xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: T[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            className={pill(value === o)}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function OnboardingWizard({
  tree,
  options,
  initial,
}: {
  tree: TaxonomyCategory[];
  options: Opts;
  initial: InterestProfile;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [cats, setCats] = useState(initial.categories);
  const [topics, setTopics] = useState(initial.topics);
  const [entities, setEntities] = useState(initial.entities);
  const [freeText, setFreeText] = useState(initial.freeText.join('\n'));
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [experience, setExperience] = useState(initial.experience);
  const [risk, setRisk] = useState(initial.riskAppetite);
  const [stake, setStake] = useState(initial.stakeSize);
  const [horizon, setHorizon] = useState(initial.horizon);
  const [explainer, setExplainer] = useState<Explainer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shownTopics = tree.filter((c) => cats.includes(c.id)).flatMap((c) => c.topics);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const suggest = () =>
    guard(async () => {
      const res = await Promise.all(
        lines(freeText).map((text) => api.interpretInterest({ body: { text } })),
      );
      const seen = new Set<string>();
      setSugg(res.flatMap((r) => r.matches).filter((m) => !seen.has(m.id) && seen.add(m.id)));
    });

  const addSuggestion = (m: Suggestion) => {
    const add = (xs: string[]) => (xs.includes(m.id) ? xs : [...xs, m.id]);
    if (m.kind === 'category') setCats(add);
    else if (m.kind === 'topic') setTopics(add);
    else setEntities(add);
  };

  const done = () => {
    router.push('/feed');
    router.refresh();
  };

  const finish = () =>
    guard(async () => {
      await api.updateProfile({
        body: {
          categories: cats,
          topics,
          entities,
          freeText: lines(freeText),
          experience,
          riskAppetite: risk,
          stakeSize: stake,
          horizon,
        },
      });
      done();
    });

  const skip = () =>
    guard(async () => {
      await api.skipOnboarding();
      done();
    });

  const next = () => {
    if (step !== 3) return setStep(step + 1);
    void guard(async () => {
      setExplainer(await api.getExplainer({ query: experience ? { experience } : {} }));
      setStep(4);
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <ol className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={i === step ? 'font-medium text-fg' : ''}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-wrap gap-2">
          {tree.map((c) => (
            <button
              key={c.id}
              aria-pressed={cats.includes(c.id)}
              className={pill(cats.includes(c.id))}
              onClick={() => setCats(toggle(cats, c.id))}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          {shownTopics.length === 0 && (
            <p className="text-sm text-muted">Pick a category first, or continue.</p>
          )}
          {shownTopics.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <button
                aria-pressed={topics.includes(t.id)}
                className={`${pill(topics.includes(t.id))} self-start`}
                onClick={() => setTopics(toggle(topics, t.id))}
              >
                {t.label}
              </button>
              <div className="flex flex-wrap gap-2 pl-4">
                {t.entities.map((e) => (
                  <button
                    key={e.id}
                    aria-pressed={entities.includes(e.id)}
                    className={pill(entities.includes(e.id))}
                    onClick={() => setEntities(toggle(entities, e.id))}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <label htmlFor="free" className="text-sm font-medium">
            Anything else you follow? One per line, up to 5.
          </label>
          <textarea
            id="free"
            rows={4}
            maxLength={1500}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="F1 and AI startups"
            className="rounded-sm border border-border bg-surface p-3 text-sm"
          />
          <button
            className={`${ghost} self-start`}
            disabled={busy || !freeText.trim()}
            onClick={suggest}
          >
            Suggest matches
          </button>
          {sugg.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Suggestions">
              {sugg.map((m) => {
                const on = [...cats, ...topics, ...entities].includes(m.id);
                return (
                  <button
                    key={m.id}
                    aria-pressed={on}
                    className={pill(on)}
                    onClick={() => addSuggestion(m)}
                  >
                    {on ? '✓ ' : '+ '}
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-5">
          <Choice
            label="Experience"
            options={options.experience}
            value={experience}
            onChange={setExperience}
          />
          <Choice
            label="Risk appetite"
            options={options.riskAppetite}
            value={risk}
            onChange={setRisk}
          />
          <Choice
            label="Typical stake"
            options={options.stakeSize}
            value={stake}
            onChange={setStake}
          />
          <Choice label="Horizon" options={options.horizon} value={horizon} onChange={setHorizon} />
        </div>
      )}

      {step === 4 && explainer && (
        <div className="flex flex-col gap-4">
          {explainer.sections.map((s) => (
            <section key={s.id}>
              <h2 className="font-medium">{s.title}</h2>
              <p className="text-sm text-muted">{s.body}</p>
            </section>
          ))}
        </div>
      )}

      {error && <ErrorState message={error} />}

      <div className="flex items-center gap-3">
        {step > 0 && (
          <button className={ghost} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 4 ? (
          <button className={btn} disabled={busy} onClick={next}>
            Next
          </button>
        ) : (
          <button className={btn} disabled={busy} onClick={finish}>
            Finish
          </button>
        )}
        <button className="ml-auto text-sm text-muted underline" disabled={busy} onClick={skip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
