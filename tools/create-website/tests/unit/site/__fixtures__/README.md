Copies of client #1's hand-made files (read-only reference in
`Makleri/clients/`), vendored so the snapshot tests run on any checkout:

- `novak-test.provisioning.json` = `clients/novak-test/provisioning.json`
- `novak-test.site.config.ts.txt` = `clients/site-novak-test/site.config.ts`
  at c5014d5 ("Make the copy standalone and configure it for novak-test").
  `.txt` so tsc does not typecheck it outside its repo.
