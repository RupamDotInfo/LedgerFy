# Security policy

## Reporting a vulnerability

**Please report security issues privately. Do not open a public issue, a public
discussion, or a pull request for something that is a vulnerability.**

Use GitHub's private vulnerability reporting on this repository: go to
**Security → Report a vulnerability** on the repository page, or use the
**Report a vulnerability** link in the repository's Security tab. That opens a
private advisory that only the maintainer can see, and it gives you a private
place to talk about the details while a fix is prepared.

If that link is not available to you, open a regular issue that says only that
you would like to report a security issue privately and ask for a private
channel — describe nothing specific in the issue body. It will be closed and
replaced with a private advisory.

### What to include

- The version or commit you tested. There is no tagged release yet, so the
  commit on `main` is the version.
- The operating system, and whether you tested the desktop shell or the
  browser-only build.
- What you did, what you expected, and what happened.
- The smallest reproduction you can manage, and whether it needs a real
  database file or works against the bundled sample books.
- The impact you believe it has, and whether you think anyone else can reach it.

### What to expect

This is a one-person project, so there is no formal response deadline and no
on-call rota. In practice a report is read as soon as it arrives, and you can
expect an acknowledgement, an assessment of the severity, and either a fix or
an explanation of why the behaviour is intended and what the residual risk
is. If a fix is warranted it will land in a pull request that credits you,
unless you would rather stay anonymous.

If a report turns out not to be a vulnerability, you will get that said
plainly and with a reason.

## What is in scope

- The Rust backend in `src-tauri`: the database layer, migrations, the backup
  and restore path, and the commands the interface calls.
- The accounting domain in `src/domain`: balance and tax computation, stock
  costing, and payroll.
- The persistence boundary: what is written to the local database, what is
  validated before it is written, and whether a company can reach another
  company's rows.
- The handling of the books on disk: where they live, what is written to
  them, and whether a backup or restore can lose or expose data.
- The local data directory and the file-dialog and backup paths that reach it.

## What is out of scope

- The Tauri, Vite, Vue and SQLite frameworks themselves. Report those to
  their own projects.
- Findings that need an attacker to already have write access to the machine
  or to the database file, with no path through the application itself.
- Denial of service by feeding the application unreasonable input, and
  resource exhaustion in a locally run desktop application.
- Missing hardening that has no plausible attacker, and the absence of
  defence-in-depth that the operating system already provides.

## Do not test against other people's data

Run your research against the bundled sample books, or against a database file
you created yourself. Do not test against a production installation, and do not
run automated scans or load generators against one. This project holds
financial records, and someone else's books are not your test data.

## Already known

Issues that are already written down, and are therefore not new reports:

- The application is **offline-first and has no authentication of its own**:
  whoever can open the database file can read and change the books in it. It
  relies on the operating system's own protections for the data directory. On a
  shared machine, that is a real limitation, and it is documented rather than
  hidden.
- The sample books contain **fictional** data. Every company, party, tax
  identifier and contact detail in them is synthetic.
