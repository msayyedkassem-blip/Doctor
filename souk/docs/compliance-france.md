# Selling Lebanese groceries online in France — the rules the code enforces

Every rule below is implemented somewhere in `packages/core`. This file
explains *why*, so a future change does not quietly undo a legal obligation.

Dates and thresholds verified September 2026. Nothing here is legal advice —
it is the reasoning behind the code, and it is worth having an accountant
confirm the VAT section before the first big import.

---

## 1. VAT — franchise en base (art. 293 B CGI)

The business cannot recover VAT, which means it operates under the
*franchise en base*. Three consequences, all load-bearing:

**No VAT is charged to customers.** Invoices must carry, verbatim:

> TVA non applicable, article 293 B du CGI

Implemented as `FRANCHISE_INVOICE_MENTION`. In `FRANCHISE` mode
`computeCartTotals` returns an empty `vatBreakdown` — a VAT line must never
appear, not even at 0%.

**Import VAT is a cost, not a credit.** Goods cleared from Lebanon attract
import VAT at customs. With no right of deduction it stays in the cost base
forever. `landedUnitCost()` adds it to the unit cost precisely so margin is
not overstated — the commonest accounting error in this regime.

> Note: even under the franchise, importing from outside the EU requires a
> French VAT number, and import VAT is self-assessed on a CA3 return since
> the 2022 reform. Declared, then not deducted.

**There is a ceiling, and crossing it is automatic.** For sale of goods:

| Threshold | Amount | Effect |
|---|---|---|
| Base | 85 000 € | Exceeded in year N‑1 → VAT applies from **1 January of N+1** |
| Majoré | 93 500 € | Exceeded in the current year → VAT applies from the **1st of that very month** |

`evaluateFranchise()` returns which of the three states applies and the exact
effective date. The admin should surface the headroom continuously — the
majoré crossing is retroactive to the start of the month, so discovering it
late means owing VAT on sales already made at no-VAT prices.

**When it flips**, `VatSwitchStrategy` decides who absorbs the hit:

- `ABSORB` — shelf price unchanged, VAT carved out, margin drops.
- `PASS_THROUGH` — shelf price rises by the VAT, margin preserved.

Prices are stored as the amount the customer pays, because French B2C law
requires the advertised price to be all-inclusive.

**Rates once liable** (`VatCategory`) — the food boundary is not intuitive:

- **5,5 %** groceries for deferred consumption: tahini, olive oil, za'atar,
  pulses, coffee, rose water, pickles, and plain eating-chocolate bars.
- **20 %** confiserie and chocolate *confectionery* — pralinés, truffles,
  filled bonbons — plus margarine and caviar. Same shelf, different rate.

---

## 2. Food information — Regulation (EU) 1169/2011 ("INCO")

**Article 14 is the one that governs distance selling.** Every mandatory
particular *except the durability date* must be on the product page
**before** the customer buys, at no extra cost. All of them, date included,
must be on the goods at delivery.

So a product page is a regulated document. `checkDistanceSellingCompliance()`
gates publication on: legal name, ingredients, allergens, net quantity,
storage conditions, country of origin, the food business operator, and the
full nutrition declaration per 100 g.

Two details worth keeping:

- **Legal name ≠ marketing name.** "Za'atar" is the brand-facing name; the
  `legalName` field must carry something like *"Mélange d'épices à base de
  thym, sumac et graines de sésame"*. That is the field an inspector reads.
- **You are the food business operator.** For goods imported from outside
  the EU, the FBO named on the label is the importer established in the
  Union — this company. That is legal responsibility for conformity, not a
  formality.

**Allergens** are the closed Annex II list of 14 (`Allergen`). Sesame, tree
nuts, gluten, milk and sulphites do most of the work in a Lebanese
catalogue. Two traps encoded in the code:

- Sulphites are only declarable above **10 mg/kg** — relevant for dried
  apricots and figs.
- **Pine nuts and coconut are not on the EU list**, even though shoppers
  assume they are. Pine nuts run through sfiha, kibbeh and many sweets; warn
  about them in the ingredient text, not the allergen field.

`checkDistanceSellingCompliance` also cross-checks the ingredient text
against the allergen list for sesame, the likeliest omission here.

---

## 3. Right of withdrawal — and the myth that food is exempt

**The 14-day right applies to essentially this whole catalogue.** The
`L221-28` exemption covers goods that *deteriorate rapidly* — fresh, chilled,
anything on a DLC. Shelf-stable groceries on a DDM do not qualify.

The real protection is the *other* exemption: a sealed item unsealed after
delivery cannot be returned for hygiene reasons. So the rule in
`withdrawalRight()` is **returnable while still sealed** — lawful and
operationally sane.

This needs to be written correctly into the CGV. Claiming a blanket food
exemption is a DGCCRF finding.

---

## 4. Traceability and recall — Reg. 178/2002

Lot number and durability date live on the **stock batch**, not the product.
`allocateFefo()` picks stock first-expired-first-out and records which lot
went to which order, so a producer recall can be answered with a customer
list instead of a guess.

---

## 5. EPR packaging — Citeo

Anyone putting packaged goods on the French market owes the *REP emballages*
contribution. Joining Citeo yields a **unique identifier (IDU)**, which is
mandatory and must be published on the site. The Info-tri sorting label
comes with it.

Budget the eco-contribution into `landedUnitCost().otherCosts`. Note that
since 1 July 2026 all packaging falls under either the household or the
professional REP scheme, so there is no gap to sit in.

---

## 6. Customs — EU–Lebanon Association Agreement

Most Lebanese foodstuffs enter the EU at **zero duty** under the Association
Agreement, subject to an exceptions list covering sensitive goods — olive
oil, olives, table grapes, apples, pears, garlic, tomatoes, wine — which
carry zero-duty tariff quotas rather than free access.

**Olive oil and olives are on that list**, which matters directly here:
outside the quota, duty applies. The preference is only granted against proof
of origin — an **EUR.1 certificate** or an invoice declaration. Without it,
full third-country duty. Make it a standing requirement on every supplier PO.

---

## 7. Import controls

Food of non-animal origin is the easy path: no TRACES pre-notification unless
the product sits on the reinforced-controls list. Since June 2023 import
controls were transferred to the **douane**. Registration with the local
**DDPP** as a food business operator is the baseline obligation.

Keeping the catalogue **ambient and non-animal-origin** avoids approved-
establishment requirements entirely. Products of animal origin — dairy such
as labneh or kashkaval — would pull in TRACES notification, a border control
post, and an approved establishment. That is a different business; treat any
such SKU as a deliberate decision, not a catalogue addition.

---

## 8. No alcohol

Confirmed scope decision. Keeps the business out of licensing, *contributions
indirectes* accounting, and age verification, and keeps the mobile app in the
ordinary App Store and Play content ratings.
