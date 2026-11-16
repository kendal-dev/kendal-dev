// Builds assets/stats.svg and assets/langs.svg from the GitHub GraphQL API.
// Runs daily in .github/workflows/stats.yml; no dependencies (Node 20+).
import { writeFileSync } from 'node:fs';

const login = process.env.GH_LOGIN || 'kendal-dev';
const token = process.env.GITHUB_TOKEN;
if (!token) { console.error('GITHUB_TOKEN is missing'); process.exit(1); }

const query = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions restrictedContributionsCount
      totalPullRequestContributions totalIssueContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
  }
}`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
  body: JSON.stringify({ query, variables: { login } }),
});
const json = await res.json();
if (!json.data?.user) { console.error(JSON.stringify(json.errors || json)); process.exit(1); }
const u = json.data.user;
const c = u.contributionsCollection;

// Language colors too dark to read on the black card get a lighter stand-in.
const readable = hex => {
  const h = (hex || '#70a5fd').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.25 ? '#8b9bb4' : '#' + h;
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toLocaleString('en-US');

const style = `
    .t { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    .m { font-family: ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace; }
    .in { opacity: 0; animation: in .7s ease-out forwards; }
    @keyframes in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; opacity: 1 !important; stroke-dasharray: none !important } }`;

// ---- stats card ----
const total = c.contributionCalendar.totalContributions;
const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
const items = [
  ['Commits', c.totalCommitContributions + c.restrictedContributionsCount],
  ['Pull requests', c.totalPullRequestContributions],
  ['Issues', c.totalIssueContributions],
  ['Public repos', u.repositories.totalCount],
  ['Stars', stars],
  ['Followers', u.followers.totalCount],
];
const rows = items.map(([k, v], i) => {
  const x = 190 + (i % 2) * 120, y = 62 + Math.floor(i / 2) * 50;
  return `<g class="in" style="animation-delay:${0.3 + i * 0.12}s">
      <text x="${x}" y="${y}" class="m" font-size="22" font-weight="700" fill="#ffffff">${fmt(v)}</text>
      <text x="${x}" y="${y + 17}" class="t" font-size="11" fill="#9ebeff">${k}</text></g>`;
}).join('\n    ');

const stats = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 190" width="430" height="190" role="img" aria-label="GitHub stats: ${total} contributions in the last year">
  <style>${style}
    .ring { stroke-dasharray: 0 302; animation: ring 1.6s ease-out .2s forwards; }
    @keyframes ring { to { stroke-dasharray: 302 302 } }
    .spin { transform-origin: 90px 100px; animation: spin 10s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg) } }
  </style>
  <rect x=".5" y=".5" width="429" height="189" rx="16" fill="#05070c" stroke="#70a5fd" stroke-opacity=".3"/>
  <text x="24" y="30" class="m" font-size="11" fill="#70a5fd" letter-spacing="2">GITHUB · LAST 12 MONTHS</text>
  <circle cx="90" cy="100" r="48" fill="none" stroke="#ffffff" stroke-opacity=".07" stroke-width="8"/>
  <circle class="ring" cx="90" cy="100" r="48" fill="none" stroke="#70a5fd" stroke-width="8" stroke-linecap="round" transform="rotate(-90 90 100)"/>
  <g class="spin"><circle cx="90" cy="48" r="4" fill="#e8f0ff"/></g>
  <text x="90" y="104" text-anchor="middle" class="m" font-size="24" font-weight="700" fill="#ffffff">${fmt(total)}</text>
  <text x="90" y="122" text-anchor="middle" class="t" font-size="11" fill="#9ebeff">contributions</text>
    ${rows}
</svg>
`;

// ---- languages card ----
const bytes = new Map();
for (const r of u.repositories.nodes) for (const e of r.languages.edges) {
  const cur = bytes.get(e.node.name) || { size: 0, color: readable(e.node.color) };
  cur.size += e.size; bytes.set(e.node.name, cur);
}
const sum = [...bytes.values()].reduce((a, b) => a + b.size, 0) || 1;
const top = [...bytes.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
let x = 24;
const barW = 382;
const segs = top.map(([name, v], i) => {
  const w = Math.max(2, (v.size / sum) * barW);
  const s = `<rect x="${x.toFixed(1)}" y="48" width="${w.toFixed(1)}" height="12" fill="${v.color}" class="in" style="animation-delay:${0.2 + i * 0.1}s"/>`;
  x += w; return s;
}).join('\n  ');
const legend = top.map(([name, v], i) => {
  const lx = 24 + (i % 2) * 200, ly = 92 + Math.floor(i / 2) * 30;
  const pct = (v.size / sum * 100).toFixed(1);
  return `<g class="in" style="animation-delay:${0.6 + i * 0.1}s">
    <circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${v.color}"/>
    <text x="${lx + 20}" y="${ly}" class="t" font-size="13" fill="#e8f0ff">${esc(name)}</text>
    <text x="${lx + 176}" y="${ly}" text-anchor="end" class="m" font-size="12" fill="#9ebeff">${pct}%</text></g>`;
}).join('\n  ');

const langs = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 190" width="430" height="190" role="img" aria-label="Top languages: ${top.map(([n]) => esc(n)).join(', ')}">
  <style>${style}</style>
  <defs><clipPath id="bar"><rect x="24" y="48" width="${barW}" height="12" rx="6"/></clipPath></defs>
  <rect x=".5" y=".5" width="429" height="189" rx="16" fill="#05070c" stroke="#70a5fd" stroke-opacity=".3"/>
  <text x="24" y="30" class="m" font-size="11" fill="#70a5fd" letter-spacing="2">TOP LANGUAGES · PUBLIC REPOS</text>
  <rect x="24" y="48" width="${barW}" height="12" rx="6" fill="#ffffff" fill-opacity=".07"/>
  <g clip-path="url(#bar)">
  ${segs}
  </g>
  ${legend}
</svg>
`;

writeFileSync('assets/stats.svg', stats);
writeFileSync('assets/langs.svg', langs);
console.log(`stats: ${total} contributions, ${u.repositories.totalCount} repos; langs: ${top.map(([n]) => n).join(', ')}`);
