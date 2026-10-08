import { cosine, type Embedder } from './embedding.js';

export type TagKind = 'category' | 'topic' | 'entity';

/**
 * One node of the curated taxonomy: category -> topic -> entity. Ids are globally unique, stable
 * slugs; they are stored on Events (`event_tags.tag_id`) and in Interest Profiles, so renaming one
 * is a data migration.
 */
export interface TaxonomyNode {
  id: string;
  label: string;
  kind: TagKind;
  /** Parent id (topic -> category, entity -> topic). Undefined for categories. */
  parent?: string;
  /** Case-insensitive whole-word/phrase matches that tag an Event directly. */
  keywords: readonly string[];
  /** Embedded to classify by similarity. Defaults to the label plus keywords. */
  description?: string;
}

type Spec = readonly [id: string, label: string, keywords: string, description?: string];

const nodes: TaxonomyNode[] = [];
const add = (kind: TagKind, parent: string | undefined, [id, label, kw, description]: Spec) => {
  nodes.push({
    id,
    label,
    kind,
    ...(parent && { parent }),
    keywords: kw.split('|').filter(Boolean),
    ...(description && { description }),
  });
};
const category = (spec: Spec, topics: readonly [Spec, ...Spec[]][]) => {
  add('category', undefined, spec);
  for (const [topic, ...entities] of topics) {
    add('topic', spec[0], topic);
    for (const entity of entities) add('entity', topic[0], entity);
  }
};

category(
  [
    'politics',
    'Politics',
    'politics|political|government|congress|senate|parliament',
    'Politics: elections, government, legislation, world leaders and geopolitics',
  ],
  [
    [
      [
        'us-elections',
        'US elections',
        'election|elections|presidential|primary|primaries|nominee|ballot|midterms|electoral|vote share',
        'US elections: presidential race, primaries, midterms, Senate and House control, polls',
      ],
      ['trump', 'Donald Trump', 'trump|donald trump'],
      ['biden', 'Joe Biden', 'biden|joe biden'],
      ['harris', 'Kamala Harris', 'harris|kamala'],
      ['vance', 'JD Vance', 'vance|jd vance'],
    ],
    [
      [
        'geopolitics',
        'Geopolitics & conflict',
        'war|ceasefire|invade|invasion|nato|sanctions|missile|military|treaty|peace deal',
        'Geopolitics: wars, ceasefires, sanctions, military action and international diplomacy',
      ],
      ['ukraine', 'Ukraine', 'ukraine|ukrainian|zelensky'],
      ['russia', 'Russia', 'russia|russian|putin|kremlin'],
      ['israel-gaza', 'Israel & Gaza', 'israel|israeli|gaza|hamas|netanyahu'],
      ['iran', 'Iran', 'iran|iranian|tehran'],
      ['china-taiwan', 'China & Taiwan', 'china|chinese|taiwan|xi jinping|beijing'],
    ],
    [
      [
        'us-policy',
        'US government & policy',
        'supreme court|executive order|shutdown|impeach|impeachment|cabinet|attorney general|legislation|bill passes',
        'US government and policy: Congress, the White House, Supreme Court, shutdowns and legislation',
      ],
    ],
    [
      [
        'world-elections',
        'World elections',
        'prime minister|chancellor|parliamentary|snap election|general election|president of',
        'Elections and leaders outside the US: prime ministers, presidents, parliaments',
      ],
    ],
  ],
);

category(
  [
    'sports',
    'Sports',
    'sports|championship|tournament|playoffs',
    'Sports: leagues, tournaments, teams, players and match outcomes',
  ],
  [
    [
      [
        'nba',
        'NBA',
        'nba|basketball|nba finals|mvp',
        'NBA basketball: teams, players, playoffs and the NBA Finals',
      ],
      ['lakers', 'Los Angeles Lakers', 'lakers|lebron|lebron james'],
      ['celtics', 'Boston Celtics', 'celtics'],
      ['warriors', 'Golden State Warriors', 'warriors|stephen curry|steph curry'],
    ],
    [
      [
        'nfl',
        'NFL',
        'nfl|super bowl|american football|quarterback|touchdown',
        'NFL American football: teams, quarterbacks, playoffs and the Super Bowl',
      ],
      ['chiefs', 'Kansas City Chiefs', 'chiefs|mahomes|patrick mahomes'],
    ],
    [
      [
        'soccer',
        'Soccer',
        'soccer|football club|premier league|champions league|la liga|world cup|uefa|fifa|serie a|bundesliga',
        'Soccer: Premier League, Champions League, World Cup and club football',
      ],
      ['real-madrid', 'Real Madrid', 'real madrid'],
      ['man-city', 'Manchester City', 'manchester city|man city'],
    ],
    [
      [
        'baseball',
        'MLB',
        'mlb|baseball|world series|home run',
        'MLB baseball: teams, players, the postseason and the World Series',
      ],
    ],
    [
      [
        'tennis-golf',
        'Tennis & golf',
        'tennis|wimbledon|us open|french open|australian open|golf|masters|pga',
        'Tennis and golf: grand slams, ATP, WTA, PGA Tour and major championships',
      ],
    ],
    [
      [
        'combat-motorsport',
        'MMA, boxing & F1',
        'ufc|mma|boxing|formula 1|f1|grand prix|nascar',
        'Combat sports and motorsport: UFC, boxing, Formula 1 and NASCAR',
      ],
    ],
  ],
);

category(
  [
    'crypto',
    'Crypto',
    'crypto|cryptocurrency|blockchain|token|onchain',
    'Crypto: cryptocurrencies, prices, protocols, exchanges and regulation',
  ],
  [
    [
      [
        'bitcoin',
        'Bitcoin',
        'bitcoin|btc|satoshi',
        'Bitcoin price, ETFs, treasuries, halving and adoption',
      ],
    ],
    [
      [
        'ethereum',
        'Ethereum',
        'ethereum|eth|ether|layer 2',
        'Ethereum price, upgrades, ETFs, staking and layer 2 networks',
      ],
    ],
    [
      [
        'altcoins',
        'Altcoins & memecoins',
        'solana|xrp|ripple|dogecoin|doge|memecoin|altcoin|cardano|bnb|pepe',
        'Altcoins and memecoins: Solana, XRP, Dogecoin and other token prices and listings',
      ],
      ['solana', 'Solana', 'solana'],
      ['xrp', 'XRP', 'xrp|ripple'],
      ['dogecoin', 'Dogecoin', 'dogecoin|doge'],
    ],
    [
      [
        'crypto-regulation',
        'Crypto regulation & companies',
        'sec|etf approval|coinbase|binance|stablecoin|tether|crypto bill|clarity act|genius act|tokenization',
        'Crypto regulation, exchanges, stablecoins and company events',
      ],
    ],
  ],
);

category(
  [
    'economics',
    'Economics & macro',
    'economy|economic|macro|finance',
    'Economics and macro: central banks, inflation, jobs, growth, trade and financial markets',
  ],
  [
    [
      [
        'fed-rates',
        'Fed & interest rates',
        'fed|federal reserve|fomc|rate cut|rate hike|interest rate|interest rates|powell|basis points|bps',
        'Federal Reserve decisions, FOMC meetings, interest rate cuts and hikes, central banks',
      ],
    ],
    [
      [
        'inflation-jobs',
        'Inflation & jobs',
        'inflation|cpi|pce|unemployment|jobs report|nonfarm|payrolls|jobless',
        'Inflation, CPI, unemployment and the monthly jobs report',
      ],
    ],
    [
      [
        'growth-trade',
        'Growth, recession & trade',
        'recession|gdp|tariff|tariffs|trade war|debt ceiling|deficit',
        'Economic growth, recession risk, GDP, tariffs and trade policy',
      ],
    ],
    [
      [
        'markets',
        'Stocks & commodities',
        's&p 500|s&p|nasdaq|dow jones|stock market|stocks|oil|crude|gold|silver|treasury yield|ipo',
        'Stock indices, commodities like oil and gold, bond yields and IPOs',
      ],
    ],
  ],
);

category(
  [
    'tech-ai',
    'Tech & AI',
    'technology|tech|software|artificial intelligence',
    'Technology and AI: AI models, labs, big tech companies, products, chips and launches',
  ],
  [
    [
      [
        'ai-models',
        'AI models & labs',
        'ai|artificial intelligence|llm|chatbot|gpt|openai|anthropic|claude|gemini|deepseek|agi|ai model|grok|xai',
        'AI models and labs: OpenAI, Anthropic, Google DeepMind, model releases, benchmarks and AGI',
      ],
      ['openai', 'OpenAI', 'openai|chatgpt|gpt|sam altman'],
      ['anthropic', 'Anthropic', 'anthropic|claude'],
      ['google', 'Google', 'google|alphabet|deepmind|gemini'],
    ],
    [
      [
        'big-tech',
        'Big tech & products',
        'apple|microsoft|amazon|meta|nvidia|tesla|iphone|netflix|spacex|elon musk|tiktok|chip|semiconductor',
        'Big tech companies, product launches, chips and earnings',
      ],
      ['nvidia', 'Nvidia', 'nvidia'],
      ['tesla', 'Tesla & Elon Musk', 'tesla|elon musk|musk'],
      ['apple', 'Apple', 'apple|iphone'],
    ],
  ],
);

category(
  [
    'culture',
    'Culture & entertainment',
    'culture|entertainment|celebrity',
    'Culture and entertainment: film, TV, music, awards, celebrities and social media',
  ],
  [
    [
      [
        'film-tv',
        'Film & TV',
        'movie|film|box office|oscars|academy awards|emmys|netflix series|tv show|season finale|rotten tomatoes|trailer',
        'Movies, box office, TV shows, streaming series and awards like the Oscars and Emmys',
      ],
    ],
    [
      [
        'music',
        'Music',
        'album|grammy|grammys|billboard|spotify|song|concert|tour|taylor swift|beyonce|drake',
        'Music: albums, charts, Grammys, tours and artists',
      ],
      ['taylor-swift', 'Taylor Swift', 'taylor swift'],
    ],
    [
      [
        'celebrity-media',
        'Celebrities & social media',
        'celebrity|youtube|mrbeast|twitter|tweet|tweets|instagram|influencer|kardashian|streamer',
        'Celebrities, influencers, social media posts, followers and viral events',
      ],
    ],
  ],
);

category(
  [
    'science',
    'Science & health',
    'science|scientific|research',
    'Science and health: space, medicine, public health, discoveries and climate research',
  ],
  [
    [
      [
        'space',
        'Space',
        'nasa|spacex|starship|rocket|moon|mars|asteroid|satellite|artemis',
        'Space exploration: NASA, SpaceX, Starship launches, the Moon and Mars',
      ],
    ],
    [
      [
        'health',
        'Health & medicine',
        'fda|vaccine|covid|pandemic|outbreak|measles|bird flu|h5n1|cancer|drug approval|who declares',
        'Public health and medicine: FDA approvals, vaccines, outbreaks and pandemics',
      ],
    ],
    [
      [
        'climate-energy',
        'Climate & energy',
        'climate|emissions|renewable|nuclear|fusion|solar|carbon|global warming',
        'Climate change, emissions, renewable and nuclear energy',
      ],
    ],
  ],
);

category(
  [
    'weather',
    'Weather',
    'weather|forecast',
    'Weather: temperatures, storms, hurricanes, snow, rainfall and natural disasters',
  ],
  [
    [
      [
        'storms',
        'Hurricanes & storms',
        'hurricane|tropical storm|typhoon|cyclone|tornado|landfall|category 5|noaa',
        'Hurricanes, tropical storms, typhoons, tornadoes and landfall',
      ],
    ],
    [
      [
        'temperature',
        'Temperature & precipitation',
        'temperature|hottest|coldest|heatwave|heat wave|snowfall|snow|rainfall|degrees|record high|record low|earthquake|wildfire',
        'Temperature records, heatwaves, snowfall, rainfall, earthquakes and wildfires',
      ],
    ],
  ],
);

/** The curated taxonomy, categories first then their topics and entities. */
export const TAXONOMY: readonly TaxonomyNode[] = nodes;

const byId = new Map(nodes.map((n) => [n.id, n]));
export const taxonomyNode = (id: string): TaxonomyNode | undefined => byId.get(id);

export const taxonomyCategories = (): TaxonomyNode[] => nodes.filter((n) => n.kind === 'category');
export const taxonomyChildren = (id: string): TaxonomyNode[] =>
  nodes.filter((n) => n.parent === id);

/** Text embedded for a node. */
export const nodeEmbeddingText = (n: TaxonomyNode): string =>
  n.description ?? `${n.label}: ${n.keywords.join(', ')}`;

/** Taxonomy nodes with precomputed vectors. Build once per process with {@link buildTaxonomyIndex}. */
export interface TaxonomyIndex {
  nodes: readonly TaxonomyNode[];
  vectors: ReadonlyMap<string, readonly number[]>;
  matchers: ReadonlyMap<string, RegExp>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regexp per node matching any of its keywords as whole words/phrases. */
export function keywordMatcher(keywords: readonly string[]): RegExp {
  const alt = keywords.map((k) => escapeRe(k.toLowerCase()).replace(/\s+/g, '\\s+')).join('|');
  return new RegExp(`(?<![a-z0-9])(?:${alt})(?![a-z0-9])`, 'i');
}

/** Embed every node once. The vectors let {@link classify} score an Event against the taxonomy. */
export async function buildTaxonomyIndex(
  embedder: Embedder,
  taxonomy: readonly TaxonomyNode[] = TAXONOMY,
): Promise<TaxonomyIndex> {
  const vecs = await embedder.embed(taxonomy.map(nodeEmbeddingText));
  return {
    nodes: taxonomy,
    vectors: new Map(taxonomy.map((n, i) => [n.id, vecs[i]!])),
    matchers: new Map(taxonomy.map((n) => [n.id, keywordMatcher(n.keywords)])),
  };
}

/** Nodes ranked by cosine similarity to a vector (e.g. a free-text interest). */
export function nearestNodes(
  index: TaxonomyIndex,
  vector: readonly number[],
  { kind, limit = 5 }: { kind?: TagKind; limit?: number } = {},
): { node: TaxonomyNode; similarity: number }[] {
  return index.nodes
    .filter((n) => !kind || n.kind === kind)
    .map((node) => ({ node, similarity: cosine(vector, index.vectors.get(node.id)!) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
