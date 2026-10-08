import { defineRoute } from '../route.js';
import { z } from '../zod.js';

export const ExperienceLevel = z.enum(['beginner', 'intermediate', 'advanced']);
export const RiskAppetite = z.enum(['conservative', 'balanced', 'aggressive']);
export const StakeSize = z.enum(['small', 'medium', 'large']);
export const Horizon = z.enum(['week', 'month', 'long', 'any']);

const Ids = z.array(z.string().min(1).max(100)).max(50);

/** Fields a caller may set. Omitted fields keep their stored value. */
export const ProfileUpdate = z.object({
  /** Taxonomy ids (`GET /v1/categories`): categories, topics and entities respectively. */
  categories: Ids.optional(),
  topics: Ids.optional(),
  entities: Ids.optional(),
  /** Free-text interests, embedded server-side ("I follow F1 and AI startups"). */
  freeText: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
  experience: ExperienceLevel.nullable().optional(),
  riskAppetite: RiskAppetite.nullable().optional(),
  /** Typical stake: small < $25, medium $25-250, large > $250. */
  stakeSize: StakeSize.nullable().optional(),
  horizon: Horizon.nullable().optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const InterestProfile = z.object({
  /** `none`: never onboarded. `skipped`: onboarding skipped (default Feed). */
  status: z.enum(['none', 'skipped', 'completed']),
  /** True while the profile belongs to a signed-out visitor (merged into the User on sign-in). */
  anonymous: z.boolean(),
  /**
   * Set only when this call minted a new anonymous profile. Browsers also get it as the
   * `paras_anon` cookie; other clients send it back in the `x-paras-anon` header.
   */
  anonToken: z.string().nullable(),
  categories: z.array(z.string()),
  topics: z.array(z.string()),
  entities: z.array(z.string()),
  freeText: z.array(z.string()),
  experience: ExperienceLevel.nullable(),
  riskAppetite: RiskAppetite.nullable(),
  stakeSize: StakeSize.nullable(),
  horizon: Horizon.nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type InterestProfile = z.infer<typeof InterestProfile>;

const tags = ['profile'];

export const getProfile = defineRoute({
  method: 'get',
  path: '/v1/profile',
  operationId: 'getProfile',
  summary:
    'Caller Interest Profile: the signed-in User, else the anonymous profile (cookie or x-paras-anon header)',
  tags,
  request: {},
  response: InterestProfile,
});

export const updateProfile = defineRoute({
  method: 'patch',
  path: '/v1/profile',
  operationId: 'updateProfile',
  summary:
    'Create or edit the Interest Profile (merge: omitted fields are kept). Works signed out; unknown taxonomy ids are rejected',
  tags,
  request: { body: ProfileUpdate },
  response: InterestProfile,
});

export const skipOnboarding = defineRoute({
  method: 'post',
  path: '/v1/profile/skip',
  operationId: 'skipOnboarding',
  summary: 'Skip onboarding; the Feed falls back to the default. No-op if already completed',
  tags,
  request: {},
  response: InterestProfile,
});

export const resetProfile = defineRoute({
  method: 'delete',
  path: '/v1/profile',
  operationId: 'resetProfile',
  summary: 'Delete the Interest Profile (back to `none`)',
  tags,
  request: {},
  response: z.object({ ok: z.literal(true) }),
});

export const OnboardingOptions = z.object({
  experience: z.array(ExperienceLevel),
  riskAppetite: z.array(RiskAppetite),
  stakeSize: z.array(StakeSize),
  horizon: z.array(Horizon),
});

export const getOnboardingOptions = defineRoute({
  method: 'get',
  path: '/v1/onboarding/options',
  operationId: 'getOnboardingOptions',
  summary:
    'Allowed values for the profile enums. Categories, topics and entities come from `GET /v1/categories`',
  tags,
  request: {},
  response: OnboardingOptions,
});

export const InterpretBody = z.object({ text: z.string().trim().min(1).max(300) });

export const InterpretResult = z.object({
  matches: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(['category', 'topic', 'entity']),
      similarity: z.number(),
    }),
  ),
});

export const interpretInterest = defineRoute({
  method: 'post',
  path: '/v1/onboarding/interpret',
  operationId: 'interpretInterest',
  summary: 'Map a free-text interest to the nearest taxonomy topics and entities (suggestions)',
  tags,
  request: { body: InterpretBody },
  response: InterpretResult,
});

export const ExplainerSection = z.object({ id: z.string(), title: z.string(), body: z.string() });

export const getExplainer = defineRoute({
  method: 'get',
  path: '/v1/onboarding/explainer',
  operationId: 'getExplainer',
  summary:
    'How prediction markets work, sized to experience: `?experience=`, else the caller profile, else beginner',
  tags,
  request: { query: z.object({ experience: ExperienceLevel.optional() }) },
  response: z.object({
    experience: ExperienceLevel,
    sections: z.array(ExplainerSection),
  }),
});
