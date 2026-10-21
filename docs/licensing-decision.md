# Licensing decision

**Status: open.** No licence file is included in this repository, and none
should be added until the owner decides. This note records the options and the
trade-offs so that decision can be made on the merits.

**This note is not a licence, and it grants no permission of any kind.**

## Why the current state matters

Under default copyright, publishing source without a licence leaves the
copyright holder with all rights reserved. Anyone may read the code; nobody may
legally copy, modify or redistribute it. For a repository whose purpose is to
be inspected, and ideally built on, that is the difference between a public
source and a public demonstration.

The GitHub page for this repository therefore shows "no licence", and that is
accurate rather than an oversight.

## What the licence would actually cover

The question is narrow, and narrower than it looks:

- **The application's own source.** A TypeScript and Vue front end, a Rust
  back end, and the accounting domain in between.
- **No vendored third-party source.** Every dependency is consumed from its
  registry, and all of them are MIT, Apache-2.0 or OFL-1.1 licensed. Nothing
  in this repository is a copy of someone else's code, so a permissive licence
  here does not conflict with a dependency's terms.
- **The wordmark and icons** in `src-tauri/icons` and `public` are the author's
  own work. A source licence does not grant trademark rights, and if the
  project is to be licensed, the name and logo should be reserved separately
  from the code.

## The options

| | MIT | MPL-2.0 | Apache-2.0 | AGPL-3.0 |
|---|---|---|---|---|
| Permission | Use, copy, modify, distribute, sublicense | Same, for the files the licence covers | Same, with an express patent grant | Same, plus a network-use condition |
| Copyleft | None | File-level: changes to MPL-covered files must be published | None | Strong, over the whole work |
| Patent grant | None | Limited | Broad, and it terminates if a patent suit is brought | Yes |
| Obligation on the author | None beyond attribution | Keep publishing changes to touched files | Keep a NOTICE file and record modifications | Publish the complete source if run as a service |
| How an adopter reads it | "Do anything, no warranty" | "You may change it, but publish your changes to the files you touched" | "Do anything, with a patent licence and a NOTICE obligation" | "If you run it as a service, offer your changes" |
| Practical cost | Adopters get no patent protection from you | Every future contributor is bound by the file-level rule | A NOTICE file and change records to keep | Adopters who want to host it closed cannot |

## How these fit this particular project

**AGPL-3.0 does not fit, and the reason is specific rather than ideological.**
Its network clause is aimed at hosted services: if you run the software as a
service over a network, you must offer your changes. LedgerFy is explicitly
the opposite. The books live in a SQLite file in the operating system's
per-application data directory, the application runs on the user's own machine,
and nothing is phoned home. An adopter is not running LedgerFy as a service
and never will, so AGPL's main condition would never trigger for the
overwhelming majority of users, while its copyleft would still constrain
anyone who modifies and redistributes the desktop application — which is
exactly the adoption the project wants. It would impose a real cost for no
corresponding benefit.

**MPL-2.0 is defensible but imposes an ongoing obligation for little gain
here.** Its file-level copyleft is a reasonable middle ground for a project
that expects outside contributions, because it asks contributors to publish
changes to the files they touched. But the project currently has a single
primary author, and if outside contributions do arrive, the more useful
question for a contributor is whether the whole project stays permissive or not
— which file-level copyleft answers awkwardly. It also adds a licence variant
per file, which is a complication in a codebase that is otherwise uniform.

**Apache-2.0 is the strongest choice if the goal is adoption by businesses.**
It is permissive, so it does not deter adoption, and it is the only one of the
three permissive options with an express patent grant. That matters here
more than it would in a hobby project: the software computes tax, and an
adopter is entitled to worry about patent exposure. The grant is broad and
terminating, which is the behaviour corporate legal teams expect. The cost is
small and mechanical — a NOTICE file and keeping a record of modifications.

**MIT is the strongest choice if the goal is the lowest possible friction and
consistency across the portfolio.** It is a single page of text, it is the
licence most adopters already have a policy for, and it is the licence the
author's other public project, `prerender-audit`, already uses. A consistent
licence across a portfolio is worth something on its own: a single question to
answer for every repository.

## The decision, when it is made

Whichever licence is chosen, the same small set of steps applies:

1. Add the licence text as `LICENSE` at the repository root.
2. Set the `license` field in `package.json`, and the matching SPDX identifier
   in `src-tauri/Cargo.toml`, so the package metadata and the repository
   agree.
3. Add a short "Licence" section to `README.md` naming the licence and linking
   to the text.
4. Reserve the name and the logo separately from the code. A source licence
   does not trade marks, and a project that gives away its code but keeps its
   name has a materially different commercial position from one that does not.
5. Decide whether the licence applies retroactively to the published
   history — it does, unless the history is rewritten, and rewriting the
   history of a public repository to change its licence terms is a step worth
   taking deliberately rather than by accident.

## The recommendation

**Apache-2.0, with MIT as the alternative** if the priority is maximum
adoption and a consistent licence across the whole portfolio.

The case for Apache-2.0 over MIT here is narrow but real: this is accounting
software that touches tax computation and that businesses are being asked to
run against their own books. An express patent grant is a meaningful
de-risking for an adopter, and the cost of providing one is a NOTICE file.

The case for MIT is equally real: the project is a single-author effort
choosing to be useful, the other public repository already uses MIT, and
simplicity has value in itself.

Either way, AGPL-3.0 does not suit an offline desktop application, and
MPL-2.0 solves a contribution-management problem this project does not yet
have.
