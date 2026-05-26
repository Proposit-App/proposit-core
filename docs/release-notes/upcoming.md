# Upcoming release notes

## Changed

- Installing `@proposit/proposit-core` no longer prints an "Ignored build
  scripts" warning. The package previously declared a `postinstall` script that
  existed only for the project's own development; pnpm flagged it on every
  install. That script has been removed, so installs are now clean.
