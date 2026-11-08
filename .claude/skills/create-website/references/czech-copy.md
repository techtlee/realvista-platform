# Starter copy rules

`clients/<slug>/starter-copy.json` is the one file you write creatively. It is
seeded into the client's backend by `seed:client-site` (cms
`src/seed/starterCopy.ts` holds its zod schema and the tone defaults). The
realtor replaces it before go-live; its job is to make the site look real and
plausible on day one **without saying anything untrue about the client**.

Workflow:

```sh
cw copy init <slug> --json        # writes the tone default if the file is absent
# edit clients/<slug>/starter-copy.json with the Edit tool
cw copy validate <slug> --json    # schema + the rules below that a machine can check
cw run <slug> --json             # reseeds content only; logins and the site key are kept
```

`cw copy validate` fails (exit 2, `INVALID_STARTER_COPY`) with a list of paths.
Fix them and validate again.

## Rules, with the reason for each

1. **Czech, with diacritics.** The audience is Czech home buyers and sellers.
2. **Vykání in every tone.** `formal`, `friendly` and `neutral` change the
   voice, not the grammatical person. Czech realty copy that tykás reads as
   unprofessional and puts off older sellers, who are the realtor's main
   clients. So: *Ozvěte se nám*, *Napište nám*, *vaše nemovitost*; never
   *ozvi se*, *napiš*, *tvůj*, *máš*, *chceš*. The validator rejects
   `\b(tvůj|tvoje|tvoji|máš|chceš|napiš|ozvi se|zavolej)\b`.
3. **No invented facts.** Never write years in business ("od roku 2014"),
   counts ("180+ prodaných nemovitostí"), ratings ("4,9 / 5"), awards,
   certifications, team sizes, addresses, phone numbers or named past clients.
   On a real client's site these are false advertising. Where a fact belongs,
   write the visible placeholder `[DOPLNIT]` (e.g. stats values `[DOPLNIT]`,
   bio sentences ending with `[DOPLNIT: kolik let v oboru]`). The validator
   rejects digits in stats values other than inside `[DOPLNIT…]`.
4. **Facts you may use** are only those in the request: brand name, tagline,
   the contact's name, e-mail and phone, `company.city`, `company.name`, the
   chosen modules. Use the brand name at least in the hero or about text.
5. **The client's city, never Plzeň by default.** Client #1 was in Plzeň; the
   template once hardcoded it. Use `company.city`; if absent, write in a
   city-neutral way ("ve vašem regionu") or use Praha only where the template
   needs a city (the sample listings already do). A Brno realtor's site that
   says "v Plzni" is the classic copy-paste failure.
6. **Legal texts stay `[NÁVRH – před spuštěním nahradit]`.** Privacy policy and
   cookies texts are drafts until the client supplies their own; the marker
   keeps them from going live unnoticed. Don't remove it and don't "improve"
   legal text into something that looks final.
7. **Sample listings are titled `Ukázka – …`.** They exist so the site renders;
   the prefix stops anyone mistaking them for the client's offer. Don't rename
   them to look real.
8. **Tone guidance:**
   - `formal`: complete sentences, "Naše realitní kancelář …", "Zajišťujeme …",
     CTA *Domluvit konzultaci*.
   - `friendly`: warmer, shorter, first person plural, still vykání:
     "Pomůžeme vám …", CTA *Ozvěte se nám*.
   - `neutral`: factual and brief, CTA *Kontaktujte nás*.
9. **Plausible for a local realtor**: residential sales and rentals, valuation,
   legal preparation, handover. No luxury/investment pitch unless the brand or
   tagline says so.

## Hand-over TODOs

Everything left as `[DOPLNIT]` and every `[NÁVRH …]` text goes into the
hand-over message as a to-do for the realtor before go-live.
